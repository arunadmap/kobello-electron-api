import path from 'path';
import { app, BrowserWindow, Menu, nativeTheme, session, shell } from 'electron';
import { isExternalLink } from './host/common';
import { startHost } from './host/router';
import { denyWebPermissions } from './host/web-permissions';

declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

// Developer mode: running from source, or KOBELLO_DEV=1. It allows http://localhost apps.
const DEV_MODE = !app.isPackaged || process.env.KOBELLO_DEV === '1';

// Which Kobello UI the window shows:
// - running from source (npm start): the local dev server of the Kobello UI project (npm run dev there),
// - the installed app: the published Kobello UI. Its service worker caches it, so it keeps
//   working offline after the first successful launch.
// KOBELLO_UI_URL can point a build run from source at another Kobello UI. The installed app ignores it,
// even with KOBELLO_DEV=1: whatever page the window shows controls every app and all their data.
const LOCAL_UI_URL = 'http://127.0.0.1:5173/';
const PUBLISHED_UI_URL = 'https://kobello-ui.vercel.app/';
const SHELL_URL = app.isPackaged ? PUBLISHED_UI_URL : (process.env.KOBELLO_UI_URL || LOCAL_UI_URL);
const SHELL_ORIGIN = new URL(SHELL_URL).origin;

// Squirrel (the Windows installer) starts the app during install/uninstall; quit right away.
if (require('electron-squirrel-startup')) {
  app.quit();
}

// Only one Kobello window may run. A second launch focuses the existing one instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// Windows shows notifications under this ID. It must match the one Squirrel gives the installed app.
app.setAppUserModelId(app.isPackaged ? 'com.squirrel.kobello.Kobello' : process.execPath);

let mainWindow: BrowserWindow | null = null;

/** True for pages of Kobello UI itself, the only pages the window may show. */
const isShellUrl = (url: string): boolean => {
  try {
    return new URL(url).origin === SHELL_ORIGIN;
  } catch {
    return false;
  }
};

// Every session denies web permissions (camera, location, ...) by default. App sessions are created
// later, one per app, so this listens for new sessions; it's in place before any page loads.
app.on('session-created', denyWebPermissions);

/** Opens a link from Kobello UI in the user's default browser or mail app. */
const openExternal = (url: string): void => {
  if (!isExternalLink(url)) return;
  shell.openExternal(url).catch((error) => console.error(`Couldn't open ${url}:`, error));
};

/**
 * The installed app's menu: only what's needed for the usual shortcuts (copy, paste, quit, close).
 * No reload, page zoom or DevTools items. Running from source keeps Electron's default menu.
 */
const setMinimalMenu = (): void => {
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' } as const] : []),
    { role: 'editMenu' },
    ...(isMac ? [{ role: 'windowMenu' } as const] : []),
  ]));
};

/** Shown when Kobello UI has never been downloaded and there's no internet. */
const firstLaunchOfflinePage = () => `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<meta charset="utf-8"><title>Kobello</title>
<body style="font:15px system-ui;display:grid;place-content:center;height:100vh;margin:0;text-align:center;color:#555">
<h2 style="color:#222;margin:0 0 8px">Connect to the internet to set up Kobello</h2>
<p style="margin:0 0 20px">Kobello needs the internet the first time it opens. After that it works offline.</p>
<a href="${SHELL_URL}" style="color:#3355ff;font-weight:600">Try again</a></body>`)}`;

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    height: 700,
    width: 1000,
    autoHideMenuBar: true,
    // Kobello UI's desk colour, so the window doesn't flash white before the UI paints.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111215' : '#f3f2ee',
    // The installed app takes its icon from Kobello.exe; running from source, point at the file.
    icon: app.isPackaged ? undefined : path.join(app.getAppPath(), 'assets', 'icon.ico'),
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: !app.isPackaged,
    },
  });

  // Keep the window on Kobello UI. Links that try to leave it open in the default browser.
  // Redirects are checked too: a Kobello UI link could answer with a redirect to another site.
  const stayOnKobelloUi = (event: Electron.Event, url: string, isMainFrame: boolean) => {
    if (!isMainFrame || isShellUrl(url)) return;
    event.preventDefault();
    openExternal(url);
  };
  mainWindow.webContents.on('will-navigate', (event) => stayOnKobelloUi(event, event.url, event.isMainFrame));
  mainWindow.webContents.on('will-redirect', (event) => stayOnKobelloUi(event, event.url, event.isMainFrame));

  // New windows (target="_blank", window.open) open in the default browser, never inside Electron.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });

  // The first launch needs the internet to download Kobello UI (later launches use its cache).
  // Without it, show a short message instead of Chromium's error page. Code -3 means the load was replaced.
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) {
      mainWindow?.loadURL(firstLaunchOfflinePage()).catch(() => {
        // Nothing else to show.
      });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Answers SDK calls from Kobello UI and from the apps shown in this window.
  startHost({
    window: mainWindow,
    shellOrigin: SHELL_ORIGIN,
    devMode: DEV_MODE,
    devTools: !app.isPackaged,
    preloadPath: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
  });

  mainWindow.loadURL(SHELL_URL);

  // DevTools only while developing, never in the installed app.
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
};

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(() => {
  denyWebPermissions(session.defaultSession);
  if (app.isPackaged) setMinimalMenu();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
