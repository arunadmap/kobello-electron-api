import { contextBridge, ipcRenderer } from 'electron';

// Runs before Kobello UI loads and exposes a small, safe API on `window.api`.
// The Kobello SDK will replace this in Phase 2 (see docs/KOBELLO_SDK_PLAN.md).

contextBridge.exposeInMainWorld('api', {
  /** Address of the local file server, or null if it isn't running. */
  getServerAddress: (): Promise<string | null> => ipcRenderer.invoke('get-server-address'),
});
