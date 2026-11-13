// File access for one app, confined to its own folder (<app folder>/files).
// Every path from an app is relative, uses "/", and is checked before it touches the disk.
// Everything is async (fs.promises), so a big read or write never blocks the main process.

import { promises as fs, Stats } from 'fs';
import path from 'path';
import { KobelloError } from '@kobello/sdk';
import type { FileInfo } from '@kobello/sdk/protocol';
import { fail, requireString } from './common';

export interface FileLimits {
  /** Largest single file. */
  fileBytes: number;
  /** All of one app's files together. */
  totalBytes: number;
  /** Files plus folders. */
  entries: number;
}

export const FILE_LIMITS: FileLimits = { fileBytes: 50 * 1024 * 1024, totalBytes: 1024 * 1024 * 1024, entries: 10_000 };

const MAX_PATH_LENGTH = 1024;

// Names Windows reserves for devices, with or without an extension ("nul", "COM1.txt", "con .md").
// Windows also reads the superscript digits ¹ ² ³ as digits here.
const RESERVED_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)\s*(\.|$)/i;

/** True if Windows would treat this file or folder name as a device instead of a file. */
export function isReservedName(name: string): boolean {
  return RESERVED_NAME.test(name);
}

function isUnsafePart(part: string): boolean {
  return part === '.' || part === '..' ||
    /[. ]$/.test(part) || // Windows drops trailing dots and spaces, so "a." would become "a"
    /[<>"|?*]/.test(part) ||
    [...part].some((char) => char.charCodeAt(0) < 32) ||
    isReservedName(part);
}

/**
 * Splits an app's relative path into its parts.
 * Rejects anything that could reach outside the app folder or that Windows would read differently:
 * absolute paths, "..", backslashes, drive letters and device names.
 */
export function splitPath(relPath: unknown, allowRoot = false): string[] {
  const value = requireString(relPath, 'Path', MAX_PATH_LENGTH, allowRoot);
  const parts = value.split('/').filter(Boolean);
  if (value.startsWith('/') || value.includes('\\') || value.includes(':') || parts.some(isUnsafePart)) {
    fail('INVALID_ARGUMENT', `Path must be relative and stay inside the app folder: "${value}"`);
  }
  if (!allowRoot && parts.length === 0) fail('INVALID_ARGUMENT', 'Path is empty.');
  return parts;
}

/** Like lstat, but null when nothing is there. A link counts as "there" even if its target is missing. */
async function lstatOrNull(full: string): Promise<Stats | null> {
  try {
    return await fs.lstat(full);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
}

interface Usage {
  bytes: number;
  entries: number;
}

/** Adds up the size and the number of files and folders under a folder. Links aren't followed. */
async function measure(root: string): Promise<Usage> {
  const usage: Usage = { bytes: 0, entries: 0 };
  const folders = [root];
  while (folders.length > 0) {
    const folder = folders.pop() as string;
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      usage.entries += 1;
      if (entry.isDirectory()) folders.push(full);
      else if (entry.isFile()) usage.bytes += (await fs.lstat(full)).size;
    }
  }
  return usage;
}

function fileInfo(rel: string, stats: Stats): FileInfo {
  return {
    path: rel,
    name: path.posix.basename(rel),
    type: stats.isDirectory() ? 'dir' : 'file',
    size: stats.isDirectory() ? 0 : stats.size,
    modifiedAt: stats.mtime.toISOString(),
  };
}

export class AppFiles {
  /** What the folder holds. Measured on first use, then kept up to date by every change made here. */
  private usage?: Usage;
  /** Calls run one after another, so two writes can't both slip in under the quota. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly root: string, private readonly limits: FileLimits = FILE_LIMITS) {}

  read(relPath: unknown, encoding: unknown): Promise<string | Uint8Array> {
    return this.run(async () => {
      const { full, rel } = await this.resolve(relPath);
      const stats = await lstatOrNull(full);
      if (!stats?.isFile()) fail('NOT_FOUND', `No file at "${rel}".`);
      if (stats.size > this.limits.fileBytes) fail('QUOTA_EXCEEDED', 'Files can be at most 50 MB.');
      const data = await fs.readFile(full);
      return encoding === 'binary' ? new Uint8Array(data) : data.toString('utf8');
    });
  }

  write(relPath: unknown, data: unknown, createDirs: unknown): Promise<FileInfo> {
    return this.run(async () => {
      if (typeof data !== 'string' && !(data instanceof Uint8Array)) fail('INVALID_ARGUMENT', 'Data must be a string or a Uint8Array.');
      // Measure before copying anything: a huge string must not become a Buffer first.
      const size = typeof data === 'string' ? Buffer.byteLength(data, 'utf8') : data.byteLength;
      if (size > this.limits.fileBytes) fail('QUOTA_EXCEEDED', 'Files can be at most 50 MB.');

      const { full, rel } = await this.resolve(relPath);
      const existing = await lstatOrNull(full);
      if (existing && !existing.isFile()) fail('INVALID_ARGUMENT', `"${rel}" isn't a file.`);
      const parent = path.dirname(full);
      const newFolders = await this.missingFolders(parent);
      if (newFolders > 0 && createDirs !== true) {
        fail('NOT_FOUND', `Folder "${path.posix.dirname(rel)}" doesn't exist. Pass { createDirs: true } to create it.`);
      }
      const usage = await this.checkRoom(size - (existing?.size ?? 0), newFolders + (existing ? 0 : 1));

      if (newFolders > 0) {
        await fs.mkdir(parent, { recursive: true });
        usage.entries += newFolders;
      }
      await fs.writeFile(full, data);
      usage.entries += existing ? 0 : 1;
      usage.bytes += size - (existing?.size ?? 0);
      return fileInfo(rel, await fs.lstat(full));
    });
  }

  /** Deletes a file or an empty folder. */
  delete(relPath: unknown): Promise<void> {
    return this.run(async () => {
      const { full, rel } = await this.resolve(relPath);
      const stats = await lstatOrNull(full);
      if (!stats) fail('NOT_FOUND', `Nothing at "${rel}".`);
      if (stats.isDirectory()) {
        if ((await fs.readdir(full)).length > 0) fail('INVALID_ARGUMENT', `Folder "${rel}" isn't empty.`);
        await fs.rmdir(full);
      } else {
        await fs.unlink(full);
      }
      if (this.usage) {
        this.usage.entries -= 1;
        if (stats.isFile()) this.usage.bytes -= stats.size;
      }
    });
  }

  /** Lists one folder level. An empty path lists the app's root folder. */
  list(relDir: unknown): Promise<FileInfo[]> {
    return this.run(async () => {
      const { full, rel } = await this.resolve(relDir, true);
      if (!(await lstatOrNull(full))?.isDirectory()) fail('NOT_FOUND', `No folder at "${rel}".`);
      const entries = (await fs.readdir(full, { withFileTypes: true }))
        .filter((entry) => entry.isFile() || entry.isDirectory()); // skip links and other special entries
      return Promise.all(entries.map(async (entry) =>
        fileInfo(rel ? `${rel}/${entry.name}` : entry.name, await fs.lstat(path.join(full, entry.name)))));
    });
  }

  stat(relPath: unknown): Promise<FileInfo | null> {
    return this.run(async () => {
      const { full, rel } = await this.resolve(relPath);
      const stats = await lstatOrNull(full);
      return stats ? fileInfo(rel, stats) : null;
    });
  }

  /** Creates a folder and any missing parent folders. */
  mkdir(relPath: unknown): Promise<void> {
    return this.run(async () => {
      const { full, rel } = await this.resolve(relPath);
      if (await lstatOrNull(full)) fail('ALREADY_EXISTS', `"${rel}" already exists.`);
      const newFolders = await this.missingFolders(full);
      const usage = await this.checkRoom(0, newFolders);
      await fs.mkdir(full, { recursive: true });
      usage.entries += newFolders;
    });
  }

  rename(from: unknown, to: unknown): Promise<void> {
    return this.run(async () => {
      const source = await this.resolve(from);
      const target = await this.resolve(to);
      if (!(await lstatOrNull(source.full))) fail('NOT_FOUND', `Nothing at "${source.rel}".`);
      if (await lstatOrNull(target.full)) fail('ALREADY_EXISTS', `"${target.rel}" already exists.`);
      if (target.rel.startsWith(`${source.rel}/`)) fail('INVALID_ARGUMENT', "Can't move a folder into itself.");
      if (!(await lstatOrNull(path.dirname(target.full)))?.isDirectory()) {
        fail('NOT_FOUND', `Folder "${path.posix.dirname(target.rel)}" doesn't exist.`);
      }
      await fs.rename(source.full, target.full);
    });
  }

  /**
   * Runs one call after the previous one has finished, and turns disk errors into SDK errors:
   * a full disk is QUOTA_EXCEEDED, a file used as a folder (or the reverse) is INVALID_ARGUMENT.
   * Anything else stays an internal error.
   */
  private run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task).catch((error): never => {
      if (error instanceof KobelloError) throw error;
      this.usage = undefined; // the change may be half done: measure the folder again next time
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOSPC') fail('QUOTA_EXCEEDED', 'The disk is full.');
      if (code === 'ENOTDIR' || code === 'EISDIR' || code === 'ENAMETOOLONG') fail('INVALID_ARGUMENT', "That path can't be used.");
      throw error;
    });
    this.queue = result.catch((): void => undefined);
    return result;
  }

  /** Turns an app's relative path into a full path, and checks that links don't lead it outside the app folder. */
  private async resolve(relPath: unknown, allowRoot = false): Promise<{ full: string; rel: string }> {
    const parts = splitPath(relPath, allowRoot);
    await fs.mkdir(this.root, { recursive: true });
    // The app folder itself may be a link the user made (to another drive, say). Nothing inside it may lead out.
    const root = await fs.realpath(this.root);
    const full = path.join(root, ...parts);

    // Follow links on the part of the path that already exists, and make sure it's still inside the root.
    // lstat sees a link even when its target is missing, so a link to nowhere can't pass as "not created yet".
    let existing = full;
    while (!(await lstatOrNull(existing))) existing = path.dirname(existing);
    const real = await fs.realpath(existing).catch((): null => null);
    if (real === null || (real !== root && !real.startsWith(root + path.sep))) {
      fail('INVALID_ARGUMENT', `Path leads outside the app folder: "${parts.join('/')}"`);
    }
    return { full, rel: parts.join('/') };
  }

  /** How many folders would have to be created for `folder` to exist (0 if it's there). */
  private async missingFolders(folder: string): Promise<number> {
    let missing = 0;
    for (let current = folder; ; current = path.dirname(current)) {
      const stats = await lstatOrNull(current);
      if (stats?.isDirectory()) return missing;
      if (stats) fail('INVALID_ARGUMENT', `"${path.basename(current)}" isn't a folder.`);
      missing += 1;
    }
  }

  /** Fails with QUOTA_EXCEEDED unless the app folder has room for this many more bytes and entries. */
  private async checkRoom(bytes: number, entries: number): Promise<Usage> {
    const usage = this.usage ?? (this.usage = await measure(this.root));
    if (bytes > 0 && usage.bytes + bytes > this.limits.totalBytes) {
      fail('QUOTA_EXCEEDED', 'This app has used all its space for files (1 GB).');
    }
    if (entries > 0 && usage.entries + entries > this.limits.entries) {
      fail('QUOTA_EXCEEDED', 'This app has too many files and folders (at most 10,000).');
    }
    return usage;
  }
}
