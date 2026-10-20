// Runs before Kobello UI and before every Kobello app, and gives the page `window.__kobello`.
// The @kobello/sdk package wraps it; pages never use it directly.
// It only forwards messages: the main process decides who is calling and what they may do.

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

const PROTOCOL_VERSION = 1;

contextBridge.exposeInMainWorld('__kobello', {
  v: PROTOCOL_VERSION,

  /** Calls a host method. Always resolves with { ok, value } or { ok: false, error }. */
  invoke: (method: string, args?: unknown) => ipcRenderer.invoke('kobello:invoke', { v: PROTOCOL_VERSION, method, args }),

  /** Listens for one host event. Returns a function that stops listening. */
  on: (event: string, callback: (payload: unknown) => void) => {
    const listener = (_event: IpcRendererEvent, name: string, payload: unknown) => {
      if (name === event) callback(payload);
    };
    ipcRenderer.on('kobello:event', listener);
    return () => {
      ipcRenderer.removeListener('kobello:event', listener);
    };
  },
});
