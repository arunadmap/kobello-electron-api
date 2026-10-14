import { contextBridge, ipcRenderer } from 'electron';
import type { ShellApi } from './types/startup';

// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

const api: ShellApi = {
  getServerAddress: () => ipcRenderer.invoke('get-server-address'),
  getStartupState: () => ipcRenderer.invoke('get-startup-state'),
  retry: () => ipcRenderer.invoke('retry-startup'),
  openAppsFolder: () => ipcRenderer.invoke('open-apps-folder'),
};

contextBridge.exposeInMainWorld('api', api);
