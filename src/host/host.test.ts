import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppFiles, splitPath } from './files';
import { Registry, RegistryApp } from './registry';
import { checkAppUrl, inspectUrl, parseManifest } from './site-info';
import { AppStorage } from './storage';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kobello-test-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Runs fn (sync or async) and returns the KobelloError code it fails with. */
const codeOf = async (fn: () => unknown) => {
  try {
    await fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return 'no error';
};

describe('AppFiles', () => {
  const root = () => path.join(dir, 'app', 'files');
  const files = () => new AppFiles(root());

  it('writes, reads, lists, renames and deletes inside the app folder', async () => {
    const f = files();
    await f.write('notes/a.md', '# Hi', true);
    expect(await f.read('notes/a.md', 'utf8')).toBe('# Hi');
    expect((await f.list('notes')).map((x) => x.name)).toEqual(['a.md']);
    await f.rename('notes', 'archive');
    expect(await f.stat('archive/a.md')).toMatchObject({ path: 'archive/a.md', name: 'a.md', type: 'file', size: 4 });
    expect(await f.stat('archive')).toMatchObject({ path: 'archive', type: 'dir', size: 0 });
    expect(await f.stat('nope')).toBeNull();
    expect(await codeOf(() => f.delete('archive'))).toBe('INVALID_ARGUMENT'); // not empty
    await f.delete('archive/a.md');
    await f.delete('archive');
    expect(await f.list('')).toEqual([]);
  });

  it('round-trips binary data', async () => {
    const f = files();
    await f.write('a.bin', new Uint8Array([0, 255, 7]), false);
    expect(await f.read('a.bin', 'binary')).toEqual(new Uint8Array([0, 255, 7]));
  });

  it('refuses paths that could leave the app folder', async () => {
    const f = files();
    for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'C:/Windows/x', 'a\\b', 'con', 'nul.txt', 'a/./b', '']) {
      expect(await codeOf(() => f.write(bad, 'x', true)), bad).toBe('INVALID_ARGUMENT');
    }
  });

  it('refuses names Windows would read as something else', async () => {
    const bad = [
      'a.', 'a ', 'notes./a.md', 'notes /a.md', // Windows drops trailing dots and spaces
      'CONIN$', 'conout$', 'CONOUT$.txt', 'aux.h', 'con .txt', 'COM1', 'lpt9.log',
      'COM\u00b9', 'com\u00b2.txt', 'LPT\u00b3', // superscript digits count as digits
      'a\tb', 'a\u0000b', 'what?', 'a<b',
    ];
    for (const value of bad) expect(await codeOf(() => splitPath(value)), JSON.stringify(value)).toBe('INVALID_ARGUMENT');

    expect(splitPath('notes/2026/a b.md')).toEqual(['notes', '2026', 'a b.md']);
    for (const fine of ['.hidden', 'com10', 'console.log', 'lpt', 'a.b.c', 'conin', 'nul_backup']) expect(splitPath(fine)).toEqual([fine]);
    expect(splitPath('', true)).toEqual([]);
  });

  it('refuses a link that points outside the app folder', async () => {
    const f = files();
    await f.mkdir('inside');
    const outside = path.join(dir, 'outside');
    fs.mkdirSync(outside);
    try {
      fs.symlinkSync(outside, path.join(root(), 'escape'), 'junction');
    } catch {
      return; // this machine can't create links; nothing to test
    }
    expect(await codeOf(() => f.write('escape/x.txt', 'x', false))).toBe('INVALID_ARGUMENT');
    expect(fs.existsSync(path.join(outside, 'x.txt'))).toBe(false);
    expect((await f.list('')).map((x) => x.name)).toEqual(['inside']); // links aren't listed
  });

  it("refuses a link to a place that doesn't exist yet", async () => {
    const f = files();
    await f.mkdir('inside');
    const missing = path.join(dir, 'not-there');
    try {
      fs.symlinkSync(missing, path.join(root(), 'dangling'), 'junction');
    } catch {
      return; // this machine can't create links; nothing to test
    }
    // The link's target is missing, but the link itself is there: it must not pass as "a new file".
    expect(await codeOf(() => f.write('dangling', 'x', false))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(() => f.write('dangling/x.txt', 'x', true))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(() => f.mkdir('dangling/sub'))).toBe('INVALID_ARGUMENT');
    expect(fs.existsSync(missing)).toBe(false);
  });

  it('needs the parent folder unless createDirs is set', async () => {
    expect(await codeOf(() => files().write('missing/a.txt', 'x', false))).toBe('NOT_FOUND');
    expect(await codeOf(() => files().read('nope.txt', 'utf8'))).toBe('NOT_FOUND');
    expect(await codeOf(async () => { const f = files(); await f.mkdir('d'); await f.mkdir('d'); })).toBe('ALREADY_EXISTS');
  });

  it('reports a file used as a folder as a bad path, not an internal error', async () => {
    const f = files();
    await f.write('a.txt', 'x', false);
    expect(await codeOf(() => f.write('a.txt/b.txt', 'x', true))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(() => f.mkdir('a.txt/sub'))).toBe('INVALID_ARGUMENT');
    await f.mkdir('folder');
    expect(await codeOf(() => f.write('folder', 'x', false))).toBe('INVALID_ARGUMENT');
  });

  describe('quota', () => {
    const limits = { fileBytes: 10, totalBytes: 25, entries: 4 };
    const small = () => new AppFiles(root(), limits);
    const ten = 'x'.repeat(10);

    it('limits one file, measured in bytes', async () => {
      const f = small();
      await f.write('a', ten, false);
      expect(await codeOf(() => f.write('b', `${ten}x`, false))).toBe('QUOTA_EXCEEDED');
      expect(await codeOf(() => f.write('b', 'é'.repeat(6), false))).toBe('QUOTA_EXCEEDED'); // 6 characters, 12 bytes
      expect(await codeOf(() => f.write('b', new Uint8Array(11), false))).toBe('QUOTA_EXCEEDED');
      expect(await f.stat('b')).toBeNull();
    });

    it('limits the total size, and frees space on overwrite and delete', async () => {
      const f = small();
      await f.write('a', ten, false);
      await f.write('b', ten, false);
      expect(await codeOf(() => f.write('c', ten, false))).toBe('QUOTA_EXCEEDED'); // 30 > 25
      await f.write('a', 'xxxxx', false);   // 15 in use
      await f.write('c', ten, false);       // 25 in use
      expect(await codeOf(() => f.write('a', 'xxxxxx', false))).toBe('QUOTA_EXCEEDED');
      await f.delete('b');                  // 15 in use
      await f.write('a', ten, false);       // 20 in use
    });

    it('limits the number of files and folders', async () => {
      const f = small();
      await f.write('one/a', 'x', true);    // 2 entries: the folder and the file
      await f.mkdir('two');                 // 3
      expect(await codeOf(() => f.mkdir('three/four'))).toBe('QUOTA_EXCEEDED');   // would be 5
      expect(await codeOf(() => f.write('x/y', 'x', true))).toBe('QUOTA_EXCEEDED'); // would be 5
      expect(await f.stat('three')).toBeNull();
      expect(await f.stat('x')).toBeNull();
      await f.write('b', 'x', false);       // 4
      expect(await codeOf(() => f.write('c', 'x', false))).toBe('QUOTA_EXCEEDED');
      await f.write('b', 'xx', false);      // replacing a file adds no entry
      await f.delete('two');
      await f.write('c', 'x', false);
    });

    it('counts what is already in the folder', async () => {
      await small().write('a', ten, false);
      await small().write('b', ten, false);
      expect(await codeOf(() => small().write('c', ten, false))).toBe('QUOTA_EXCEEDED');
    });

    it("doesn't let writes sent together slip past the limit", async () => {
      const f = small();
      const results = await Promise.allSettled(['a', 'b', 'c'].map((name) => f.write(name, ten, false)));
      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled', 'rejected']);
      expect((await f.list('')).map((x) => x.name).sort()).toEqual(['a', 'b']);
    });
  });
});

