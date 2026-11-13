# Kobello desktop app

The Electron app that hosts Kobello UI and the Kobello apps you add to it. It answers the
[`@kobello-electron/sdk`](https://www.npmjs.com/package/@kobello-electron/sdk) calls (storage, files, notifications,
links). Each app runs in its own view with its own persistent session, so it keeps its own data and is cached for
offline use. App views have rounded corners that match Kobello UI's sheet.
See [docs/KOBELLO_SDK_PLAN.md](docs/KOBELLO_SDK_PLAN.md) for the design.

Related projects:

- **Kobello UI** ([source](https://github.com/whoispasindu/Kobello-UI), live at https://kobello-ui.vercel.app/): the
  interface this app shows. Expected next to this project as `../Kobello` when running from source.
- **SDK** ([`@kobello-electron/sdk`](https://github.com/arunadmap/kobello-package)): what Kobello apps call. Installed
  from npm (`^0.1.0`), not from a sibling folder.

## Install dependencies

With npm 12, Electron Forge pulls `@electron/node-gyp` from GitHub, so allow git dependencies:

```bash
npm install --allow-git=all
```

npm 12 also blocks install scripts, so run the two that matter by hand:

```bash
node node_modules/electron/install.js   # downloads Electron
```

```bash
cd node_modules/electron-winstaller && node script/select-7z-arch.js && cd ../..   # Windows only, before `npm run make`
```

(The second one must run from its own folder.) Or approve them once with
`npm install-scripts approve electron electron-winstaller`, which records an `allowScripts` policy for this project,
then run `npm install --allow-git=all` again.

## Run from source (developer mode)

1. Start Kobello UI (it serves on http://127.0.0.1:5173):

   ```bash
   cd ../Kobello
   npm install
   npm run dev
   ```

2. In another terminal, start this app. It shows the local Kobello UI:

   ```bash
   npm install --allow-git=all
   npm start
   ```

Running from source is **developer mode**: you can also add apps from `http://localhost`.

| Setting | What it does |
|---|---|
| `KOBELLO_UI_URL` | Show a different Kobello UI, e.g. a `vite preview` build. Only works when running from source |
| `KOBELLO_DEV=1` | Turn on developer mode (`http://localhost` apps) in a packaged build. It never changes the UI URL |

## Package it

```bash
npm run package   # unpacked app: out/Kobello-win32-x64
npm run make      # Windows installer: out/make/squirrel.windows/x64/Kobello-<version> Setup.exe
```

The packaged app loads the published Kobello UI. It needs internet on first launch, then works offline.

- **Not code-signed yet.** Windows SmartScreen or Smart App Control may block the builds. Sign them before any
  public release.
- **Electron is pinned to 44.11.3.** 45 is blocked by Smart App Control on unsigned dev machines, and 38 is out of
  support.

## Security model

- **Web permissions are denied by default**, for every page and app session. The only exception is writing to the
  clipboard. Links like `search-ms:` can't start other programs.
- **SDK calls are identified by the sending view, its origin and the main frame**, never by what the call says.
- **Permissions are approved at install and enforced.** Kobello UI shows what an app asks for (`shell.apps.inspect`)
  and passes the approved list to `shell.apps.install`. If `kobello.json` asks for more by then, the install is refused.
- **Data belongs to the origin that created it.** The first origin to use an app ID owns `~/kobello/data/<appId>/`
  (`owner.json`); another site claiming the ID is refused.
- **Limits per app:** storage 10 MB (1 MB per value); files 50 MB each, 1 GB and 10,000 files and folders in total.
- **Links** (`links.open`, `window.open`, `target="_blank"`) open in the default browser: `http`, `https` and `mailto`
  only. Links are limited to 5 per 10 seconds per app, notifications to 10 per minute.
- **The packaged app has no DevTools and no reload menu**, only copy/paste and quit.
- **Electron fuses** turn off `RunAsNode`, Node CLI/environment options and `file://` privileges, and require the app
  to load from a verified asar (see `forge.config.ts`).

## Where data lives

```
~/kobello/data/<appId>/
  storage.json   key/value storage
  files/         the app's files
  owner.json     the origin that owns this app ID
~/kobello/data/kobello.shell/registry.json   installed apps
```

To reset, close Kobello and delete the folder (one app: `~/kobello/data/<appId>/`; everything: `~/kobello/data/`).

## Commands

```bash
npm start         # run from source
npm test          # unit tests for the host (vitest)
npm run lint
npm run package
npm run make
```

## Code map

| File | What it does |
|---|---|
| `src/index.ts` | Main process: window, which Kobello UI to show, keeps the window on Kobello UI, minimal menu, single instance |
| `src/preload.ts` | Gives pages `window.__kobello`; only forwards messages to the host |
| `src/host/router.ts` | Answers every SDK call: identifies the caller, checks origin and permission, runs the method |
| `src/host/views.ts` | One persistent-session view per app, positioned in Kobello UI's content area, with rounded corners |
| `src/host/files.ts` | Per-app file access, confined to the app's `files/` folder, with size limits |
| `src/host/storage.ts` | Per-app key/value storage (`storage.json`) |
| `src/host/registry.ts` | The list of installed apps (`registry.json`) |
| `src/host/install.ts` | Install rules: approved permissions, the registry record, claiming the data folder |
| `src/host/site-info.ts` | Looks at a URL before install: Kobello app (`/kobello.json`) or plain website |
| `src/host/net-fetch.ts` | Fetch for `site-info.ts` on Electron's `net`, without cookies, cache or redirects |
| `src/host/links.ts` | Opens links in the default browser, rate-limited |
| `src/host/notifications.ts` | System notifications for apps, rate-limited |
| `src/host/web-permissions.ts` | Denies web permissions except clipboard writes |
| `src/host/common.ts` | Shared helpers: data paths, argument checks, rate limiter, atomic writes |

Tests are in `src/host/*.test.ts`.
