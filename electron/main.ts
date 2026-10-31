import { app, BrowserWindow, Menu, dialog, ipcMain, protocol, net, safeStorage, shell, clipboard, ClipboardItem, type MenuItemConstructorOptions } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { streamClaude } from '../src/claude/stream';

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const userData = () => app.getPath('userData');
const settingsPath = () => path.join(userData(), 'settings.json');
const keyPath = () => path.join(userData(), 'claude-key.bin');
const mcpInfoPath = () => path.join(userData(), 'mcp.json');


function readSettings(): Record<string, any> {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(patch: Record<string, any>) {
  const cur = readSettings();
  fs.mkdirSync(userData(), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify({ ...cur, ...patch }, null, 2));
}

function readKey(): string | null {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const buf = fs.readFileSync(keyPath());
    if (buf[0] === 0x7b /* { */) {
      const j = JSON.parse(buf.toString('utf8'));
      return Buffer.from(j.b64, 'base64').toString('utf8');
    }
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

function workDir(): string {
  const s = readSettings();
  const dir = s.workDir || path.join(app.getPath('documents'), 'Quanta Studio');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  return dir;
}

let win: BrowserWindow | null = null;
let dirty = false;
let pendingOpen: string[] = [];
const streams = new Map<string, () => void>();

function startApp() {
  app.on('second-instance', (_e, argv) => {
    const f = argv.find((a) => /\.(quanta|pzfx|csv|m|mat)$/i.test(a));
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      if (f) win.webContents.send('open-path', f);
    }
  });
  app.on('open-file', (e, p) => {
    e.preventDefault();
    if (win) win.webContents.send('open-path', p);
    else pendingOpen.push(p);
  });
  pendingOpen.push(...process.argv.slice(1).filter((a) => /\.(quanta|pzfx|csv|m|mat)$/i.test(a) && fs.existsSync(a)));

  app.whenReady().then(() => {
    try {
      onReady();
    } catch (err: any) {
      console.error('Startup failed:', err);
      dialog.showErrorBox('Quanta Studio failed to start', String(err?.stack ?? err));
    }
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
}

function onReady() {
  {
    const dist = path.join(__dirname, '..', 'dist');
    protocol.handle('app', (req) => {
      const url = new URL(req.url);
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/' || rel === '') rel = '/index.html';
      const file = path.normalize(path.join(dist, rel));
      if (!file.startsWith(dist)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(file).toString());
    });
    registerIpc();
    buildMenu();
    createWindow();
    const s = readSettings();
    if (s.mcpEnabled) startMcpServer().catch((e) => console.error('MCP server failed', e));
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1000,
    minHeight: 640,
    title: 'Quanta Studio',
    backgroundColor: '#eef0f4',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://') && !(DEV_URL && url.startsWith(DEV_URL))) e.preventDefault();
  });
  win.on('close', (e) => {
    if (!dirty) return;
    const choice = dialog.showMessageBoxSync(win!, {
      type: 'warning',
      buttons: ['Cancel', 'Quit without saving'],
      defaultId: 0,
      cancelId: 0,
      message: 'You have unsaved changes.',
      detail: 'Save your project (Ctrl+S) before closing, or quit and discard the changes.',
    });
    if (choice === 0) e.preventDefault();
  });
  win.webContents.on('did-finish-load', () => {
    for (const p of pendingOpen) win?.webContents.send('open-path', p);
    pendingOpen = [];
  });
  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadURL('app://quanta/index.html');
}

function send(cmd: string) {
  win?.webContents.send('menu', cmd);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('saveAs') },
        { type: 'separator' },
        { label: 'Import Data…', accelerator: 'CmdOrCtrl+I', click: () => send('import') },
        { label: 'Export Tables as Prism XML (.pzfx)…', click: () => send('exportPzfx') },
        { label: 'Save Workspace (.mat)…', click: () => send('saveWorkspace') },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => send('settings') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('undo') },
        { label: 'Redo', accelerator: process.platform === 'darwin' ? 'Cmd+Shift+Z' : 'Ctrl+Y', click: () => send('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Insert',
      submenu: [
        { label: 'New Data Table…', accelerator: 'CmdOrCtrl+T', click: () => send('newTable') },
        { label: 'New Script', accelerator: 'CmdOrCtrl+Shift+N', click: () => send('newScript') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Command Window', accelerator: 'CmdOrCtrl+J', click: () => send('toggleCommand') },
        { label: 'Format Panel', click: () => send('toggleFormat') },
        { label: 'Claude Assistant', accelerator: 'CmdOrCtrl+L', click: () => send('toggleClaude') },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Run',
      submenu: [{ label: 'Stop Execution', accelerator: 'CmdOrCtrl+.', click: () => send('stop') }],
    },
    {
      role: 'help',
      submenu: [
        { label: 'About Quanta Studio', click: () => send('about') },
        { label: 'Project Website', click: () => shell.openExternal('https://github.com/KakiroX/Winners2') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc() {
  ipcMain.handle('dialog:openFiles', async (_e, opts: { filters: { name: string; extensions: string[] }[]; multi?: boolean }) => {
    const r = await dialog.showOpenDialog(win!, { filters: opts.filters, properties: opts.multi ? ['openFile', 'multiSelections'] : ['openFile'], defaultPath: workDir() });
    if (r.canceled) return [];
    return r.filePaths.map((p) => ({ path: p, name: path.basename(p), data: new Uint8Array(fs.readFileSync(p)) }));
  });
  ipcMain.handle('dialog:save', async (_e, opts: { defaultPath?: string; filters: { name: string; extensions: string[] }[] }) => {
    const r = await dialog.showSaveDialog(win!, { defaultPath: path.join(workDir(), opts.defaultPath ?? ''), filters: opts.filters });
    return r.canceled ? null : r.filePath;
  });
  ipcMain.handle('fs:write', async (_e, p: string, data: Uint8Array | string) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, typeof data === 'string' ? data : Buffer.from(data));
  });
  ipcMain.handle('fs:read', async (_e, p: string) => {
    try {
      return new Uint8Array(fs.readFileSync(p));
    } catch {
      return null;
    }
  });
  ipcMain.handle('fs:resolve', async (_e, p: string) => (path.isAbsolute(p) ? p : path.join(workDir(), p)));
  ipcMain.handle('export:pdf', async (_e, svg: string, width: number, height: number) => {
    const pw = new BrowserWindow({ show: false, width: Math.ceil(width) + 20, height: Math.ceil(height) + 20, webPreferences: { sandbox: true, javascript: false } });
    const html = `<!doctype html><html><head><style>@page{size:${width}pt ${height}pt;margin:0}html,body{margin:0;padding:0}svg{display:block;width:${width}pt;height:${height}pt}</style></head><body>${svg}</body></html>`;
    await pw.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const pdf = await pw.webContents.printToPDF({ printBackground: true, pageSize: { width: width / 72, height: height / 72 }, margins: { top: 0, bottom: 0, left: 0, right: 0 }, preferCSSPageSize: true });
    pw.destroy();
    return new Uint8Array(pdf);
  });
  ipcMain.handle('clipboard:image', async (_e, png: Uint8Array) => {
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from(png)], { type: 'image/png' }) })]);
  });
  ipcMain.handle('settings:get', async () => readSettings());
  ipcMain.handle('settings:set', async (_e, patch: Record<string, any>) => writeSettings(patch));
  ipcMain.handle('claude:setKey', async (_e, key: string | null) => {
    if (!key) {
      try {
        fs.unlinkSync(keyPath());
      } catch {
        /* none */
      }
      return true;
    }
    fs.mkdirSync(userData(), { recursive: true });
    if (safeStorage.isEncryptionAvailable()) fs.writeFileSync(keyPath(), safeStorage.encryptString(key));
    else fs.writeFileSync(keyPath(), JSON.stringify({ b64: Buffer.from(key, 'utf8').toString('base64') }), { mode: 0o600 });
    return true;
  });
  ipcMain.handle('claude:hasKey', async () => !!readKey());
  ipcMain.handle('claude:stream', async (_e, requestId: string, params: any) => {
    const key = readKey();
    if (!key) return { error: { type: 'authentication_error', message: 'No Anthropic API key is configured.', retryable: false } };
    const client = new Anthropic({ apiKey: key, maxRetries: 3 });
    const outcome = await streamClaude(
      client,
      params,
      (ev) => win?.webContents.send('claude:event', { requestId, ...ev }),
      (abort) => streams.set(requestId, abort),
    );
    streams.delete(requestId);
    // Structured-clone friendly result
    return JSON.parse(JSON.stringify(outcome));
  });
  ipcMain.handle('claude:abort', async (_e, requestId: string) => {
    streams.get(requestId)?.();
    streams.delete(requestId);
  });
  ipcMain.on('window:title', (_e, t: string) => win?.setTitle(t));
  ipcMain.on('window:dirty', (_e, d: boolean) => {
    dirty = d;
    win?.setDocumentEdited?.(d);
  });
  ipcMain.on('shell:open', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });
  ipcMain.handle('mcp:status', async () => mcpStatus());
  ipcMain.handle('mcp:enable', async (_e, enabled: boolean) => {
    writeSettings({ mcpEnabled: enabled });
    if (enabled) await startMcpServer();
    else stopMcpServer();
    return mcpStatus();
  });
  ipcMain.on('mcp:tools', (_e, tools: any[]) => {
    mcpTools = tools;
    if (mcpServer) writeMcpInfo();
  });
  ipcMain.on('mcp:result', (_e, id: string, result: any) => {
    const p = mcpPending.get(id);
    if (p) {
      mcpPending.delete(id);
      p(result);
    }
  });
}

