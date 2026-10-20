// Answers every SDK call ("kobello:invoke") from Kobello UI and from app views.
//
// For each call:
//   1. Work out who is calling from the sender itself, never from the call's arguments.
//   2. Check the call comes from the main frame and from the app's registered origin.
//   3. Check the app declared the permission the method needs.
//   4. Run the method and send back { ok, value } or { ok: false, error }.

import path from 'path';
import { randomUUID } from 'crypto';
import fs from 'fs';
import { app as electronApp, BrowserWindow, ipcMain, IpcMainInvokeEvent, net, shell } from 'electron';
import { KobelloError } from '@kobello/sdk';
import type { AppInfo, Bounds, EventName, Events, Permission, Response } from '@kobello/sdk/protocol';
import { PROTOCOL_VERSION } from '@kobello/sdk/protocol';
import { DATA_ROOT, fail, requireString, SHELL_APP_ID } from './common';
import { AppFiles } from './files';
import { Notifier } from './notifications';
import { Registry, RegistryApp, toInstalledApp } from './registry';
import { checkAppUrl, inspectUrl } from './site-info';
import { AppStorage } from './storage';
import { AppViews } from './views';

const ALL_PERMISSIONS: Permission[] = ['storage', 'files', 'notifications', 'links'];

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
  preloadPath: string;
}

export function startHost({ window, shellOrigin, devMode, preloadPath }: HostOptions) {
  const registry = new Registry(path.join(DATA_ROOT, SHELL_APP_ID, 'registry.json'));
  const storages = new Map<string, AppStorage>();
  const appDir = (appId: string) => path.join(DATA_ROOT, appId);
  const storageFor = (appId: string) => {
    if (!storages.has(appId)) storages.set(appId, new AppStorage(path.join(appDir(appId), 'storage.json')));
    return storages.get(appId) as AppStorage;
  };
  const filesFor = (appId: string) => new AppFiles(path.join(appDir(appId), 'files'));

  /** Sends a host event to Kobello UI or to an app's view. */
  const emit = <E extends EventName>(appId: string, event: E, payload: Events[E]) => {
    const target = appId === SHELL_APP_ID ? window.webContents : views.webContentsFor(appId);
    target?.send('kobello:event', event, payload);
  };

  const views = new AppViews(window, preloadPath, (number) => emit(SHELL_APP_ID, 'shell.shortcut', { number }));

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

  const shellInfo: AppInfo = { id: SHELL_APP_ID, name: 'Kobello', version: electronApp.getVersion(), permissions: ALL_PERMISSIONS };

  function identify(event: IpcMainInvokeEvent): Caller {
    const frame = event.senderFrame;
    // Only the page itself may call, not iframes inside it.
    if (!frame || frame !== event.sender.mainFrame) fail('PERMISSION_DENIED', 'Only the main page can use Kobello.');
    const origin = new URL(frame.url).origin;

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
    return { x: Math.round(b.x as number), y: Math.round(b.y as number), width: Math.round(b.width as number), height: Math.round(b.height as number) };
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

    'links.open': async (_caller, { url }) => {
      const value = requireString(url, 'URL', 4096);
      if (!/^(https?:|mailto:)/i.test(value)) fail('INVALID_ARGUMENT', 'Only http, https and mailto links can be opened.');
      await shell.openExternal(value);
    },

    'shell.apps.list': () => registry.list().map(toInstalledApp),
    'shell.apps.inspect': (_caller, { url }) => inspectUrl(url, net.fetch, devMode),
    'shell.apps.install': async (_caller, { url, name }) => {
      const result = await inspectUrl(url, net.fetch, devMode);
      const origin = new URL(result.url).origin;
      const displayName = name === undefined ? undefined : requireString(name, 'Name', 80).trim() || undefined;
      let record: RegistryApp;

      if (result.kind === 'kobello-app') {
        const existing = registry.get(result.manifest.id);
        if (existing && existing.origin !== origin) {
          fail('ALREADY_EXISTS', `An app with ID "${result.manifest.id}" is already installed from ${existing.origin}.`);
        }
        record = {
          id: result.manifest.id,
          kind: 'kobello-app',
          name: displayName ?? existing?.name ?? result.manifest.name,
          url: result.url,
          iconUrl: result.iconUrl,
          permissions: result.manifest.permissions,
          origin,
          version: result.manifest.version,
          installedAt: existing?.installedAt ?? new Date().toISOString(),
        };
      } else {
        // The same website twice: keep the one we have.
        const existing = registry.list().find((app) => app.kind === 'website' && app.url === result.url);
        record = existing ?? {
          id: `site-${randomUUID()}`,
          kind: 'website',
          name: displayName ?? result.name ?? new URL(result.url).hostname,
          url: result.url,
          iconUrl: result.iconUrl,
          permissions: [],
          origin,
          installedAt: new Date().toISOString(),
        };
      }

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
      registry.remove(record.id);
      if (deleteData === true) {
        storages.delete(record.id);
        fs.rmSync(appDir(record.id), { recursive: true, force: true });
        await views.clearBrowserData(record.id);
      }
    },
    'shell.views.show': (_caller, { appId, bounds }) => views.show(getApp(appId), checkBounds(bounds)),
    'shell.views.hideAll': () => views.hideAll(),
    'shell.views.reload': (_caller, { appId }) => views.reload(getApp(appId)),
    'shell.views.close': (_caller, { appId }) => views.close(getApp(appId).id),
  };

  ipcMain.handle('kobello:invoke', async (event, request): Promise<Response> => {
    try {
      const method = String(request?.method);
      const caller = identify(event);
      const permission = requiredPermission(method);
      if (permission === 'shell' && !caller.isShell) fail('PERMISSION_DENIED', 'Only Kobello UI can use the shell API.');
      if (permission && permission !== 'shell' && !caller.info.permissions.includes(permission)) {
        fail('PERMISSION_DENIED', `Add "${permission}" to the permissions in kobello.json.`);
      }
      const handler = handlers[method];
      if (!handler) fail('UNSUPPORTED', `This version of Kobello doesn't support "${method}".`);
      return { ok: true, value: await handler(caller, request?.args ?? {}) };
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
