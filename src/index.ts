import { app, BrowserWindow, shell } from 'electron';
import { startHost } from './host/router';

declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

// Developer mode: running from source, or KOBELLO_DEV=1. It allows http://localhost apps and
// lets KOBELLO_UI_URL point the window at a local Kobello UI (e.g. http://localhost:5173/).
const DEV_MODE = !app.isPackaged || process.env.KOBELLO_DEV === '1';

// Kobello UI is hosted online. Its service worker caches it, so it keeps working offline
// after the first successful launch.
const SHELL_URL = (DEV_MODE && process.env.KOBELLO_UI_URL) || 'https://kobello-ui.vercel.app/';
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

/** Links that may be handed to the user's default browser. */
const isExternalLink = (url: string) => /^(https?:|mailto:)/i.test(url);

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    height: 700,
    width: 1000,
    autoHideMenuBar: true,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // Keep the window on Kobello UI. Links that try to leave it open in the default browser.
  mainWindow.webContents.on('will-navigate', (event) => {
    if (new URL(event.url).origin !== SHELL_ORIGIN) {
      event.preventDefault();
      if (isExternalLink(event.url)) shell.openExternal(event.url);
    }
  });

  // New windows (target="_blank", window.open) open in the default browser, never inside Electron.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalLink(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Answers SDK calls from Kobello UI and from the apps shown in this window.
  startHost({
    window: mainWindow,
    shellOrigin: SHELL_ORIGIN,
    devMode: DEV_MODE,
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

app.whenReady().then(createWindow);

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
