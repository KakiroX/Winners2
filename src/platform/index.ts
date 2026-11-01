// Platform abstraction: Electron (via preload bridge) or plain browser fallbacks.

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface OpenedFile {
  path: string | null;
  name: string;
  data: Uint8Array;
}

export interface ClaudeStreamEvent {
  requestId: string;
  kind: 'text' | 'thinking' | 'tool_start' | 'tool_input' | 'error' | 'done' | 'fallback';
  text?: string;
  name?: string;
  message?: any;
  error?: string;
}

export interface QuantaBridge {
  platform: string;
  version: string;
  openFiles(opts: { filters: FileFilter[]; multi?: boolean }): Promise<OpenedFile[]>;
  saveDialog(opts: { defaultPath?: string; filters: FileFilter[] }): Promise<string | null>;
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
  readFile(path: string): Promise<Uint8Array | null>;
  resolvePath(path: string): Promise<string>;
  svgToPdf(svg: string, width: number, height: number): Promise<Uint8Array>;
  copyImage(png: Uint8Array): Promise<void>;
  getSettings(): Promise<Record<string, any>>;
  setSettings(patch: Record<string, any>): Promise<void>;
  claudeSetKey(key: string | null): Promise<boolean>;
  claudeHasKey(): Promise<boolean>;
  claudeStream(requestId: string, params: any): Promise<any>;
  claudeAbort(requestId: string): Promise<void>;
  onClaudeEvent(cb: (e: ClaudeStreamEvent) => void): () => void;
  onMenu(cb: (cmd: string, arg?: any) => void): () => void;
  onOpenPath(cb: (path: string) => void): () => void;
  setTitle(title: string): void;
  setDirty(dirty: boolean): void;
  openExternal(url: string): void;
  mcpStatus(): Promise<{ enabled: boolean; port?: number; configPath?: string; command?: string; args?: string[]; env?: Record<string, string> }>;
  mcpEnable(enabled: boolean): Promise<{ enabled: boolean; port?: number }>;
  onMcpCall(cb: (call: { id: string; name: string; input: any }) => void): () => void;
  mcpRespond(id: string, result: any): void;
  mcpSetTools(tools: any[]): void;
}

declare global {
  interface Window {
    quanta?: QuantaBridge;
  }
}

const bridge = typeof window !== 'undefined' ? window.quanta : undefined;

function download(name: string, data: Uint8Array | string, mime = 'application/octet-stream') {
  const blob = new Blob([typeof data === 'string' ? data : (data as any)], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function pickFiles(filters: FileFilter[], multi = false): Promise<OpenedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multi;
    input.accept = filters.flatMap((f) => f.extensions.map((e) => (e === '*' ? '*' : `.${e}`))).join(',');
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      resolve(await Promise.all(files.map(async (f) => ({ path: null, name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))));
    };
    input.click();
  });
}

const LS_KEY = 'quanta.settings';

export const platform = {
  isDesktop: !!bridge,
  bridge,
  name: bridge?.platform ?? 'web',
  async openFiles(filters: FileFilter[], multi = false): Promise<OpenedFile[]> {
    if (bridge) return bridge.openFiles({ filters, multi });
    return pickFiles(filters, multi);
  },
  /** Save bytes; returns the saved path (desktop) or the file name (browser download). */
  async saveFile(defaultName: string, filters: FileFilter[], data: Uint8Array | string, existingPath?: string | null): Promise<string | null> {
    if (bridge) {
      const path = existingPath ?? (await bridge.saveDialog({ defaultPath: defaultName, filters }));
      if (!path) return null;
      await bridge.writeFile(path, data);
      return path;
    }
    download(defaultName, data);
    return defaultName;
  },
  async writeFile(path: string, data: Uint8Array | string) {
    if (bridge) return bridge.writeFile(path, data);
    download(path.replace(/^.*[\\/]/, ''), data);
  },
  async readFile(path: string): Promise<Uint8Array | null> {
    if (bridge) return bridge.readFile(path);
    return null;
  },
  async svgToPdf(svg: string, width: number, height: number): Promise<Uint8Array | null> {
    if (bridge) return bridge.svgToPdf(svg, width, height);
    return null;
  },
  copyImage: bridge ? (png: Uint8Array) => bridge.copyImage(png) : undefined,
  async getSettings(): Promise<Record<string, any>> {
    if (bridge) return bridge.getSettings();
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}');
    } catch {
      return {};
    }
  },
  async setSettings(patch: Record<string, any>) {
    if (bridge) return bridge.setSettings(patch);
    const cur = await this.getSettings();
    localStorage.setItem(LS_KEY, JSON.stringify({ ...cur, ...patch }));
  },
  setTitle(title: string) {
    if (bridge) bridge.setTitle(title);
    else document.title = title;
  },
  setDirty(d: boolean) {
    bridge?.setDirty(d);
  },
  openExternal(url: string) {
    if (bridge) bridge.openExternal(url);
    else window.open(url, '_blank', 'noopener');
  },
};
