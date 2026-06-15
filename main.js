'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { scan, PROJECTS_ROOT } = require('./src/scanner');

let win = null;
let watcher = null;
let pushTimer = null;
let dirty = true; // force first push

const PUSH_INTERVAL_MS = 1500; // throttle UI updates

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1100,
    minHeight: 740,
    backgroundColor: '#0a0b07',
    title: 'Claude Session Monitor',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });

  win.on('closed', () => {
    win = null;
  });
}

function startWatching() {
  // Recursive watch over the projects root. Mark dirty; a throttled timer pushes.
  try {
    watcher = fs.watch(PROJECTS_ROOT, { recursive: true }, () => {
      dirty = true;
    });
  } catch (e) {
    // recursive watch may be unsupported; fall back to interval-only refresh.
    dirty = true;
  }

  pushTimer = setInterval(() => {
    if (!win) return;
    // Always re-scan on a slow heartbeat so status (active->idle) decays even
    // without file events; full re-parse is cheap thanks to the mtime cache.
    pushUpdate();
    dirty = false;
  }, PUSH_INTERVAL_MS);
}

function pushUpdate() {
  if (!win) return;
  try {
    const data = scan();
    win.webContents.send('sessions:update', data);
  } catch (e) {
    win.webContents.send('sessions:error', String(e && e.message ? e.message : e));
  }
}

ipcMain.handle('sessions:get', () => {
  try {
    return scan();
  } catch (e) {
    return { error: String(e && e.message ? e.message : e) };
  }
});

ipcMain.handle('app:meta', () => ({
  projectsRoot: PROJECTS_ROOT,
  version: app.getVersion(),
  platform: process.platform,
}));

ipcMain.handle('open:path', (_evt, p) => {
  if (typeof p === 'string' && p) shell.openPath(p);
});

app.whenReady().then(() => {
  createWindow();
  startWatching();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (watcher) watcher.close();
  if (pushTimer) clearInterval(pushTimer);
  if (process.platform !== 'darwin') app.quit();
});
