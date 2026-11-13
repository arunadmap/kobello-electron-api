// Answers every SDK call ("kobello:invoke") from Kobello UI and from app views.
//
// For each call:
//   1. Work out who is calling from the sender itself, never from the call's arguments.
//   2. Check the call comes from the main frame and from the app's registered origin.
//   3. Check the app has the permission the method needs (declared in kobello.json, approved at install).
//   4. Run the method and send back { ok, value } or { ok: false, error }.

import path from 'path';
import fs from 'fs';
import { app as electronApp, BrowserWindow, ipcMain, IpcMainInvokeEvent, shell } from 'electron';
import { KobelloError } from '@kobello-electron/sdk';
import type { AppInfo, Bounds, EventName, Events, Permission, Response } from '@kobello-electron/sdk/protocol';
import { PROTOCOL_VERSION } from '@kobello-electron/sdk/protocol';
import { DATA_ROOT, fail, hasOwn, PERMISSIONS, requireString, SHELL_APP_ID } from './common';
import { AppFiles } from './files';
import { checkApprovedPermissions, claimDataFolder, installRecord } from './install';
import { LinkOpener } from './links';
import { fetchWithoutRedirects } from './net-fetch';
import { Notifier } from './notifications';
import { Registry, RegistryApp, toInstalledApp } from './registry';
import { checkAppUrl, inspectUrl } from './site-info';
import { AppStorage } from './storage';
import { AppViews } from './views';

/** Who made a call. Kobello UI is the "shell" and may use every method. */
interface Caller {
  info: AppInfo;
  isShell: boolean;
}

export interface HostOptions {
  window: BrowserWindow;
  /** Kobello UI's origin; only this origin in the main window gets the shell API. */
  shellOrigin: string;
  /** Allows http://localhost apps. */
  devMode: boolean;
  /** Lets developers open DevTools on app views. */
  devTools: boolean;
  preloadPath: string;
}

