import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppFiles } from './files';
import { Registry, RegistryApp } from './registry';
import { checkAppUrl, inspectUrl, parseManifest } from './site-info';
import { AppStorage } from './storage';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kobello-test-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Runs fn and returns the KobelloError code it throws. */
const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return 'no error';
};

describe('AppFiles', () => {
  const files = () => new AppFiles(path.join(dir, 'app', 'files'));

  it('writes, reads, lists, renames and deletes inside the app folder', () => {
    const f = files();
    f.write('notes/a.md', '# Hi', true);
    expect(f.read('notes/a.md', 'utf8')).toBe('# Hi');
    expect(f.list('notes').map((x) => x.name)).toEqual(['a.md']);
    f.rename('notes', 'archive');
    expect(f.stat('archive/a.md')).toMatchObject({ path: 'archive/a.md', type: 'file', size: 4 });
    expect(codeOf(() => f.delete('archive'))).toBe('INVALID_ARGUMENT'); // not empty
    f.delete('archive/a.md');
    f.delete('archive');
    expect(f.list('')).toEqual([]);
  });

  it('round-trips binary data', () => {
    const f = files();
    f.write('a.bin', new Uint8Array([0, 255, 7]), false);
    expect(f.read('a.bin', 'binary')).toEqual(new Uint8Array([0, 255, 7]));
  });

  it('refuses paths that could leave the app folder', () => {
    const f = files();
    for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'C:/Windows/x', 'a\\b', 'con', 'nul.txt', 'a/./b', '']) {
      expect(codeOf(() => f.write(bad, 'x', true)), bad).toBe('INVALID_ARGUMENT');
    }
  });

  it('refuses a link that points outside the app folder', () => {
    const f = files();
    f.mkdir('inside');
    const outside = path.join(dir, 'outside');
    fs.mkdirSync(outside);
    try {
      fs.symlinkSync(outside, path.join(dir, 'app', 'files', 'escape'), 'junction');
    } catch {
      return; // this machine can't create links; nothing to test
    }
    expect(codeOf(() => f.write('escape/x.txt', 'x', false))).toBe('INVALID_ARGUMENT');
    expect(fs.existsSync(path.join(outside, 'x.txt'))).toBe(false);
  });

  it('needs the parent folder unless createDirs is set', () => {
    expect(codeOf(() => files().write('missing/a.txt', 'x', false))).toBe('NOT_FOUND');
    expect(codeOf(() => files().read('nope.txt', 'utf8'))).toBe('NOT_FOUND');
    expect(codeOf(() => { const f = files(); f.mkdir('d'); f.mkdir('d'); })).toBe('ALREADY_EXISTS');
  });
});

describe('AppStorage', () => {
  it('keeps values across restarts', () => {
    const file = path.join(dir, 'storage.json');
    new AppStorage(file).set('settings', { theme: 'dark' });
    const again = new AppStorage(file);
    expect(again.get('settings')).toEqual({ theme: 'dark' });
    expect(again.keys()).toEqual(['settings']);
    again.delete('settings');
    expect(new AppStorage(file).get('settings')).toBeUndefined();
  });

  it('enforces the limits', () => {
    const storage = new AppStorage(path.join(dir, 'storage.json'));
    expect(codeOf(() => storage.set('', 1))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => storage.set('k', undefined))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => storage.set('big', 'x'.repeat(1024 * 1024 + 1)))).toBe('QUOTA_EXCEEDED');
  });
});

describe('Registry', () => {
  it('saves, replaces and removes apps', () => {
    const file = path.join(dir, 'registry.json');
    const app: RegistryApp = {
      id: 'com.example.notes', kind: 'kobello-app', name: 'Notes', url: 'https://notes.example/',
      permissions: ['storage'], origin: 'https://notes.example', installedAt: '2026-10-20T00:00:00Z',
    };
    new Registry(file).put(app);
    new Registry(file).put({ ...app, name: 'Notes 2' });
    expect(new Registry(file).list()).toMatchObject([{ id: 'com.example.notes', name: 'Notes 2' }]);
    new Registry(file).remove(app.id);
    expect(new Registry(file).list()).toEqual([]);
  });
});

describe('site info', () => {
  const manifest = { kobello: 1, id: 'com.example.notes', name: 'Notes', version: '1.0.0', permissions: ['storage', 'files'] };

  it('accepts https always and localhost only in developer mode', () => {
    expect(checkAppUrl('https://a.example/#x', false).toString()).toBe('https://a.example/');
    expect(codeOf(() => checkAppUrl('http://a.example/', true))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => checkAppUrl('http://localhost:5173/', false))).toBe('INVALID_ARGUMENT');
    expect(checkAppUrl('http://localhost:5173/', true).origin).toBe('http://localhost:5173');
  });

  it('validates kobello.json', () => {
    expect(parseManifest(manifest, 'https://notes.example').id).toBe('com.example.notes');
    expect(codeOf(() => parseManifest({ ...manifest, id: 'Bad ID' }, 'https://notes.example'))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => parseManifest({ ...manifest, id: 'kobello.shell' }, 'https://notes.example'))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => parseManifest({ ...manifest, permissions: ['camera'] }, 'https://notes.example'))).toBe('INVALID_ARGUMENT');
    expect(codeOf(() => parseManifest({ ...manifest, start_url: 'https://evil.example/' }, 'https://notes.example'))).toBe('INVALID_ARGUMENT');
  });

  /** A fake fetch that serves these paths and answers 404 to the rest. */
  const fakeFetch = (pages: Record<string, string>) => async (url: string) =>
    url in pages ? new Response(pages[url]) : new Response('not found', { status: 404 });

  it('recognises a Kobello app by its kobello.json', async () => {
    const result = await inspectUrl('https://notes.example/app', fakeFetch({
      'https://notes.example/kobello.json': JSON.stringify({ ...manifest, icon: '/icon.png' }),
    }), false);
    expect(result).toMatchObject({ kind: 'kobello-app', url: 'https://notes.example/', iconUrl: 'https://notes.example/icon.png' });
  });

  it('reads a website name and icon from its web app manifest', async () => {
    const result = await inspectUrl('https://site.example/', fakeFetch({
      'https://site.example/': '<title>Fallback</title><link rel="manifest" href="/app.webmanifest">',
      'https://site.example/app.webmanifest': JSON.stringify({ name: 'Site', icons: [{ src: 'i-64.png', sizes: '64x64' }, { src: 'i-512.png', sizes: '512x512' }] }),
    }), false);
    expect(result).toEqual({ kind: 'website', url: 'https://site.example/', name: 'Site', iconUrl: 'https://site.example/i-512.png' });
  });

  it('reports NETWORK_ERROR when the site is unreachable', async () => {
    const offline = async () => { throw new TypeError('fetch failed'); };
    await expect(inspectUrl('https://site.example/', offline, false)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});
