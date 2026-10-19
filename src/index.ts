
import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { startServer } from './server/server';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

if (require('electron-squirrel-startup')) {
  app.quit();
}

let serverPort: number | null = null;

// Base storage path
const userHomeDir = app.getPath('home');
const staticPath = path.join(userHomeDir, 'kobello', 'apps');

// App folder configuration
const APP_NAME = 'kobello-ui';
const TARGET_URL = 'https://kobello-ui.vercel.app/';
const APP_STORAGE_DIR = path.join(staticPath, APP_NAME);

/**
 * Downloads a web app's HTML and assets to the specified folder
 */
async function downloadPWA(url: string, outputDir: string): Promise<void> {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const hiddenWin = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true },
  });

  console.log(`Downloading PWA from ${url}...`);
  await hiddenWin.loadURL(url);

  // Give the client-side SPA bundle time to hydrate/render
  await new Promise((resolve) => setTimeout(resolve, 3500));

  const indexPath = path.join(outputDir, 'index.html');
  await hiddenWin.webContents.savePage(indexPath, 'HTMLComplete');
  hiddenWin.destroy();
  console.log(`PWA downloaded successfully to: ${outputDir}`);
}

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    height: 700,
    width: 1000,
    autoHideMenuBar: true,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      webSecurity: false, // Allows cross-origin CDN and asset loading
    },
  });

  // Loosen CSP headers to allow downloaded assets and external APIs to connect
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; " +
          "connect-src * http://localhost:* ws://localhost:*; " +
          "frame-src * http://localhost:*;"
        ],
        'Access-Control-Allow-Origin': ['*'],
      },
    });
  });

  // If your server serves staticPath directly, access the app via its folder name:
  mainWindow.loadURL(`http://localhost:${serverPort}/${APP_NAME}/index.html`);
  mainWindow.webContents.openDevTools();
};

app.whenReady().then(async () => {
  // Ensure the base directory exists
  if (!fs.existsSync(staticPath)) {
    fs.mkdirSync(staticPath, { recursive: true });
  }

  // Download the PWA if it hasn't been cached yet
  const indexFile = path.join(APP_STORAGE_DIR, 'index.html');
  if (!fs.existsSync(indexFile)) {
    await downloadPWA(TARGET_URL, APP_STORAGE_DIR);
  }

  // Fixed: startServer takes 0 arguments
  serverPort = await startServer();
  console.log(`Server running at http://localhost:${serverPort}/`);

  // Open window after server is ready
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
  return `http://localhost:${serverPort ?? 0}/`;
});