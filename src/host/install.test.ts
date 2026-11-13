import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InspectResult } from '@kobello/sdk/protocol';
import { hasOwn, isExternalLink, RateLimiter, scaleBounds, withTimeout } from './common';
import { checkApprovedPermissions, claimDataFolder, installRecord } from './install';
import { LinkOpener } from './links';
import { Registry } from './registry';
import { allowsWebPermission } from './web-permissions';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kobello-test-')); });
afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Runs fn (sync or async) and returns the KobelloError code it fails with. */
const codeOf = async (fn: () => unknown) => {
  try {
    await fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return 'no error';
};

describe('installing', () => {
  const registry = () => new Registry(path.join(dir, 'registry.json'));
  const notes: InspectResult = {
    kind: 'kobello-app',
    url: 'https://notes.example/',
    iconUrl: 'https://notes.example/icon.png',
    manifest: { kobello: 1, id: 'com.example.notes', name: 'Notes', version: '1.2.0', permissions: ['storage', 'files'] },
  };
  const site: InspectResult = { kind: 'website', url: 'https://site.example/', name: 'Site' };

  it('accepts only a clean list of approved permissions', async () => {
    expect(checkApprovedPermissions([])).toEqual([]);
    expect(checkApprovedPermissions(['files', 'storage'])).toEqual(['files', 'storage']);
    for (const bad of [undefined, null, 'storage', { 0: 'storage' }, ['camera'], ['storage', 'storage'], ['storage', 5], [['storage']]]) {
      expect(await codeOf(() => checkApprovedPermissions(bad)), JSON.stringify(bad)).toBe('INVALID_ARGUMENT');
    }
  });

  it('installs a Kobello app with the permissions the user approved', () => {
    const record = installRecord(notes, ['storage', 'files'], undefined, registry());
    expect(record).toMatchObject({
      id: 'com.example.notes', kind: 'kobello-app', name: 'Notes', origin: 'https://notes.example',
      permissions: ['storage', 'files'], version: '1.2.0',
    });
  });

  it('stores what the app asks for, even if the user approved more', () => {
    const record = installRecord(notes, ['links', 'files', 'storage', 'notifications'], undefined, registry());
    expect(record.permissions).toEqual(['storage', 'files']);
  });

  it('refuses an app that now asks for a permission the user never saw', () => {
    for (const approved of [[], ['storage'], ['files', 'links', 'notifications']] as const) {
      expect(() => installRecord(notes, [...approved], undefined, registry())).toThrowError(
        expect.objectContaining({ code: 'PERMISSION_DENIED', message: 'Notes now asks for different permissions. Check it again.' }),
      );
    }
  });

  it('gives websites no permissions, whatever was approved', () => {
    const record = installRecord(site, ['storage', 'files'], ' My site ', registry());
    expect(record).toMatchObject({ kind: 'website', name: 'My site', permissions: [], origin: 'https://site.example' });
    expect(record.id).toMatch(/^site-/);
  });

  it('keeps the name and install date on reinstall, and refuses the same ID from another origin', async () => {
    const apps = registry();
    const first = installRecord(notes, ['storage', 'files'], 'My notes', apps);
    apps.put({ ...first, installedAt: '2026-01-01T00:00:00.000Z' });

    const again = installRecord({ ...notes, manifest: { ...notes.manifest, version: '2.0.0', permissions: ['storage'] } }, ['storage'], undefined, apps);
    expect(again).toMatchObject({ name: 'My notes', installedAt: '2026-01-01T00:00:00.000Z', version: '2.0.0', permissions: ['storage'] });

    const copycat = { ...notes, url: 'https://evil.example/' };
    expect(await codeOf(() => installRecord(copycat, ['storage', 'files'], undefined, apps))).toBe('ALREADY_EXISTS');
  });

  describe('data folder ownership', () => {
    const appDir = () => path.join(dir, 'data', 'com.example.notes');
    const app = (origin: string) => ({ id: 'com.example.notes', name: 'Notes', origin });
    const owner = () => JSON.parse(fs.readFileSync(path.join(appDir(), 'owner.json'), 'utf8'));

    it('records the origin that first uses an app ID', () => {
      claimDataFolder(appDir(), app('https://notes.example'));
      expect(owner()).toEqual({ origin: 'https://notes.example' });
      claimDataFolder(appDir(), app('https://notes.example')); // the same app again is fine
    });

    it("refuses another origin that claims the same ID, and leaves the owner as it was", () => {
      claimDataFolder(appDir(), app('https://notes.example'));
      expect(() => claimDataFolder(appDir(), app('https://evil.example'))).toThrowError(
        expect.objectContaining({ code: 'PERMISSION_DENIED', message: expect.stringContaining('https://notes.example') }),
      );
      expect(owner()).toEqual({ origin: 'https://notes.example' });
    });

    it('adopts a folder that has data but no owner yet', async () => {
      fs.mkdirSync(path.join(appDir(), 'files'), { recursive: true });
      fs.writeFileSync(path.join(appDir(), 'storage.json'), '{}');
      claimDataFolder(appDir(), app('https://notes.example'));
      expect(owner()).toEqual({ origin: 'https://notes.example' });
      expect(await codeOf(() => claimDataFolder(appDir(), app('https://evil.example')))).toBe('PERMISSION_DENIED');
    });
  });
});

describe('opening links', () => {
  const opener = () => {
    const opened: string[] = [];
    const links = new LinkOpener(async (url) => { opened.push(url); });
    return { links, opened };
  };

  it('opens web and mail links only', async () => {
    const { links, opened } = opener();
    await links.open('app', 'https://example.com/a');
    await links.open('app', 'mailto:hi@example.com');
    for (const bad of ['file:///C:/Windows/win.ini', 'search-ms:query=x', 'ms-msdt:/id', 'javascript:alert(1)', 'C:\\Windows\\notepad.exe', '']) {
      expect(await codeOf(() => links.open('other', bad)), bad).toBe('INVALID_ARGUMENT');
    }
    expect(opened).toEqual(['https://example.com/a', 'mailto:hi@example.com']);
    for (const url of ['http://a.example', 'HTTPS://A.EXAMPLE', 'mailto:a@b.c']) expect(isExternalLink(url), url).toBe(true);
  });

  it('allows each app 5 links every 10 seconds', async () => {
    vi.useFakeTimers();
    const { links, opened } = opener();
    for (let i = 0; i < 5; i++) await links.open('app', `https://example.com/${i}`);
    expect(await codeOf(() => links.open('app', 'https://example.com/6'))).toBe('RATE_LIMITED');
    await links.open('another-app', 'https://example.com/other'); // each app has its own limit
    expect(opened).toHaveLength(6);

    vi.advanceTimersByTime(10_000);
    await links.open('app', 'https://example.com/later');
    expect(opened).toHaveLength(7);
  });

  it('passes on a failure to open the link', async () => {
    const links = new LinkOpener(async () => { throw new Error('no browser'); });
    await expect(links.open('app', 'https://example.com/')).rejects.toThrow('no browser');
  });
});

describe('helpers', () => {
  it('RateLimiter counts actions per key inside a moving window', () => {
    const limiter = new RateLimiter(2, 1000);
    expect([limiter.take('a', 0), limiter.take('a', 100), limiter.take('a', 200)]).toEqual([true, true, false]);
    expect(limiter.take('b', 200)).toBe(true);
    expect(limiter.take('a', 999)).toBe(false);  // refused tries don't use up the window
    expect(limiter.take('a', 1000)).toBe(true);  // the first action is a second old now
    expect(limiter.take('a', 1050)).toBe(false);
    expect(limiter.take('a', 1100)).toBe(true);
  });

  it('withTimeout gives up on a promise that never settles', async () => {
    vi.useFakeTimers();
    const never = withTimeout(new Promise<boolean>(() => undefined), 35_000, false);
    const quick = withTimeout(Promise.resolve(true), 35_000, false);
    expect(await quick).toBe(true);
    expect(vi.getTimerCount()).toBe(1); // the finished one cleaned up its timer
    await vi.advanceTimersByTimeAsync(35_000);
    expect(await never).toBe(false);
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000, false)).rejects.toThrow('boom');
  });

  it('scaleBounds turns CSS pixels into window pixels', () => {
    expect(scaleBounds({ x: 240, y: 0, width: 760, height: 700 }, 1)).toEqual({ x: 240, y: 0, width: 760, height: 700 });
    expect(scaleBounds({ x: 10, y: 21, width: 300, height: 401 }, 1.25)).toEqual({ x: 13, y: 26, width: 375, height: 501 });
    expect(scaleBounds({ x: 240, y: 10, width: 760, height: 700 }, 0.5)).toEqual({ x: 120, y: 5, width: 380, height: 350 });
  });

  it('hasOwn ignores what every object inherits', () => {
    const handlers = { 'host.info': () => 1 };
    expect(hasOwn(handlers, 'host.info')).toBe(true);
    for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) expect(hasOwn(handlers, key), key).toBe(false);
  });

  it('pages get no web permission except writing to the clipboard', () => {
    expect(allowsWebPermission('clipboard-sanitized-write')).toBe(true);
    const denied = [
      'openExternal', 'media', 'geolocation', 'notifications', 'clipboard-read', 'display-capture', 'fullscreen', 'pointerLock',
      'midi', 'midiSysex', 'hid', 'serial', 'usb', 'fileSystem', 'idle-detection', 'storage-access', 'unknown', '',
    ];
    for (const permission of denied) expect(allowsWebPermission(permission), permission).toBe(false);
  });
});
