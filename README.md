# Kobello desktop app

The Electron app that hosts Kobello UI and the Kobello apps you add to it. It answers the
[`@kobello-electron/sdk`](../kobello-package) calls (storage, files, notifications, links) and keeps each app
cached for offline use. See [docs/KOBELLO_SDK_PLAN.md](docs/KOBELLO_SDK_PLAN.md) for the design.

## Run it locally

Kobello UI and the SDK live next to this project:

```
Projects/
  kobello-electron-api/   ← this app
  Kobello/                ← Kobello UI
  kobello-package/        ← @kobello-electron/sdk
```

1. Start Kobello UI (it serves on http://127.0.0.1:5173):

   ```bash
   cd ../Kobello
   npm install
   npm run dev
   ```

2. In another terminal, start this app. Running from source, it shows the local Kobello UI:

   ```bash
   npm install
   npm start
   ```

Running from source is **developer mode**: you can also add apps from `http://localhost`.

| Setting | What it does |
|---|---|
| `KOBELLO_UI_URL` | Show a different Kobello UI, e.g. a `vite preview` build. Only when running from source; the packaged app ignores it |
| `KOBELLO_DEV=1` | Turn on developer mode (`http://localhost` apps) in a packaged build |

The packaged app (`npm run package` / `npm run make`) always shows the published Kobello UI. It has no DevTools
and only a minimal menu (copy/paste, quit).

## What apps can and can't do

- **SDK permissions are approved at install.** Kobello UI shows what a Kobello app asks for (`shell.apps.inspect`) and
  passes the approved list to `shell.apps.install`. If the app's `kobello.json` asks for anything else by then, the
  install is refused.
- **Web permissions are denied.** Camera, microphone, location, web notifications, clipboard reading, fullscreen,
  USB and the like are refused for every page, and a page can't start other programs through links such as
  `search-ms:`. The one exception is writing to the clipboard. Kobello apps use the SDK instead.
- **Links** (`links.open`, `window.open`, `target="_blank"`) open in the default browser: `http`, `https` and `mailto`
  only, at most 5 per app every 10 seconds, and `window.open` only for the app on screen.
- **Data belongs to the origin that created it.** The first origin to use an app ID owns `~/kobello/data/<appId>/`
  (`owner.json`); another site claiming the same ID is refused.
- **Limits per app:** storage 10 MB (1 MB per value); files 50 MB each, 1 GB and 10,000 files and folders in total.

## Other commands

```bash
npm test        # unit tests for the host (files, storage, registry, site info, install rules, links)
npm run lint
```

App data lives in `~/kobello/data/<appId>/`; the list of installed apps is in `~/kobello/data/kobello.shell/registry.json`.