describe('AppStorage', () => {
  const file = () => path.join(dir, 'storage.json');

  it('keeps values across restarts', () => {
    new AppStorage(file()).set('settings', { theme: 'dark' });
    const again = new AppStorage(file());
    expect(again.get('settings')).toEqual({ theme: 'dark' });
    expect(again.keys()).toEqual(['settings']);
    again.delete('settings');
    expect(new AppStorage(file()).get('settings')).toBeUndefined();
  });

  it('enforces the limits', async () => {
    const storage = new AppStorage(file());
    expect(await codeOf(() => storage.set('', 1))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(() => storage.set('k', undefined))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(() => storage.set('big', 'x'.repeat(1024 * 1024 + 1)))).toBe('QUOTA_EXCEEDED');
  });

  it('treats "constructor" and "__proto__" as ordinary keys', () => {
    const storage = new AppStorage(file());
    for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) expect(storage.get(key), key).toBeUndefined();
    storage.delete('constructor'); // nothing to delete, and nothing breaks

    storage.set('__proto__', { polluted: true });
    storage.set('constructor', 1);
    expect(storage.get('__proto__')).toEqual({ polluted: true });
    expect(storage.keys()).toEqual(['__proto__', 'constructor']);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();

    const again = new AppStorage(file());
    expect(again.get('__proto__')).toEqual({ polluted: true });
    expect(again.get('constructor')).toBe(1);
    expect(again.get('toString')).toBeUndefined();
  });

  it('keeps count of the total size as values change', async () => {
    // Each of these entries takes 51 bytes in the file: "a":"\"xxx…\"", with 40 x's.
    const value = 'x'.repeat(40);
    const storage = new AppStorage(file(), 110);
    storage.set('a', value);
    storage.set('b', value);
    expect(await codeOf(() => storage.set('c', value))).toBe('QUOTA_EXCEEDED');
    expect(storage.keys()).toEqual(['a', 'b']);

    storage.set('a', value);                 // replacing a value isn't counted twice
    storage.set('a', 'x');                   // a smaller value frees room…
    expect(await codeOf(() => storage.set('c', value))).toBe('QUOTA_EXCEEDED'); // …but not enough
    storage.delete('a');
    storage.set('c', value);
    expect(fs.statSync(file()).size).toBeLessThanOrEqual(110);

    // A restart counts what's in the file.
    const again = new AppStorage(file(), 110);
    expect(await codeOf(() => again.set('d', value))).toBe('QUOTA_EXCEEDED');
    again.clear();
    again.set('d', value);
    again.set('e', value);
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
  const origin = 'https://notes.example';

  type Page = string | { redirect: string } | { body: ReadableStream<Uint8Array> };

  /**
   * A fake fetch that serves these URLs and answers 404 to the rest. Like the real one, it doesn't
   * follow redirects: it returns them. `seen` lists every URL that was asked for.
   */
  const fakeFetch = (pages: Record<string, Page>) => {
    const seen: string[] = [];
    const fetchUrl = async (url: string) => {
      seen.push(url);
      const page = Object.prototype.hasOwnProperty.call(pages, url) ? pages[url] : undefined;
      if (page === undefined) return new Response('not found', { status: 404 });
      if (typeof page === 'string') return new Response(page);
      if ('redirect' in page) return new Response(null, { status: 302, headers: { location: page.redirect } });
      return new Response(page.body);
    };
    return Object.assign(fetchUrl, { seen });
  };

  /** A body that never ends. `state` shows how much was read and whether the reader stopped it. */
  const endlessBody = () => {
    const state = { sent: 0, cancelled: false };
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        state.sent += 16 * 1024;
        controller.enqueue(new Uint8Array(16 * 1024).fill(32));
      },
      cancel() {
        state.cancelled = true;
      },
    });
    return { body, state };
  };

  it('accepts https always and localhost only in developer mode', async () => {
    expect(checkAppUrl('https://a.example/#x', false).toString()).toBe('https://a.example/');
    expect(await codeOf(() => checkAppUrl('http://a.example/', true))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(() => checkAppUrl('http://localhost:5173/', false))).toBe('INVALID_ARGUMENT');
    expect(checkAppUrl('http://localhost:5173/', true).origin).toBe('http://localhost:5173');
  });

  it('validates kobello.json', async () => {
    expect(parseManifest(manifest, origin).id).toBe('com.example.notes');
    const bad = [
      { id: 'Bad ID' }, { id: 'kobello.shell' }, { id: 'con.example' }, { id: `com.${'a'.repeat(100)}` },
      { permissions: ['camera'] }, { permissions: 'storage' },
      { start_url: 'https://evil.example/' }, { start_url: 7 }, { start_url: `/${'a'.repeat(2048)}` },
      { name: 'n'.repeat(81) }, { name: '   ' }, { name: 5 },
      { version: 1 }, { version: '' }, { version: '1'.repeat(51) },
      { description: 'd'.repeat(301) }, { description: ['text'] },
      { icon: 5 }, { icon: `/${'i'.repeat(2048)}` },
      { kobello: 2 },
    ];
    for (const change of bad) {
      expect(await codeOf(() => parseManifest({ ...manifest, ...change }, origin)), JSON.stringify(change).slice(0, 60)).toBe('INVALID_ARGUMENT');
    }
    for (const notAnObject of [null, 'text', 5, []] as unknown[]) expect(await codeOf(() => parseManifest(notAnObject, origin))).toBe('INVALID_ARGUMENT');
  });

  it('returns only the manifest fields it knows', () => {
    const extra = JSON.parse(JSON.stringify({
      ...manifest, name: '  Notes  ', description: 'Simple notes.', start_url: '/app', icon: '/icon.png',
      permissions: ['storage', 'files', 'storage'], sdk: '^1.0.0', admin: true, origin: 'https://evil.example', nested: { a: 1 },
    }).replace('"admin"', '"__proto__":{"x":1},"admin"'));
    const clean = parseManifest(extra, origin);
    expect(clean).toEqual({
      kobello: 1, id: 'com.example.notes', name: 'Notes', version: '1.0.0', description: 'Simple notes.',
      start_url: '/app', icon: '/icon.png', permissions: ['storage', 'files'],
    });
    expect(Object.keys(clean).sort()).toEqual(['description', 'icon', 'id', 'kobello', 'name', 'permissions', 'start_url', 'version']);
    expect(Object.keys(parseManifest(manifest, origin)).sort()).toEqual(['id', 'kobello', 'name', 'permissions', 'version']);
  });

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

  describe('redirects', () => {
    it('follows a kobello.json redirect on the same origin', async () => {
      const result = await inspectUrl('https://notes.example/', fakeFetch({
        'https://notes.example/kobello.json': { redirect: '/static/kobello.json' },
        'https://notes.example/static/kobello.json': JSON.stringify(manifest),
      }), false);
      expect(result.kind).toBe('kobello-app');
    });

    it("doesn't accept a kobello.json that another origin answers for", async () => {
      const fetchUrl = fakeFetch({
        'https://notes.example/kobello.json': { redirect: 'https://evil.example/kobello.json' },
        'https://evil.example/kobello.json': JSON.stringify(manifest),
        'https://notes.example/': '<title>Just a site</title>',
      });
      const result = await inspectUrl('https://notes.example/', fetchUrl, false);
      expect(result).toMatchObject({ kind: 'website', name: 'Just a site' });
      expect(fetchUrl.seen).not.toContain('https://evil.example/kobello.json');
    });

    it('checks every hop like a link the user typed', async () => {
      for (const target of ['http://localhost:8080/admin', 'http://127.0.0.1/', 'http://plain.example/', 'file:///C:/Windows/win.ini', 'ftp://files.example/']) {
        const fetchUrl = fakeFetch({
          'https://site.example/': { redirect: '/next' },
          'https://site.example/next': { redirect: target },
        });
        const result = await inspectUrl('https://site.example/', fetchUrl, false);
        expect(result, target).toEqual({ kind: 'website', url: 'https://site.example/', name: 'site.example', iconUrl: 'https://site.example/favicon.ico' });
        expect(fetchUrl.seen, target).toEqual(['https://site.example/kobello.json', 'https://site.example/', 'https://site.example/next']);
      }
    });

    it('allows a redirect to localhost only in developer mode', async () => {
      const pages = {
        'https://site.example/': { redirect: 'http://localhost:8080/' },
        'http://localhost:8080/': '<title>Local</title>',
      };
      expect(await inspectUrl('https://site.example/', fakeFetch(pages), true)).toMatchObject({ name: 'Local' });
      expect(await inspectUrl('https://site.example/', fakeFetch(pages), false)).toMatchObject({ name: 'site.example' });
    });

    it('reads the page a website redirects to, and resolves its links from there', async () => {
      const result = await inspectUrl('https://site.example/', fakeFetch({
        'https://site.example/': { redirect: 'https://www.site.example/home/' },
        'https://www.site.example/home/': '<title>Home</title><link rel="icon" href="icon.png">',
      }), false);
      expect(result).toEqual({ kind: 'website', url: 'https://site.example/', name: 'Home', iconUrl: 'https://www.site.example/home/icon.png' });
    });

    it('follows at most 5 redirects', async () => {
      const chain = (redirects: number) => {
        const pages: Record<string, Page> = { [`https://site.example/r${redirects}`]: '<title>The end</title>' };
        for (let i = 0; i < redirects; i++) pages[`https://site.example/r${i}`] = { redirect: `/r${i + 1}` };
        return fakeFetch(pages);
      };
      expect(await inspectUrl('https://site.example/r0', chain(5), false)).toMatchObject({ name: 'The end' });

      const tooLong = chain(6);
      expect(await inspectUrl('https://site.example/r0', tooLong, false)).toMatchObject({ name: 'site.example' });
      expect(tooLong.seen).not.toContain('https://site.example/r6');
    });
  });

  describe('size limits', () => {
    it('stops reading a page after 512 KB', async () => {
      const { body, state } = endlessBody();
      const result = await inspectUrl('https://site.example/', fakeFetch({ 'https://site.example/': { body } }), false);
      expect(result).toMatchObject({ kind: 'website', name: 'site.example' });
      expect(state.cancelled).toBe(true);
      expect(state.sent).toBeLessThan(1024 * 1024);
    });

    it('only uses what is in the first 512 KB of a page', async () => {
      const padding = ' '.repeat(512 * 1024);
      const early = await inspectUrl('https://site.example/', fakeFetch({ 'https://site.example/': `<title>Early</title>${padding}` }), false);
      const late = await inspectUrl('https://site.example/', fakeFetch({ 'https://site.example/': `${padding}<title>Late</title>` }), false);
      expect(early).toMatchObject({ name: 'Early' });
      expect(late).toMatchObject({ name: 'site.example' });
    });

    it("doesn't take a kobello.json over 64 KB", async () => {
      const { body, state } = endlessBody();
      const endless = await inspectUrl('https://notes.example/', fakeFetch({ 'https://notes.example/kobello.json': { body } }), false);
      expect(endless.kind).toBe('website');
      expect(state.cancelled).toBe(true);
      expect(state.sent).toBeLessThan(256 * 1024);

      const huge = JSON.stringify({ ...manifest, padding: 'x'.repeat(64 * 1024) });
      expect((await inspectUrl('https://notes.example/', fakeFetch({ 'https://notes.example/kobello.json': huge }), false)).kind).toBe('website');
    });
  });

  describe('icons and web app manifests', () => {
    const appWithIcon = async (icon: string, devMode = false) => inspectUrl('https://notes.example/', fakeFetch({
      'https://notes.example/kobello.json': JSON.stringify({ ...manifest, icon }),
    }), devMode);

    it("drops a Kobello app's icon unless it's https or an inline image", async () => {
      for (const icon of ['http://plain.example/i.png', 'javascript:alert(1)', 'file:///C:/i.png', 'data:text/html,<script>1</script>', 'http://localhost/i.png']) {
        const result = await appWithIcon(icon);
        expect(result.kind, icon).toBe('kobello-app');
        expect(result.iconUrl, icon).toBeUndefined();
      }
      expect((await appWithIcon('https://cdn.example/i.png')).iconUrl).toBe('https://cdn.example/i.png');
      expect((await appWithIcon('icons/i.png')).iconUrl).toBe('https://notes.example/icons/i.png');
      expect((await appWithIcon('data:image/png;base64,AAAA')).iconUrl).toBe('data:image/png;base64,AAAA');
      expect((await appWithIcon('http://localhost/i.png', true)).iconUrl).toBe('http://localhost/i.png');
    });

    it("falls back when a website's icon can't be used", async () => {
      const site = async (html: string, webManifest?: unknown) => inspectUrl('https://site.example/', fakeFetch({
        'https://site.example/': html,
        ...(webManifest === undefined ? {} : { 'https://site.example/m.json': JSON.stringify(webManifest) }),
      }), false);
      const favicon = 'https://site.example/favicon.ico';

      expect((await site('<link rel="icon" href="file:///C:/x.ico">')).iconUrl).toBe(favicon);
      expect((await site('<link rel="icon" href="http://plain.example/x.ico">')).iconUrl).toBe(favicon);
      expect((await site('<link rel="apple-touch-icon" href="javascript:void(0)"><link rel="icon" href="/ok.png">')).iconUrl)
        .toBe('https://site.example/ok.png');
      expect((await site('<link rel="icon" href="data:image/svg+xml,%3Csvg/%3E">')).iconUrl).toBe('data:image/svg+xml,%3Csvg/%3E');

      // The biggest icon in the manifest can't be shown, so the next one is used; with none usable, the page's icon.
      const html = '<link rel="icon" href="/page.png"><link rel="manifest" href="/m.json">';
      const icons = [{ src: 'http://plain.example/big.png', sizes: '512x512' }, { src: '/small.png', sizes: '48x48' }, null, { src: 5 }];
      expect((await site(html, { icons })).iconUrl).toBe('https://site.example/small.png');
      expect((await site(html, { icons: [icons[0]] })).iconUrl).toBe('https://site.example/page.png');
      expect((await site(html, { icons: 'nope' })).iconUrl).toBe('https://site.example/page.png');
    });

    it("ignores a web app manifest on another origin", async () => {
      const fetchUrl = fakeFetch({
        'https://site.example/': '<title>Site</title><link rel="manifest" href="https://evil.example/m.json">',
        'https://evil.example/m.json': JSON.stringify({ name: 'Evil' }),
      });
      expect(await inspectUrl('https://site.example/', fetchUrl, false)).toMatchObject({ name: 'Site' });
      expect(fetchUrl.seen).not.toContain('https://evil.example/m.json');

      const redirected = fakeFetch({
        'https://site.example/': '<title>Site</title><link rel="manifest" href="/m.json">',
        'https://site.example/m.json': { redirect: 'https://evil.example/m.json' },
        'https://evil.example/m.json': JSON.stringify({ name: 'Evil' }),
      });
      expect(await inspectUrl('https://site.example/', redirected, false)).toMatchObject({ name: 'Site' });
      expect(redirected.seen).not.toContain('https://evil.example/m.json');
    });

    it('only takes text as a website name', async () => {
      const named = async (webManifest: unknown) => (await inspectUrl('https://site.example/', fakeFetch({
        'https://site.example/': '<title>Title</title><link rel="manifest" href="/m.json">',
        'https://site.example/m.json': JSON.stringify(webManifest),
      }), false) as { name?: string }).name;

      expect(await named({ name: { toString: 'x' }, short_name: ['a'] })).toBe('Title');
      expect(await named({ name: 42, short_name: 'Short' })).toBe('Short');
      expect(await named({ name: '  ' })).toBe('Title');
      expect(await named(null)).toBe('Title');
      expect(await named({ name: 'n'.repeat(200) })).toBe('n'.repeat(80));
    });
  });
});
