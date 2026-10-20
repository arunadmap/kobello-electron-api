# Kobello desktop app

The Electron app that hosts Kobello UI and the Kobello apps you add to it. It answers the
[`@kobello/sdk`](../kobello-package) calls (storage, files, notifications, links) and keeps each app
cached for offline use. See [docs/KOBELLO_SDK_PLAN.md](docs/KOBELLO_SDK_PLAN.md) for the design.

## Run it locally

Kobello UI and the SDK live next to this project:

```
Projects/
  kobello-electron-api/   ← this app
  Kobello/                ← Kobello UI
  kobello-package/        ← @kobello/sdk
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
| `KOBELLO_UI_URL` | Show a different Kobello UI (developer mode only), e.g. a `vite preview` build |
| `KOBELLO_DEV=1` | Turn on developer mode in a packaged build |

The packaged app (`npm run package` / `npm run make`) shows the published Kobello UI.

## Other commands

```bash
npm test        # unit tests for the host (files, storage, registry, site info)
npm run lint
```

App data lives in `~/kobello/data/<appId>/`; the list of installed apps is in `~/kobello/data/kobello.shell/registry.json`.