export function startHost({ window, shellOrigin, devMode, devTools, preloadPath }: HostOptions) {
  const registry = new Registry(path.join(DATA_ROOT, SHELL_APP_ID, 'registry.json'));
  const appDir = (appId: string) => path.join(DATA_ROOT, appId);
  // One storage and one files object per app, kept for the whole run: they remember sizes for the quotas.
  const storages = new Map<string, AppStorage>();
  const storageFor = (appId: string) => {
    if (!storages.has(appId)) storages.set(appId, new AppStorage(path.join(appDir(appId), 'storage.json')));
    return storages.get(appId) as AppStorage;
  };
  const files = new Map<string, AppFiles>();
  const filesFor = (appId: string) => {
    if (!files.has(appId)) files.set(appId, new AppFiles(path.join(appDir(appId), 'files')));
    return files.get(appId) as AppFiles;
  };

  // Apps installed before data folders had owners: mark their folders now, while we know whose they are.
  for (const record of registry.list()) {
    if (record.kind !== 'kobello-app') continue;
    try {
      claimDataFolder(appDir(record.id), record);
    } catch (error) {
      console.error(`Couldn't mark the data folder of ${record.id}:`, error);
    }
  }

  /**
   * Sends a host event to Kobello UI or to an app's view, but only while that page is still on
   * its own origin: an app that navigated elsewhere must not hear its events there.
   */
  const emit = <E extends EventName>(appId: string, event: E, payload: Events[E]) => {
    if (window.isDestroyed()) return;
    const target = appId === SHELL_APP_ID ? window.webContents : views.webContentsFor(appId);
    const origin = appId === SHELL_APP_ID ? shellOrigin : registry.get(appId)?.origin;
    if (!target || target.isDestroyed() || target.mainFrame.origin !== origin) return;
    target.send('kobello:event', event, payload);
  };

  const links = new LinkOpener((url) => shell.openExternal(url));
  const views = new AppViews({
    window,
    preloadPath,
    devTools,
    links,
    onShortcut: (number) => emit(SHELL_APP_ID, 'shell.shortcut', { number }),
  });

  const notifier = new Notifier((appId, id, tag) => {
    // Bring Kobello forward, then tell the app its notification was clicked.
    if (window.isMinimized()) window.restore();
    window.focus();
    emit(appId, 'notification.clicked', { id, tag });
  });

  // Ctrl/Cmd+1–9 while Kobello UI itself has focus.
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.control || input.meta) && /^[1-9]$/.test(input.key)) {
      event.preventDefault();
      emit(SHELL_APP_ID, 'shell.shortcut', { number: Number(input.key) });
    }
  });

  const shellInfo: AppInfo = { id: SHELL_APP_ID, name: 'Kobello', version: electronApp.getVersion(), permissions: [...PERMISSIONS] };

  function identify(event: IpcMainInvokeEvent): Caller {
    const frame = event.senderFrame;
    // Only the page itself may call, not iframes inside it.
    if (!frame || frame !== event.sender.mainFrame) fail('PERMISSION_DENIED', 'Only the main page can use Kobello.');
    // The origin as Chromium sees it ("null" for data: pages and sandboxed frames), not one parsed from a URL.
    const { origin } = frame;

    if (event.sender === window.webContents) {
      if (origin !== shellOrigin) fail('PERMISSION_DENIED', 'This page is not Kobello UI.');
      return { info: shellInfo, isShell: true };
    }

    const appId = views.appIdFor(event.sender.id);
    const record = appId ? registry.get(appId) : undefined;
    if (!record || record.kind !== 'kobello-app') fail('PERMISSION_DENIED', 'Only installed Kobello apps can use Kobello.');
    // The app may have navigated elsewhere (a login page, an ad). Only its own origin may call.
    if (origin !== record.origin) fail('PERMISSION_DENIED', `Calls are only allowed from ${record.origin}.`);
    return {
      info: { id: record.id, name: record.name, version: record.version ?? '', permissions: record.permissions },
      isShell: false,
    };
  }

  /** The permission a method needs, or 'shell' for Kobello UI-only methods. */
  function requiredPermission(method: string): Permission | 'shell' | null {
    const area = method.split('.')[0];
    if (area === 'shell') return 'shell';
    if (area === 'storage' || area === 'files' || area === 'notifications' || area === 'links') return area;
    return null; // host.info and app.info need no permission
  }

  function getApp(appId: unknown): RegistryApp {
    const record = registry.get(requireString(appId, 'App ID', 200));
    return record ?? fail('NOT_FOUND', `No installed app with ID "${appId}".`);
  }

  function checkBounds(value: unknown): Bounds {
    const b = (value ?? {}) as Record<string, unknown>;
    const ok = ['x', 'y', 'width', 'height'].every((key) => typeof b[key] === 'number' && Number.isFinite(b[key]) && (b[key] as number) >= 0);
    if (!ok) fail('INVALID_ARGUMENT', 'Bounds need x, y, width and height as numbers ≥ 0.');
    return { x: b.x as number, y: b.y as number, width: b.width as number, height: b.height as number };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Handler = (caller: Caller, args: any) => unknown;
  const handlers: Record<string, Handler> = {
    'host.info': () => ({ version: electronApp.getVersion(), platform: process.platform, protocol: PROTOCOL_VERSION }),
    'app.info': (caller) => caller.info,

    'storage.get': (caller, { key }) => storageFor(caller.info.id).get(key),
    'storage.set': (caller, { key, value }) => storageFor(caller.info.id).set(key, value),
    'storage.delete': (caller, { key }) => storageFor(caller.info.id).delete(key),
    'storage.keys': (caller) => storageFor(caller.info.id).keys(),
    'storage.clear': (caller) => storageFor(caller.info.id).clear(),

    'files.read': (caller, { path: p, encoding }) => filesFor(caller.info.id).read(p, encoding),
    'files.write': (caller, { path: p, data, createDirs }) => filesFor(caller.info.id).write(p, data, createDirs),
    'files.delete': (caller, { path: p }) => filesFor(caller.info.id).delete(p),
    'files.list': (caller, { dir }) => filesFor(caller.info.id).list(dir ?? ''),
    'files.stat': (caller, { path: p }) => filesFor(caller.info.id).stat(p),
    'files.mkdir': (caller, { path: p }) => filesFor(caller.info.id).mkdir(p),
    'files.rename': (caller, { from, to }) => filesFor(caller.info.id).rename(from, to),

    'notifications.show': (caller, options) => notifier.show(caller.info.id, caller.info.name, options),

    'links.open': (caller, { url }) => links.open(caller.info.id, requireString(url, 'URL', 4096)),

    'shell.apps.list': () => registry.list().map(toInstalledApp),
    'shell.apps.inspect': (_caller, { url }) => inspectUrl(url, fetchWithoutRedirects, devMode),
    'shell.apps.install': async (_caller, { url, name, permissions }) => {
      const approved = checkApprovedPermissions(permissions);
      // Look at the site again: what gets installed is what it serves now, checked against what the user approved.
      const result = await inspectUrl(url, fetchWithoutRedirects, devMode);
      const record = installRecord(result, approved, name, registry);
      if (record.kind === 'kobello-app') claimDataFolder(appDir(record.id), record);
      registry.put(record);
      // Load the app once now, so its service worker caches it for offline use.
      const offlineReady = await views.warmUp(record);
      return { ...toInstalledApp(record), offlineReady };
    },
    'shell.apps.update': (_caller, { appId, name, iconUrl }) => {
      const record = { ...getApp(appId) };
      if (name !== undefined) record.name = requireString(name, 'Name', 80).trim() || record.name;
      if (iconUrl !== undefined) {
        // An empty string removes the icon (Kobello UI then shows a letter).
        record.iconUrl = iconUrl === '' ? undefined : checkAppUrl(iconUrl, devMode).toString();
      }
      registry.put(record);
      return toInstalledApp(record);
    },
    'shell.apps.uninstall': async (_caller, { appId, deleteData }) => {
      const record = getApp(appId);
      views.close(record.id);
      if (deleteData === true) {
        // Delete first and forget the app last: if deleting fails, the app stays in the list and
        // the user can try again, instead of data left behind with no app to remove it by.
        storages.delete(record.id);
        files.delete(record.id);
        try {
          await views.clearBrowserData(record.id);
          await fs.promises.rm(appDir(record.id), { recursive: true, force: true });
        } catch (error) {
          console.error(`Couldn't delete the data of ${record.id}:`, error);
          fail('INTERNAL', `Couldn't delete everything ${record.name} saved. Try removing it again.`);
        }
      }
      registry.remove(record.id);
    },
    'shell.views.show': (_caller, { appId, bounds }) => views.show(getApp(appId), checkBounds(bounds)),
    'shell.views.hideAll': () => views.hideAll(),
    'shell.views.reload': (_caller, { appId }) => views.reload(getApp(appId)),
    'shell.views.close': (_caller, { appId }) => views.close(getApp(appId).id),
  };

  ipcMain.handle('kobello:invoke', async (event, request): Promise<Response> => {
    try {
      const method = String(request?.method);
      if (request?.v !== PROTOCOL_VERSION) fail('UNSUPPORTED', "This page's Kobello SDK and this version of Kobello don't work together.");
      const caller = identify(event);
      const permission = requiredPermission(method);
      if (permission === 'shell' && !caller.isShell) fail('PERMISSION_DENIED', 'Only Kobello UI can use the shell API.');
      if (permission && permission !== 'shell' && !caller.info.permissions.includes(permission)) {
        fail('PERMISSION_DENIED', `Add "${permission}" to the permissions in kobello.json.`);
      }
      // Own keys only: "constructor" is on every object, but it isn't a method of the host.
      if (!hasOwn(handlers, method)) fail('UNSUPPORTED', `This version of Kobello doesn't support "${method}".`);
      return { ok: true, value: await handlers[method](caller, request.args ?? {}) };
    } catch (error) {
      if (error instanceof KobelloError) return { ok: false, error: { code: error.code, message: error.message } };
      console.error('Kobello host error:', error);
      return { ok: false, error: { code: 'INTERNAL', message: 'Something went wrong in Kobello.' } };
    }
  });

  // Views belong to the window; close them with it.
  window.on('closed', () => {
    views.closeAll();
    ipcMain.removeHandler('kobello:invoke');
  });
}
