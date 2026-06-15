'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('monitor', {
  /** One-shot fetch of current sessions + stats. */
  getSessions: () => ipcRenderer.invoke('sessions:get'),
  /** App metadata (projects root, version, platform). */
  getMeta: () => ipcRenderer.invoke('app:meta'),
  /** Reveal a path in the OS file manager. */
  openPath: (p) => ipcRenderer.invoke('open:path', p),
  /** Subscribe to live pushes. Returns an unsubscribe fn. */
  onUpdate: (cb) => {
    const handler = (_evt, data) => cb(data);
    ipcRenderer.on('sessions:update', handler);
    return () => ipcRenderer.removeListener('sessions:update', handler);
  },
  onError: (cb) => {
    const handler = (_evt, msg) => cb(msg);
    ipcRenderer.on('sessions:error', handler);
    return () => ipcRenderer.removeListener('sessions:error', handler);
  },
});
