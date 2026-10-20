// One native view (WebContentsView) per app, placed over Kobello UI's content area.
//
// Offline: every view uses a persistent session ("persist:app-<id>"), so the app's service worker
// and its caches survive restarts. Nothing here intercepts the app's requests, which would get
// in the service worker's way.

import { BrowserWindow, Rectangle, session, shell, WebContentsView } from 'electron';
import type { RegistryApp } from './registry';

const WARM_UP_TIMEOUT_MS = 30_000;

export const partitionFor = (appId: string) => `persist:app-${appId}`;

const isExternalLink = (url: string) => /^(https?:|mailto:)/i.test(url);

/** Starts loading a page. Failures are handled by the 'did-fail-load' listener, so the promise is ignored. */
const load = (contents: Electron.WebContents, url: string): void => {
  contents.loadURL(url).catch(() => {
    // Shown by the 'did-fail-load' listener.
  });
};

/** Shown instead of Chromium's error page when an app can't load. */
function offlinePage(app: RegistryApp): string {
  const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const html = `<!doctype html><meta charset="utf-8"><title>${escape(app.name)}</title>
<body style="font:15px system-ui;display:grid;place-content:center;height:100vh;margin:0;text-align:center;color:#555">
<h2 style="color:#222;margin:0 0 8px">${escape(app.name)} can't open right now</h2>
<p style="margin:0 0 20px">You're offline, and this app hasn't been saved for offline use yet.</p>
<a href="${escape(app.url)}" style="color:#3c7255;font-weight:600">Try again</a></body>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export class AppViews {
  private views = new Map<string, WebContentsView>();
  /** webContents id → app id, so IPC calls can be traced back to their app. */
  private owners = new Map<number, string>();

  constructor(
    private readonly window: BrowserWindow,
    private readonly preloadPath: string,
    private readonly onShortcut: (number: number) => void,
  ) {}

  /** The app a webContents belongs to, if it's one of our app views. */
  appIdFor(webContentsId: number): string | undefined {
    return this.owners.get(webContentsId);
  }

  webContentsFor(appId: string) {
    return this.views.get(appId)?.webContents;
  }

  /** Shows this app at these bounds and hides every other app. */
  show(app: RegistryApp, bounds: Rectangle): void {
    const view = this.ensure(app);
    if (!this.window.contentView.children.includes(view)) this.window.contentView.addChildView(view);
    view.setBounds(bounds);
    for (const [id, other] of this.views) other.setVisible(id === app.id);
  }

  hideAll(): void {
    for (const view of this.views.values()) view.setVisible(false);
  }

  reload(app: RegistryApp): void {
    const contents = this.views.get(app.id)?.webContents;
    if (!contents) return;
    // From the offline page, go back to the app instead of reloading the error page.
    if (contents.getURL().startsWith('data:')) load(contents, app.url);
    else contents.reload();
  }

  close(appId: string): void {
    const view = this.views.get(appId);
    if (!view) return;
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(view);
    this.owners.delete(view.webContents.id);
    this.views.delete(appId);
    view.webContents.close();
  }

  closeAll(): void {
    for (const appId of [...this.views.keys()]) this.close(appId);
  }

  /**
   * Loads the app once, out of sight, and waits until its service worker is active,
   * so it opens offline even if the user never used it while online.
   * Returns true when the app is ready for offline use.
   */
  async warmUp(app: RegistryApp): Promise<boolean> {
    const contents = this.ensure(app).webContents;
    if (contents.isLoading()) {
      await new Promise<void>((resolve) => contents.once('did-stop-loading', () => resolve()));
    }
    if (contents.getURL().startsWith('data:')) return false; // it failed to load
    try {
      // Give the page a few seconds to register its service worker (many do it after the load event),
      // then wait for it to become active, which happens once it has cached the app.
      return (await contents.executeJavaScript(`(async () => {
        if (!('serviceWorker' in navigator)) return false;
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        for (let i = 0; i < 20 && !(await navigator.serviceWorker.getRegistration()); i++) await wait(250);
        if (!(await navigator.serviceWorker.getRegistration())) return false;
        return Promise.race([navigator.serviceWorker.ready.then(() => true), wait(${WARM_UP_TIMEOUT_MS}).then(() => false)]);
      })()`)) === true;
    } catch {
      return false;
    }
  }

  /** Clears the app's browser data: service worker, caches, IndexedDB, cookies and the HTTP cache. */
  async clearBrowserData(appId: string): Promise<void> {
    const appSession = session.fromPartition(partitionFor(appId));
    await appSession.clearStorageData();
    await appSession.clearCache();
  }

  /** Returns the app's view, creating and loading it on first use. */
  private ensure(app: RegistryApp): WebContentsView {
    const existing = this.views.get(app.id);
    if (existing) return existing;

    const view = new WebContentsView({
      webPreferences: {
        partition: partitionFor(app.id),
        // Only Kobello apps get the SDK; plain websites run with no preload at all.
        preload: app.kind === 'kobello-app' ? this.preloadPath : undefined,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    view.setVisible(false);
    const contents = view.webContents;

    // New windows and target="_blank" links open in the default browser.
    contents.setWindowOpenHandler(({ url }) => {
      if (isExternalLink(url)) shell.openExternal(url);
      return { action: 'deny' };
    });

    // Replace Chromium's error page with our own. Code -3 means the load was replaced by another one.
    contents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) load(contents, offlinePage(app));
    });

    // Ctrl/Cmd+1–9 switch apps even while an app has focus.
    contents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && (input.control || input.meta) && /^[1-9]$/.test(input.key)) {
        event.preventDefault();
        this.onShortcut(Number(input.key));
      }
    });

    this.views.set(app.id, view);
    this.owners.set(contents.id, app.id);
    load(contents, app.url);
    return view;
  }
}
