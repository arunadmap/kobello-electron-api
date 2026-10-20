// File access for one app, confined to its own folder (<app folder>/files).
// Every path from an app is relative, uses "/", and is checked before it touches the disk.

import fs from 'fs';
import path from 'path';
import type { FileInfo } from '@kobello/sdk/protocol';
import { fail, requireString } from './common';

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_PATH_LENGTH = 1024;
// Names Windows reserves for devices; files with these names can't be used normally.
const RESERVED_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

export class AppFiles {
  constructor(private readonly root: string) {}

  read(relPath: unknown, encoding: unknown): string | Uint8Array {
    const { full } = this.resolve(relPath);
    const stats = this.statOrNull(full);
    if (!stats?.isFile()) fail('NOT_FOUND', `No file at "${relPath}".`);
    if (stats.size > MAX_FILE_BYTES) fail('QUOTA_EXCEEDED', 'Files can be at most 50 MB.');
    const data = fs.readFileSync(full);
    return encoding === 'binary' ? new Uint8Array(data) : data.toString('utf8');
  }

  write(relPath: unknown, data: unknown, createDirs: unknown): FileInfo {
    const { full, rel } = this.resolve(relPath);
    if (typeof data !== 'string' && !(data instanceof Uint8Array)) fail('INVALID_ARGUMENT', 'Data must be a string or a Uint8Array.');
    const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
    if (bytes.byteLength > MAX_FILE_BYTES) fail('QUOTA_EXCEEDED', 'Files can be at most 50 MB.');
    if (this.statOrNull(full)?.isDirectory()) fail('INVALID_ARGUMENT', `"${rel}" is a folder.`);

    const parent = path.dirname(full);
    if (createDirs === true) fs.mkdirSync(parent, { recursive: true });
    if (!this.statOrNull(parent)?.isDirectory()) {
      fail('NOT_FOUND', `Folder "${path.posix.dirname(rel)}" doesn't exist. Pass { createDirs: true } to create it.`);
    }
    fs.writeFileSync(full, bytes);
    return this.info(full, rel);
  }

  /** Deletes a file or an empty folder. */
  delete(relPath: unknown): void {
    const { full, rel } = this.resolve(relPath);
    const stats = this.statOrNull(full);
    if (!stats) fail('NOT_FOUND', `Nothing at "${rel}".`);
    if (stats.isDirectory()) {
      if (fs.readdirSync(full).length > 0) fail('INVALID_ARGUMENT', `Folder "${rel}" isn't empty.`);
      fs.rmdirSync(full);
    } else {
      fs.unlinkSync(full);
    }
  }

  /** Lists one folder level. An empty path lists the app's root folder. */
  list(relDir: unknown): FileInfo[] {
    const { full, rel } = this.resolve(relDir, true);
    if (!this.statOrNull(full)?.isDirectory()) fail('NOT_FOUND', `No folder at "${rel}".`);
    return fs.readdirSync(full, { withFileTypes: true })
      .filter((entry) => entry.isFile() || entry.isDirectory()) // skip links and other special entries
      .map((entry) => this.info(path.join(full, entry.name), rel ? `${rel}/${entry.name}` : entry.name));
  }

  stat(relPath: unknown): FileInfo | null {
    const { full, rel } = this.resolve(relPath);
    return this.statOrNull(full) ? this.info(full, rel) : null;
  }

  /** Creates a folder and any missing parent folders. */
  mkdir(relPath: unknown): void {
    const { full, rel } = this.resolve(relPath);
    if (this.statOrNull(full)) fail('ALREADY_EXISTS', `"${rel}" already exists.`);
    fs.mkdirSync(full, { recursive: true });
  }

  rename(from: unknown, to: unknown): void {
    const source = this.resolve(from);
    const target = this.resolve(to);
    if (!this.statOrNull(source.full)) fail('NOT_FOUND', `Nothing at "${source.rel}".`);
    if (this.statOrNull(target.full)) fail('ALREADY_EXISTS', `"${target.rel}" already exists.`);
    if (target.rel.startsWith(`${source.rel}/`)) fail('INVALID_ARGUMENT', "Can't move a folder into itself.");
    if (!this.statOrNull(path.dirname(target.full))?.isDirectory()) {
      fail('NOT_FOUND', `Folder "${path.posix.dirname(target.rel)}" doesn't exist.`);
    }
    fs.renameSync(source.full, target.full);
  }

  /**
   * Turns an app's relative path into a full path inside the app folder.
   * Rejects anything that could reach outside it: absolute paths, "..", backslashes, drive letters,
   * Windows device names, and links that point elsewhere.
   */
  private resolve(relPath: unknown, allowRoot = false): { full: string; rel: string } {
    const value = requireString(relPath, 'Path', MAX_PATH_LENGTH, allowRoot);
    const parts = value.split('/').filter(Boolean);
    const unsafe = value.startsWith('/') || value.includes('\\') || value.includes(':') ||
      parts.some((part) => part === '.' || part === '..' || RESERVED_NAMES.test(part) || /[<>"|?*\0]/.test(part));
    if (unsafe) fail('INVALID_ARGUMENT', `Path must be relative and stay inside the app folder: "${value}"`);
    if (!allowRoot && parts.length === 0) fail('INVALID_ARGUMENT', 'Path is empty.');

    fs.mkdirSync(this.root, { recursive: true });
    const full = path.join(this.root, ...parts);

    // Follow links on the part of the path that already exists, and make sure it's still inside the root.
    let existing = full;
    while (!fs.existsSync(existing)) existing = path.dirname(existing);
    const realRoot = fs.realpathSync(this.root);
    const real = fs.realpathSync(existing);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
      fail('INVALID_ARGUMENT', `Path leads outside the app folder: "${value}"`);
    }
    return { full, rel: parts.join('/') };
  }

  private statOrNull(full: string): fs.Stats | null {
    try {
      return fs.statSync(full);
    } catch {
      return null;
    }
  }

  private info(full: string, rel: string): FileInfo {
    const stats = fs.statSync(full);
    return {
      path: rel,
      name: path.basename(full),
      type: stats.isDirectory() ? 'dir' : 'file',
      size: stats.isDirectory() ? 0 : stats.size,
      modifiedAt: stats.mtime.toISOString(),
    };
  }
}
