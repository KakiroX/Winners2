import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

function on<T>(channel: string, cb: (payload: T) => void) {
  const h = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
}

contextBridge.exposeInMainWorld('quanta', {
  platform: process.platform,
  version: process.env.QUANTA_VERSION ?? '1.0.0',
  openFiles: (opts: any) => ipcRenderer.invoke('dialog:openFiles', opts),
  saveDialog: (opts: any) => ipcRenderer.invoke('dialog:save', opts),
  writeFile: (path: string, data: Uint8Array | string) => ipcRenderer.invoke('fs:write', path, data),
  readFile: (path: string) => ipcRenderer.invoke('fs:read', path),
  resolvePath: (path: string) => ipcRenderer.invoke('fs:resolve', path),
  svgToPdf: (svg: string, width: number, height: number) => ipcRenderer.invoke('export:pdf', svg, width, height),
  copyImage: (png: Uint8Array) => ipcRenderer.invoke('clipboard:image', png),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: any) => ipcRenderer.invoke('settings:set', patch),
  claudeSetKey: (key: string | null) => ipcRenderer.invoke('claude:setKey', key),
  claudeHasKey: () => ipcRenderer.invoke('claude:hasKey'),
  claudeStream: (requestId: string, params: any) => ipcRenderer.invoke('claude:stream', requestId, params),
  claudeAbort: (requestId: string) => ipcRenderer.invoke('claude:abort', requestId),
  onClaudeEvent: (cb: (e: any) => void) => on('claude:event', cb),
  onMenu: (cb: (cmd: string) => void) => on('menu', cb),
  onOpenPath: (cb: (p: string) => void) => on('open-path', cb),
  setTitle: (t: string) => ipcRenderer.send('window:title', t),
  setDirty: (d: boolean) => ipcRenderer.send('window:dirty', d),
  openExternal: (url: string) => ipcRenderer.send('shell:open', url),
  mcpStatus: () => ipcRenderer.invoke('mcp:status'),
  mcpEnable: (enabled: boolean) => ipcRenderer.invoke('mcp:enable', enabled),
  onMcpCall: (cb: (call: any) => void) => on('mcp:call', cb),
  mcpRespond: (id: string, result: any) => ipcRenderer.send('mcp:result', id, result),
  mcpSetTools: (tools: any[]) => ipcRenderer.send('mcp:tools', tools),
});
