// Main-thread client for the interpreter worker.
import type { DataTable } from '../model/types';
import type { Effect, FigureSnapshot, FromWorker, SerializedVar, ToWorker, VarInfo } from './protocol';

export interface ExecResult {
  ok: boolean;
  output: string;
  error?: string;
  workspace: VarInfo[];
  figures?: FigureSnapshot[];
  effects: Effect[];
  timedOut?: boolean;
}

type Pending = { resolve: (v: any) => void; output: string; onOutput?: (s: string) => void; timer?: any };

export class EngineClient {
  private worker!: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  busy = false;
  onRestart?: () => void;

  constructor() {
    this.spawn();
  }

  private spawn() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      const p = this.pending.get(m.id);
      if (!p) return;
      switch (m.type) {
        case 'out':
          p.output += m.text;
          p.onOutput?.(m.text);
          break;
        case 'done':
          this.pending.delete(m.id);
          clearTimeout(p.timer);
          p.resolve({ ok: m.ok, error: m.error, output: p.output, workspace: m.workspace, figures: m.figures, effects: m.effects });
          break;
        case 'var':
          this.pending.delete(m.id);
          p.resolve(m.value);
          break;
        case 'bytes':
          this.pending.delete(m.id);
          p.resolve(m);
          break;
        case 'names':
          this.pending.delete(m.id);
          p.resolve(m.names);
          break;
      }
    };
    this.worker.onerror = (e) => {
      console.error('Engine worker error', e);
    };
  }

  private send<T>(msg: Omit<ToWorker, 'id'> & { id?: number }, onOutput?: (s: string) => void, timeoutMs = 0): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve) => {
      const p: Pending = { resolve, output: '', onOutput };
      if (timeoutMs > 0) {
        // Hard stop if the worker doesn't respond (e.g. an infinite loop inside a builtin)
        p.timer = setTimeout(() => {
          if (!this.pending.has(id)) return;
          this.restart();
          resolve({ ok: false, error: 'Execution timed out; the engine was restarted and the workspace cleared.', output: p.output, workspace: [], effects: [], timedOut: true } as any);
        }, timeoutMs + 3000);
      }
      this.pending.set(id, p);
      this.worker.postMessage({ ...msg, id });
    });
  }

  async exec(code: string, opts: { tables: DataTable[]; files?: Record<string, Uint8Array>; sandbox?: boolean; timeoutMs?: number; library?: { name: string; code: string }[]; echo?: boolean; unitName?: string; onOutput?: (s: string) => void }): Promise<ExecResult> {
    this.busy = true;
    try {
      return await this.send<ExecResult>(
        { type: 'exec', code, tables: opts.tables, files: opts.files ?? {}, sandbox: !!opts.sandbox, timeoutMs: opts.timeoutMs ?? 0, library: opts.library ?? [], echo: opts.echo, unitName: opts.unitName } as any,
        opts.onOutput,
        opts.timeoutMs ?? 0,
      );
    } finally {
      this.busy = false;
    }
  }

  getVar(name: string): Promise<SerializedVar | null> {
    return this.send({ type: 'getVar', name } as any);
  }

  setVar(name: string, rows: number, cols: number, data: number[]): Promise<ExecResult> {
    return this.send({ type: 'setVar', name, rows, cols, data } as any);
  }

  loadMat(data: Uint8Array): Promise<ExecResult> {
    return this.send({ type: 'loadMat', data } as any);
  }

  async saveMat(names: string[] = []): Promise<Uint8Array> {
    const r: any = await this.send({ type: 'saveMat', names } as any);
    if (!r.data) throw new Error(r.error ?? 'Could not save variables');
    return r.data;
  }

  clear(): Promise<ExecResult> {
    return this.send({ type: 'clear' } as any);
  }

  names(): Promise<string[]> {
    return this.send({ type: 'names' } as any);
  }

  /** Terminate a running computation. The workspace is lost. */
  restart() {
    this.worker.terminate();
    for (const [, p] of this.pending) p.resolve({ ok: false, error: 'Execution stopped.', output: p.output, workspace: [], effects: [] });
    this.pending.clear();
    this.busy = false;
    this.spawn();
    this.onRestart?.();
  }
}

let client: EngineClient | null = null;
export function engine(): EngineClient {
  if (!client) client = new EngineClient();
  return client;
}

/** Find literal file paths a script reads, so they can be preloaded into the worker. */
export function referencedReadPaths(code: string): string[] {
  const out = new Set<string>();
  const re = /\b(?:load|readmatrix|csvread|dlmread|fileread|importdata|isfile)\s*\(\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) out.add(m[1]);
  const cmd = /^\s*load\s+([^\s;,%]+)/gm;
  while ((m = cmd.exec(code))) out.add(/\.\w+$/.test(m[1]) ? m[1] : `${m[1]}.mat`);
  return [...out];
}
