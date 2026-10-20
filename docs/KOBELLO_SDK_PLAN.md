# Kobello SDK — Plan

Status: decisions agreed · 2026-10-20

This plan covers three projects that have to change together:

| Project | Path | Role |
|---|---|---|
| **kobello-electron** | `C:\Users\Pasin\Desktop\Projects\kobello-electron-api` | Desktop host. Owns disk, notifications and windows. Answers every SDK call. |
| **Kobello UI** | `C:\Users\Pasin\Desktop\Projects\Kobello` | The shell (sidebar, add app, app views). Hosted on Vercel, loaded by Electron. A privileged app. |
| **kobello-package** (the SDK) | `C:\Users\Pasin\Desktop\Projects\kobello-package` | The npm package. The only way Kobello UI and Kobello apps talk to the host. |

Plus a fourth deliverable: an **open-source developer guide** for building Kobello apps.

---

## 1. Decisions so far

| # | Question | Decision |
|---|---|---|
| 1 | Should Kobello UI and apps work in a normal browser? | **No, for now.** Electron only. Keep the design open to a browser fallback later. |
| 2 | Which apps get the SDK? | **Only apps built for Kobello**, meaning apps that publish a Kobello manifest (section 5). An approval process comes later. Plain websites can still be added to the sidebar, but they get **no** SDK access. |
| 3 | What the SDK covers in v1 | **Files, key/value storage, notifications, opening links, the app's own info.** |
| 4 | Package name | **`@kobello/sdk`** (npm scope `@kobello`). |
| 5 | Where app data lives | **`~/kobello/data/<appId>/`**. |
| 6 | Uninstalling an app | **Ask** whether to delete its data, with "Keep data" preselected. |
| 7 | Electron app name | **Rename `my-app` to `kobello`** (done). |
| 8 | Offline | **Every app added to Kobello is a PWA and must work offline** after it's installed (section 5.1). |

### Design choices behind the plan