// ---------------- MCP relay server (localhost only) ----------------
let mcpServer: http.Server | null = null;
let mcpPort = 0;
let mcpToken = '';
let mcpTools: any[] = [];
const mcpPending = new Map<string, (r: any) => void>();

function mcpCommand() {
  // Run the same executable as plain Node (no window) with the bundled stdio server script.
  return { command: process.execPath, args: [path.join(__dirname, 'mcp-server.js'), mcpInfoPath()], env: { ELECTRON_RUN_AS_NODE: '1' } };
}

function mcpStatus() {
  return { enabled: !!mcpServer, port: mcpPort || undefined, configPath: mcpInfoPath(), ...mcpCommand() };
}

function writeMcpInfo() {
  fs.mkdirSync(userData(), { recursive: true });
  fs.writeFileSync(mcpInfoPath(), JSON.stringify({ port: mcpPort, token: mcpToken, tools: mcpTools, pid: process.pid }), { mode: 0o600 });
}

function startMcpServer(): Promise<void> {
  if (mcpServer) return Promise.resolve();
  mcpToken = crypto.randomBytes(24).toString('hex');
  mcpServer = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${mcpToken}` || req.method !== 'POST') {
      res.writeHead(401).end();
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let msg: any;
      try {
        msg = JSON.parse(body);
      } catch {
        res.writeHead(400).end();
        return;
      }
      if (req.url === '/tools') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ tools: mcpTools }));
        return;
      }
      if (req.url === '/call' && win) {
        const id = crypto.randomUUID();
        const timer = setTimeout(() => {
          if (mcpPending.has(id)) {
            mcpPending.delete(id);
            res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ content: [{ type: 'text', text: 'Timed out waiting for Quanta Studio.' }], isError: true }));
          }
        }, 120000);
        mcpPending.set(id, (r) => {
          clearTimeout(timer);
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(r));
        });
        win.webContents.send('mcp:call', { id, name: msg.name, input: msg.arguments ?? {} });
        return;
      }
      res.writeHead(404).end();
    });
  });
  return new Promise((resolve) => {
    mcpServer!.listen(0, '127.0.0.1', () => {
      mcpPort = (mcpServer!.address() as any).port;
      writeMcpInfo();
      resolve();
    });
  });
}

function stopMcpServer() {
  mcpServer?.close();
  mcpServer = null;
  mcpPort = 0;
  try {
    fs.unlinkSync(mcpInfoPath());
  } catch {
    /* ignore */
  }
}

app.on('will-quit', () => {
  if (mcpServer) stopMcpServer();
});

// Entry point (kept at the end so all module-level state is initialized first).
{
  protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) app.quit();
  else startApp();
}
