// lumi desktop: a thin window around the live site, so every lumi update reaches the app instantly.
const { app, BrowserWindow, session, shell, ipcMain, desktopCapturer, Menu, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_URL = process.env.LUMI_URL || 'https://lumichat.pages.dev/';
const APP_ORIGIN = new URL(APP_URL).origin;
const ALLOWED_POPUP_HOSTS = ['accounts.google.com', 'accounts.youtube.com']; // Google sign-in
let win = null;

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
app.setAppUserModelId('com.lumi.desktop');

// ---- remember window size/position
const stateFile = () => path.join(app.getPath('userData'), 'window.json');
function loadBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    const area = screen.getDisplayMatching(b).workArea;
    if (b.x >= area.x - 50 && b.y >= area.y - 50 && b.x < area.x + area.width && b.y < area.y + area.height) return b;
  } catch {}
  return { width: 1280, height: 820 };
}
function saveBounds() {
  if (!win || win.isDestroyed()) return;
  try { fs.writeFileSync(stateFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })); } catch {}
}

const LUMI_HOSTS = new Set([new URL(APP_URL).host, 'lumichat.pages.dev', 'lumi-gtih.onrender.com']);
const isLumi = (url) => { try { return new URL(url).origin === APP_ORIGIN; } catch { return false; } };
const isLumiLink = (url) => { try { const u = new URL(url); return (u.protocol === 'https:' || u.origin === APP_ORIGIN) && LUMI_HOSTS.has(u.host); } catch { return false; } };
// any lumi link (an invite, a chat) stays in the app: same path, on the app's own address
const inApp = (url) => { const u = new URL(url); return APP_ORIGIN + u.pathname + u.search + u.hash; };
const isGoogle = (url) => { try { return ALLOWED_POPUP_HOSTS.includes(new URL(url).hostname); } catch { return false; } };

function createWindow() {
  const b = loadBounds();
  win = new BrowserWindow({
    ...b, minWidth: 940, minHeight: 600, show: false, title: 'lumi', backgroundColor: '#121016',
    icon: path.join(__dirname, 'icon.png'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, spellcheck: true },
  });
  if (b.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', saveBounds);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isGoogle(url)) return { action: 'allow', overrideBrowserWindowOptions: { width: 500, height: 640, autoHideMenuBar: true, parent: win } };
    if (isLumiLink(url)) { win.loadURL(inApp(url)); return { action: 'deny' }; }
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (isLumi(url) || isGoogle(url) || url.startsWith('file:')) return;
    if (isLumiLink(url)) { e.preventDefault(); win.loadURL(inApp(url)); return; }
    e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url);
  });
  win.webContents.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3) win.loadFile(path.join(__dirname, 'offline.html'));
  });
  win.loadURL(APP_URL);
}

// ---- screen sharing: let the user pick a screen or window
async function pickSource() {
  // some systems return nothing when icons/thumbnails are requested: fall back step by step
  let sources = [];
  for (const opts of [{ thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true }, { thumbnailSize: { width: 320, height: 180 } }, { thumbnailSize: { width: 0, height: 0 } }]) {
    try { sources = await desktopCapturer.getSources({ types: ['screen', 'window'], ...opts }); } catch { sources = []; }
    if (sources.length) break;
  }
  return new Promise((resolve) => {
    const picker = new BrowserWindow({
      width: 760, height: 560, parent: win, modal: true, resizable: false, minimizable: false, maximizable: false,
      title: 'Share your screen', backgroundColor: '#17151C', autoHideMenuBar: true, show: false,
      webPreferences: { preload: path.join(__dirname, 'picker-preload.js'), contextIsolation: true, sandbox: true },
    });
    let done = false;
    const finish = (id) => { if (done) return; done = true; ipcMain.removeHandler('picker:choose'); resolve(sources.find((s) => s.id === id) || null); if (!picker.isDestroyed()) picker.close(); };
    ipcMain.handle('picker:choose', (_e, id) => finish(id));
    picker.on('closed', () => finish(null));
    picker.webContents.once('did-finish-load', () => {
      picker.webContents.send('picker:sources', sources.map((s) => ({ id: s.id, name: s.name, screen: s.id.startsWith('screen:'), thumb: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : '', icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null })));
      picker.show();
    });
    picker.loadFile(path.join(__dirname, 'picker.html'));
  });
}

app.whenReady().then(() => {
  const ses = session.defaultSession;
  const allowed = new Set(['media', 'notifications', 'display-capture', 'clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'pointerLock']);
  ses.setPermissionRequestHandler((wc, permission, cb, details) => cb(allowed.has(permission) && isLumi(details.requestingUrl || wc.getURL())));
  ses.setPermissionCheckHandler((wc, permission, origin) => allowed.has(permission) && (!origin || origin === APP_ORIGIN));
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const source = await pickSource();
      if (!source) return callback({});
      callback(request.audioRequested && process.platform === 'win32' ? { video: source, audio: 'loopback' } : { video: source });
    } catch { callback({}); }
  });

  ipcMain.handle('lumi:update', async () => {
    await ses.clearCache();
    if (win.webContents.getURL().startsWith('file:')) win.loadURL(APP_URL); else win.webContents.reloadIgnoringCache();
  });
  ipcMain.handle('lumi:retry', () => win.loadURL(APP_URL));

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'lumi', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { type: 'separator' }, { role: 'togglefullscreen' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
  ]));
  createWindow();
});
app.on('window-all-closed', () => app.quit());
