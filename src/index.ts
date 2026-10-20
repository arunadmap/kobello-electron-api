import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { startServer } from './server/server';

declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

// Kobello UI is hosted online. Its service worker caches it, so it keeps working offline
// after the first successful launch.
const TARGET_URL = 'https://kobello-ui.vercel.app/';
const TARGET_ORIGIN = new URL(TARGET_URL).origin;

// Squirrel (the Windows installer) starts the app during install/uninstall; quit right away.
if (require('electron-squirrel-startup')) {
  app.quit();
}

// Only one Kobello window may run. A second launch focuses the existing one instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let serverPort: number | null = null;

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
    if (new URL(event.url).origin !== TARGET_ORIGIN) {
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

  mainWindow.loadURL(TARGET_URL);

  // DevTools only while developing, never in the installed app.
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
};

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  // The local file server is optional for the UI, so a failure must not stop the window from opening.
  try {
    serverPort = await startServer();
  } catch (error) {
    console.error('Local server failed to start:', error);
  }

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

ipcMain.handle('get-server-address', async () => {
  return serverPort ? `http://localhost:${serverPort}/` : null;
});
