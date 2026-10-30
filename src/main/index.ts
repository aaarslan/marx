import { app, BrowserWindow, Menu, shell } from 'electron';
import path from 'node:path';
import { registerIpcHandlers } from './ipc';
import { stopCliProcesses } from './cliProcess';

if (process.env.MARX_USER_DATA_DIR) app.setPath('userData', process.env.MARX_USER_DATA_DIR);

let mainWindow: BrowserWindow | null = null;
const isMac = process.platform === 'darwin';

// one Marx at a time — a second launch just focuses the existing window
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', focusWindow);
}

function focusWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  app.focus({ steal: true });
  mainWindow.show();
  mainWindow.focus();
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    ...(isMac ? {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 16 },
      vibrancy: 'under-window',
      visualEffectState: 'active',
      backgroundColor: '#00000000'
    } as const : { backgroundColor: '#17181c' }),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // dev server (electron-vite) or bundled build
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

function buildMenu(): void {
  const applicationMenu: Electron.MenuItemConstructorOptions = {
    label: app.name,
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { type: 'separator' },
      { role: 'quit' }
    ]
  };
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [applicationMenu] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder…',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:action', 'open-folder')
        },
        {
          label: 'Run Scan',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow?.webContents.send('menu:action', 'run-scan')
        },
        { type: 'separator' },
        { role: 'close', label: 'Close Window' },
        ...(!isMac ? [{ type: 'separator' as const }, { role: 'quit' as const, label: 'Exit' }] : [])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload', accelerator: 'CmdOrCtrl+Shift+R' },
        { role: 'forceReload', accelerator: 'CmdOrCtrl+Alt+Shift+R' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      role: 'window',
      submenu: [{ role: 'minimize' }, ...(isMac ? [{ role: 'zoom' as const }] : []), { role: 'close' }]
    },
    ...(!isMac ? [{ role: 'help' as const, submenu: [{ role: 'about' as const }] }] : [])
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.marx.scanner');
  buildMenu();
  registerIpcHandlers({ getWindow: () => mainWindow });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else focusWindow();
  });
});

app.on('before-quit', stopCliProcesses);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('web-contents-created', (_event, contents) => {
  // open platform links in the default browser, not in-app
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
});