| Topic | Choice | Why |
|---|---|---|
| Package name | `@kobello/sdk` (npm scope `@kobello`) | Easy to find, and room for `@kobello/create-app` etc. later. The current name `kobello-package` is generic. |
| How calls travel | **Electron IPC through a preload script**, not HTTP to `localhost:5050` | The host knows exactly which app is calling, and no network port is open (see section 2). |
| Where apps run | One **`WebContentsView` per app** (Kobello UI's `showApp` bridge already expects this) | Each app gets its own preload, its own storage partition, and a known identity. |
| Where data lives | `~/kobello/data/<appId>/` (`storage.json` + `files/`) | Keeps the existing `~/kobello` convention, and users can find their files. |
| App ID format | Reverse domain, e.g. `com.example.notes` | Stable, readable, and doesn't change if the app moves to a new URL. |

---

## 2. Why the current package has to change

`kobello-package` today calls `fetch('http://localhost:5050/api/v1/file/...')`. That doesn't work for an app platform:

1. **The host can't tell callers apart.** Any website open in the user's browser, or any program on the computer, can call `localhost:5050`. The Express server has open CORS and file paths that can escape the folder, so today any website can read, write or delete the user's files. With third-party apps, the host must know *which app* is calling and limit it to its own data.
2. **The port isn't fixed.** If 5050 is in use, the server falls back to a random port, and every hardcoded URL breaks.
3. **The build targets the wrong environment.** It's CommonJS for Node 14, but the callers are web pages. It needs to ship as an ES module.
4. **Errors are swallowed.** Functions log with `console.error` and return `null`, so callers can't tell "not found" from "permission denied" from "host not running".

The new design keeps the package easy to use (`await kobello.files.write(...)`) and replaces what's underneath.

---

## 3. Architecture

```
┌──────────────────────────── Electron main process ────────────────────────────┐
│  ipcMain.handle('kobello:invoke')                                              │
│     1. identify caller: event.sender → registered view → appId                │
│     2. check sender URL is still on the app's registered origin                │
│     3. check permission (manifest) → validate args → run handler              │
│  Handlers: app.* · storage.* · files.* · notifications.* · links.*            │
│  Shell-only handlers: shell.* (app list views, site info, shortcuts)          │
│  Disk: ~/kobello/data/<appId>/{storage.json, files/}                          │
└───────────────▲───────────────────────────────────────▲────────────────────────┘
                │ IPC                                   │ IPC
┌───────────────┴────────────┐          ┌───────────────┴─────────────────────────┐
│ Shell window (BrowserWindow)│          │ App views (one WebContentsView each)     │
│  Kobello UI (Vercel URL)    │          │  Kobello app (any https URL + manifest)  │
│  preload: shell-preload     │          │  preload: app-preload                    │
│  window.__kobello (+ shell) │          │  window.__kobello                        │
│  └─ @kobello/sdk            │          │  └─ @kobello/sdk                         │
└─────────────────────────────┘          └──────────────────────────────────────────┘
    Plain websites (no manifest) → WebContentsView with NO preload, no SDK
```

### Key rules
- **Identity comes from the host, never from the caller.** Main keeps a `Map<webContents.id, AppRecord>` filled when it creates each view. A call's `appId` comes from `event.sender`, never from the call's arguments.
- **Origin check on every call.** If an app view navigates to a different origin (a login page, an ad), the SDK stops working there: `event.senderFrame.url` must match the app's registered origin.
- **Main frame only.** Calls from iframes inside an app are rejected (`event.senderFrame` must be the main frame).
- **Kobello UI is a system app** (`appId: "kobello.shell"`). Only the shell window's webContents gets the `shell.*` methods, and only while it's on the configured Kobello UI origin (`TARGET_URL`, plus `http://localhost:5173` in developer mode).
- **Every view:** `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, and a per-app session `partition: 'persist:app-<appId>'` so apps can't read each other's cookies or localStorage.

### Wire protocol (internal, versioned)
One IPC channel, `kobello:invoke`:

```ts
// request (renderer → main)
{ v: 1, method: 'files.write', args: { path: 'notes/a.md', data: '...', encoding: 'utf8' } }
// response
{ ok: true, value: ... } | { ok: false, error: { code: 'PERMISSION_DENIED', message: '...' } }
```

Events from main to an app (notification clicked, etc.) arrive on `kobello:event`. The preload exposes only a tiny, frozen surface:

```ts
window.__kobello = { v: 1, invoke(method, args), on(event, cb) → unsubscribe }
```

The SDK wraps it. App code never touches `window.__kobello` directly, so the protocol can change behind a stable public API.

---

## 4. Public SDK API (v1)

```ts
import { kobello, KobelloError } from '@kobello/sdk';

kobello.isAvailable(): boolean                 // false outside the Kobello desktop app
kobello.version: string                        // SDK version
await kobello.host(): { version, platform }    // host version and OS
```

### 4.1 App info — `kobello.app`
```ts
await kobello.app.info(): {
  id: string; name: string; version: string;
  permissions: Permission[]; dataPath?: string   // dataPath only for the shell
}
```

### 4.2 Key/value storage — `kobello.storage` (permission `storage`)
Per-app, JSON values, persisted by the host.
```ts
await kobello.storage.get<T>(key: string): T | undefined
await kobello.storage.set(key: string, value: JsonValue): void
await kobello.storage.delete(key: string): void
await kobello.storage.keys(): string[]
await kobello.storage.clear(): void
kobello.storage.onChange(cb: (key: string) => void): () => void   // change made by another view of the same app
```
Limits (v1): key ≤ 256 chars, value ≤ 1 MB serialized, total ≤ 10 MB per app → `QUOTA_EXCEEDED`.
Disk: `storage.json`, written atomically (write a temp file, then rename) and debounced.

### 4.3 Files — `kobello.files` (permission `files`)
Paths are **relative to the app's own folder** (`~/kobello/data/<appId>/files/`), using `/` separators.
```ts
await kobello.files.read(path, { encoding?: 'utf8' | 'binary' }): string | Uint8Array
await kobello.files.write(path, data: string | Uint8Array, { createDirs?: boolean }): FileInfo
await kobello.files.delete(path): void              // file or empty folder
await kobello.files.list(dir = ''): FileInfo[]      // one level
await kobello.files.stat(path): FileInfo | null
await kobello.files.mkdir(path): void             // also creates missing parent folders
await kobello.files.rename(from, to): void          // file or folder

interface FileInfo { path: string; name: string; type: 'file' | 'dir'; size: number; modifiedAt: string }
```
Rules enforced by the host: no absolute paths, no `..` escaping, no following symlinks out of the folder (resolve with `realpath` and check it's still inside the root), max file size 50 MB (v1), reject Windows reserved names (`CON`, `NUL`, …).
Picking files from anywhere on disk (open/save dialogs) is a **later** feature.

### 4.4 Notifications — `kobello.notifications` (permission `notifications`)
```ts
await kobello.notifications.show({ title: string; body?: string; silent?: boolean; tag?: string }): string  // id
kobello.notifications.onClick(cb: (id: string, tag?: string) => void): () => void
```
The host shows the notification with Electron's main-process `Notification`, prefixed or badged with the app's name. Clicking focuses the window, activates the app, and fires `onClick` in that app.
Limits: title ≤ 100 chars, body ≤ 500, at most 10 notifications per minute per app.

### 4.5 Links — `kobello.links` (permission `links`)
```ts
await kobello.links.open(url: string): void   // opens in the user's default browser
```
Only `https:`, `http:` and `mailto:` are allowed (`INVALID_ARGUMENT` otherwise). Uses `shell.openExternal`.

### 4.6 Errors
Every method returns a Promise that rejects with `KobelloError`:

| `code` | When |
|---|---|
| `NOT_AVAILABLE` | Not running inside Kobello (no `window.__kobello`) |
| `PERMISSION_DENIED` | The manifest doesn't declare the permission, or the caller isn't a registered Kobello app |
| `INVALID_ARGUMENT` | Bad path, bad URL, wrong type, too long |
| `NOT_FOUND` | File, folder or key missing (where that isn't a normal `undefined`) |
| `ALREADY_EXISTS` | `mkdir`/`rename` target exists |
| `QUOTA_EXCEEDED` | Storage or file size limit |
| `RATE_LIMITED` | Too many notifications |
| `UNSUPPORTED` | The host is older than the SDK and lacks the method |
| `INTERNAL` | Anything else (message logged on the host) |

### 4.7 Shell-only API — `@kobello/sdk/shell` (Kobello UI only)
This replaces the ad-hoc `window.kobello` bridge in `Kobello/src/bridge.ts`. Calls from any other app get `PERMISSION_DENIED`.
```ts
import { shell } from '@kobello/sdk/shell';
await shell.apps.list(): InstalledApp[]            // everything in the sidebar
await shell.apps.inspect(url): { kind: 'kobello-app', manifest, iconUrl? } | { kind: 'website', name?, iconUrl? }
await shell.apps.install(url, name?): InstalledApp // Kobello app (validates the manifest) or plain website
await shell.apps.update(appId, { name?, iconUrl? }): InstalledApp
await shell.apps.uninstall(appId, { deleteData: boolean }): void
await shell.views.show(appId, bounds): void
await shell.views.hideAll(): void
await shell.views.reload(appId): void
await shell.views.close(appId): void
shell.onShortcut(cb: (n: number) => void): () => void
```
The **host's registry is the source of truth for installed apps**, because it also decides each app's identity and permissions. Kobello UI reads it with `shell.apps.list()` and keeps only its own UI state (sidebar order, the active app) in `kobello.storage` under its system app ID. That's the "stop using localStorage" requirement. Kobello UI opens links with the normal `kobello.links.open`.

### 4.8 Testing helper — `@kobello/sdk/mock`
An in-memory implementation of the same API, so app developers can unit-test, or preview in a normal browser during development, without Electron:
```ts
import { installMock } from '@kobello/sdk/mock';
installMock({ app: { id: 'com.example.notes', permissions: ['storage', 'files'] } });
```
This is **not** a production browser fallback (decision 1). It's a dev tool.

---

## 5. Kobello app manifest

A Kobello app is a normal web app that serves **`/kobello.json`** from its origin:

```json
{
  "kobello": 1,
  "id": "com.example.notes",
  "name": "Notes",
  "version": "1.0.0",
  "description": "Simple notes saved on your computer.",
  "start_url": "/",
  "icon": "/icons/icon-192.png",
  "permissions": ["storage", "files", "notifications", "links"],
  "sdk": "^1.0.0"
}
```

Install flow (in Kobello UI's Add app dialog):
1. User pastes a URL → `shell.apps.inspect(url)` (main fetches `<origin>/kobello.json` with `net.fetch`).
2. **Manifest found and valid:** show name, icon and the **permissions it asks for**. The user clicks Install → `shell.apps.install(url)`. Main records `{ appId, origin, permissions, version }` in `~/kobello/data/kobello.shell/registry.json`.
3. **No manifest:** add it as a plain website (no preload, no SDK), as today.

Rules:
- `id` must match `^[a-z0-9]+(\.[a-z0-9-]+)+$`. An ID already installed from a different origin is rejected.
- `https:` only, except `http://localhost:*` when **Developer mode** is on in Kobello settings.
- If `permissions` grows when the manifest updates, the app keeps the old set until the user approves the new ones (v1 can show a simple "This app wants new permissions" prompt the next time it opens).

### 5.1 Offline (every app is a PWA)

Each app caches its own code with its service worker, exactly as it would in Chrome. Its data lives on disk through the SDK. Kobello's job is to keep those caches intact and to fill them as soon as an app is installed.

| Part | Who makes it work offline |
|---|---|
| Kobello UI | Its own service worker (already working) |
| An app's pages and code | The app's service worker, kept in the app's persistent session |
| An app's data | The SDK: `storage` and `files` are on the user's disk |

Rules for the host:
1. **Persistent sessions.** Every app view uses `partition: 'persist:app-<appId>'`. A partition without `persist:` lives in memory only, and its service worker cache would vanish on restart.
2. **Cache on install.** Installing needs the internet. Right after `shell.apps.install`, the host loads the app once in a hidden view and waits (up to 30 s) until its service worker is active (`navigator.serviceWorker.ready`). Then the app works offline even if the user never opened it while online. The install result reports `offlineReady: true/false`, and Kobello UI shows "Ready offline" or a warning.
3. **Don't intercept app requests.** No `webRequest` hooks on app sessions: they run before the service worker and can stop it from answering offline.
4. **Friendly failure.** If an app view still fails to load (installed while offline, or the app's service worker doesn't cache everything), the host shows a small "You're offline" page with a Retry button instead of Chromium's error page.
5. **Uninstall clears the cache too.** With `deleteData`, the host also calls `session.clearStorageData()` on the app's partition (service worker, caches, IndexedDB).
6. **Updates work as in a browser.** When the app's site changes, its service worker updates itself the next time Kobello is online. Kobello does nothing special.

Plain websites follow the same rules. They work offline only if the site has its own service worker (Excalidraw does; Gmail doesn't).

---

## 6. Phases

### Phase 0 — Agree on the plan ✓
- Decisions recorded in section 1.
- Freeze the v1 API in section 4 and the manifest format in section 5.
**Done when:** this document is approved.

### Phase 1 — SDK package (`kobello-package`) ✓ (2026-10-20)
- Restructure: `src/index.ts` (public API), `src/shell.ts`, `src/mock.ts`, `src/protocol.ts` (shared request/response/error types, method names), `src/errors.ts`.
- Build with `tsup`: **ESM + `.d.ts`**, browser target ES2020, zero runtime dependencies, an `exports` map for `.`, `./shell`, `./mock`, `./protocol`.
- Remove the `fetch('http://localhost:5050/...')` functions (keep them on a `legacy` branch if needed).
- Unit tests (vitest) against a fake `window.__kobello`: argument checks, error mapping, event unsubscribe, mock parity.
- `protocol.ts` is imported by the Electron host too, so both sides share one source of truth for method names and types.
**Done when:** `npm run build` and the tests pass, and `npm pack` produces a package that installs into a Vite app.
Result: 16 tests pass; a packed build type-checks, builds and runs in a fresh Vite + TypeScript app. The package ships ESM with a `default` export condition, so the Electron host's webpack (CommonJS) build can import `@kobello/sdk/protocol` too.

### Phase 2 — Electron host (`kobello-electron-api`) ✓ (2026-10-20)
Already done before Phase 1 (cleanup on 2026-10-20): app renamed to `kobello` / `Kobello`, the main window loads `TARGET_URL` directly (no `downloadPWA` snapshot), `webSecurity: false`, the global CSP override and forced DevTools removed, single-instance lock, external links open in the default browser, and the Express server bound to `127.0.0.1` with paths confined to `~/kobello`.

Built in Phase 2:
- **App views:** create one `WebContentsView` per app (answers `shell.views.show/hideAll/reload/close`; Kobello UI calls these instead of its old `showApp`/`hideApps` bridge in Phase 3). Kobello apps get `app-preload`; plain websites get no preload.
- **Preloads:** `shell-preload.ts` and `app-preload.ts`, both exposing only `window.__kobello` via `contextBridge`. Add them as Webpack entries in `forge.config.ts`.
- **Router:** `ipcMain.handle('kobello:invoke')` → identity → origin check → permission → validation → handler. One module per area: `host/storage.ts`, `host/files.ts`, `host/notifications.ts`, `host/links.ts`, `host/app.ts`, `host/shell.ts`, `host/registry.ts`.
- **Offline (section 5.1):** persistent partition per app, cache-on-install in a hidden view, the "You're offline" page with Retry, clearing the partition on uninstall with `deleteData`.
  The SDK's `shell.apps.install` result gains `offlineReady: boolean` (a small change in `kobello-package/src/protocol.ts` when this is built).
- **Notifications on Windows:** call `app.setAppUserModelId(...)` at startup, or Windows won't show notifications reliably.
- **Remove the Express server** (`src/server/*`) and its dependencies once nothing calls it.
- Tests: unit-test handlers against a temp folder (path escapes, symlinks, quotas, atomic writes); integration-test one IPC round trip with a test app.
**Done when:** a test app can use every v1 method, a plain website can't, no port is listening, and an installed PWA opens with the network cut off (test with a local server that's then shut down).

Result:
- Code: `src/host/` (`router.ts`, `views.ts`, `storage.ts`, `files.ts`, `registry.ts`, `site-info.ts`, `notifications.ts`, `common.ts`) and one shared `src/preload.ts` for Kobello UI and Kobello apps (the main process decides who may do what). The Express server is removed; nothing listens on a port.
- 13 unit tests (file confinement incl. a link pointing outside, storage limits, registry, manifest and URL checks, website info, network errors).
- End-to-end on the packaged app with local test servers: install with `offlineReady: true` for a PWA and `false` for a site without a service worker; every SDK call from the app; path escapes, shell methods, undeclared permissions and unknown methods refused; iframes inside an app and plain websites get no bridge; after a restart with the app's server shut down the PWA opened from its cache with its data and files; the plain website showed the offline page; uninstall with `deleteData` removed the data folder and the service worker caches.
- Developer mode: running from source or `KOBELLO_DEV=1`. Allows `http://localhost` apps, and `KOBELLO_UI_URL` points the window at a local Kobello UI.
- SDK additions: `offlineReady` on install and a `NETWORK_ERROR` code.

Known v1 limits:
- `storage.onChange` never fires yet: each app has a single view, so there's no other window to hear from.
- Clicking a notification focuses Kobello and tells the app, but Kobello UI doesn't switch to that app yet (would need a `shell.*` event).
- Until Phase 3, the live Kobello UI still shows apps in iframes and keeps its list in localStorage; the old `window.kobello` bridge no longer exists.

### Phase 3 — Kobello UI (`Kobello`)
- Add `@kobello/sdk` (local `npm link` / `file:` dependency until it's published).
- Replace `src/bridge.ts` with `@kobello/sdk/shell`.
- Load the app list from `shell.apps.list()` and keep UI state (order, active app) in `kobello.storage`. On first run, **import the old localStorage apps once** (install each through `shell.apps.install`) and then delete the old data.
- Add app dialog: call `shell.apps.inspect`. Show a permission prompt for Kobello apps, or "Website" for plain sites. After installing, show "Ready offline", or a warning if the app's service worker didn't activate.
- Outside Electron (`!kobello.isAvailable()`): show a short "Open Kobello Desktop" screen instead of a broken UI (decision 1).
**Done when:** the app list survives a restart through the host, nothing app-related remains in localStorage, and installing a Kobello app shows its permissions.

### Phase 4 — Example app + developer guide (open source)
- `examples/notes`: a small Vite + React PWA (`vite-plugin-pwa`) using storage, files, notifications and links, with a `kobello.json`. It must work offline.
- **Guide** (Markdown, in a public repo or docs site):
  1. What a Kobello app is
  2. Quick start (create a Vite app, add `@kobello/sdk`, add `kobello.json`)
  3. Run it in Kobello with Developer mode + `localhost`
  4. API reference for each module (generated from the TypeScript docs)
  5. Permissions and the manifest
  6. Errors and limits
  7. Testing with `@kobello/sdk/mock`
  8. Make your app work offline: add a service worker that precaches the whole app (`vite-plugin-pwa`), keep data in the SDK, and test it in Kobello with the network off
  9. Publishing (host it on any https URL)
- Later, maybe a `npm create kobello-app` template.
**Done when:** someone new can follow the guide from zero to a running app in Kobello.

### Phase 5 — Later (not in v1)
Browser fallback for Kobello UI · app approval/review and signing · file open/save dialogs · per-permission toggles in settings · background tasks · app-to-app messaging · iframe transport · auto-update for the Electron app.

---

## 7. Security checklist (v1)
- [ ] No HTTP server listening; all SDK traffic is IPC.
- [ ] `appId` is taken from the sender's view, never from arguments.
- [ ] Every call checks main-frame-only, registered origin and declared permission.
- [ ] File paths are confined with `path.resolve` + `realpath` checks; symlinks can't escape.
- [ ] Storage, file-size and notification limits are enforced on the host.
- [ ] `links.open` allows `http:`, `https:` and `mailto:` only.
- [ ] Each app has its own session partition; plain websites get no preload.
- [ ] `contextIsolation`, `sandbox` and no `nodeIntegration` on every webContents.
- [ ] The shell API works only for the shell window on the configured Kobello UI origin.
- [ ] `localhost` apps only in Developer mode.

---

## 8. Open questions
None right now. Decisions 4–7 in section 1 settled the earlier questions on 2026-10-20.
