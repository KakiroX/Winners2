/// <reference lib="webworker" />
import { createInterpreter } from './index';
import { describeVar, displayBody } from './display';
import { MError, Tensor, str, type Value } from './value';
import { readMat, writeMat } from '../io/mat';
import type { Effect, FromWorker, ToWorker, VarInfo } from './protocol';
import type { DataTable, TableKind } from '../model/types';
import { emptyDataset, newTable, rowCount } from '../model/table';
import { runAnalysis, defaultParams, ANALYSES, resultsToText } from '../analysis/registry';
import type { GraphicsState } from './builtins/graphics';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let currentId = 0;
let outBuf = '';
let flushTimer: any = null;
let tables: DataTable[] = [];
let files: Record<string, Uint8Array> = {};
let effects: Effect[] = [];

function post(m: FromWorker) {
  ctx.postMessage(m);
}

function flush() {
  if (outBuf) {
    post({ type: 'out', id: currentId, text: outBuf });
    outBuf = '';
  }
  flushTimer = null;
}

const I = createInterpreter({
  print: (s) => {
    outBuf += s;
    if (outBuf.length > 20000) flush();
    else if (!flushTimer) flushTimer = setTimeout(flush, 40);
  },
  readFile: (path) => files[path] ?? files[normalize(path)] ?? null,
  writeFile: (path, data) => {
    effects.push({ type: 'writeFile', path, data });
    files[path] = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  },
  app: {
    listTables: () => tables.map((t) => ({ name: t.name, kind: t.kind, rows: rowCount(t), datasets: t.datasets.map((d) => d.title) })),
    getTable: (name) => {
      const t = findTable(name);
      if (!t) return null;
      return { kind: t.kind, x: t.x, rowTitles: t.rowTitles, datasets: t.datasets.map((d) => ({ title: d.title, cols: d.cols })) };
    },
    putTable: (spec) => {
      const kind = (['xy', 'column', 'grouped', 'contingency', 'survival', 'parts', 'multi'].includes(spec.kind) ? spec.kind : 'column') as TableKind;
      const existing = findTable(spec.name);
      const reps = Math.max(1, ...spec.datasets.map((d) => d.cols.length));
      const t = newTable(kind, spec.name, { datasets: 0, replicates: kind === 'xy' || kind === 'grouped' ? reps : 1 });
      if (existing) t.id = existing.id;
      if (spec.x) t.x = spec.x.map((v) => (Number.isFinite(v) ? v : null));
      if ((spec as any).xTitle) t.xTitle = (spec as any).xTitle;
      if (spec.rowTitles) t.rowTitles = spec.rowTitles;
      for (const d of spec.datasets) {
        const ds = emptyDataset(t, d.title);
        if (kind === 'xy' || kind === 'grouped') ds.cols = Array.from({ length: reps }, (_, k) => d.cols[k] ?? []);
        else ds.cols = [d.cols.flat()];
        t.datasets.push(ds);
      }
      tables = existing ? tables.map((x) => (x.id === t.id ? t : x)) : [...tables, t];
      effects.push({ type: 'putTable', table: t });
    },
    runAnalysis: (tableName, kind, params) => {
      const t = findTable(tableName);
      if (!t) throw new MError(`No data table named '${tableName}'.`);
      const def = ANALYSES.find((a) => a.kind === kind || a.name.toLowerCase() === kind.toLowerCase());
      if (!def) throw new MError(`Unknown analysis '${kind}'. Available: ${ANALYSES.map((a) => a.kind).join(', ')}`);
      const save = params.Save ?? params.save;
      delete params.Save;
      delete params.save;
      const a = { id: 'tmp', type: 'analysis' as const, name: def.name, kind: def.kind, tableId: t.id, params: { ...defaultParams(def.kind), ...params } };
      const res = runAnalysis(t, a);
      if (save) effects.push({ type: 'createAnalysis', tableName, kind: def.kind, params: a.params });
      return resultsToText(res);
    },
    makeGraph: (tableName, chart) => {
      const t = findTable(tableName);
      if (!t) throw new MError(`No data table named '${tableName}'.`);
      effects.push({ type: 'createGraph', tableName, chart });
      return `Graph of '${tableName}' added to the project.`;
    },
  },
});

function normalize(p: string) {
  return p.replace(/\\/g, '/');
}

function findTable(name: string) {
  return tables.find((t) => t.name === name) ?? tables.find((t) => t.name.toLowerCase() === name.toLowerCase());
}

let library: { name: string; code: string }[] = [];

I.register('__runscript__', (a) => {
  const name = (a[0] as Tensor).toStr();
  const s = library.find((x) => x.name === name || x.name === `${name}.m` || x.name.replace(/\.m$/, '') === name);
  if (!s) throw new MError(`Undefined script or function '${name}'.`);
  I.run(s.code, { throwErrors: true, unitName: s.name });
});

I.register('__savefigure__', (a) => {
  const G = I.graphics as GraphicsState;
  let fig = G.current;
  let rest = a;
  if (a.length > 1 && a[0].kind === 'tensor' && a[0].cls !== 'char') {
    fig = (a[0] as Tensor).re[0];
    rest = a.slice(1);
  }
  const path = rest.map((v) => (v.kind === 'tensor' && v.cls === 'char' ? v.toStr() : '')).find((s) => s && !s.startsWith('-')) ?? `figure${fig}.png`;
  const ext = (path.match(/\.([a-z0-9]+)$/i)?.[1] ?? 'png').toLowerCase();
  effects.push({ type: 'saveFigure', number: G.handles.get(fig)?.fig ?? fig, path, format: ext });
});

function workspace(): VarInfo[] {
  return I.workspaceVars().map(([name, v]) => ({ name, ...describeVar(v) }));
}

function serialize(name: string, v: Value) {
  const base = { name, kind: v.kind, cls: v.kind === 'tensor' ? v.cls : v.kind, rows: v.rows, cols: v.cols, text: displayBody(v, { ...I.display, compact: true }) };
  if (v.kind === 'tensor' && v.numel <= 200000) return { ...base, re: Array.from(v.re), im: v.im ? Array.from(v.im) : undefined };
  return base;
}

ctx.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  currentId = m.id;
  switch (m.type) {
    case 'exec': {
      tables = m.tables;
      files = { ...files, ...m.files };
      library = m.library;
      effects = [];
      for (const s of m.library) if (/^\s*(%[^\n]*\n\s*)*function\b/.test(s.code)) I.defineLibrary(s.name, s.code);
      I.sandboxed = m.sandbox;
      I.deadline = m.timeoutMs > 0 ? Date.now() + m.timeoutMs : Infinity;
      I.steps = 0;
      let ok = true;
      let error: string | undefined;
      try {
        if (m.echo) I.print(`>> ${m.code}\n`);
        let errText = '';
        const origPrint = I.io.print;
        ok = I.run(m.code, { unitName: m.unitName });
        void origPrint;
        void errText;
      } catch (e: any) {
        ok = false;
        error = e?.message ?? String(e);
        I.print(`Error: ${error}\n`);
      }
      I.sandboxed = false;
      I.deadline = Infinity;
      flush();
      const G = I.graphics as GraphicsState;
      const figures = G.changed ? G.snapshot() : undefined;
      G.changed = false;
      post({ type: 'done', id: m.id, ok, error, workspace: workspace(), figures, effects });
      break;
    }
    case 'getVar': {
      const v = I.base.vars.get(m.name);
      post({ type: 'var', id: m.id, value: v ? serialize(m.name, v) : null });
      break;
    }
    case 'setVar': {
      const t = new Tensor(m.rows, m.cols, Float64Array.from(m.data));
      I.base.vars.set(m.name, t);
      post({ type: 'done', id: m.id, ok: true, workspace: workspace(), effects: [] });
      break;
    }
    case 'loadMat': {
      try {
        const vars = readMat(m.data);
        for (const [n, v] of vars) I.base.vars.set(n, v);
        I.print(`Loaded ${vars.size} variable(s): ${[...vars.keys()].join(', ')}\n`);
        flush();
        post({ type: 'done', id: m.id, ok: true, workspace: workspace(), effects: [] });
      } catch (e: any) {
        I.print(`Error: ${e.message}\n`);
        flush();
        post({ type: 'done', id: m.id, ok: false, error: e.message, workspace: workspace(), effects: [] });
      }
      break;
    }
    case 'saveMat': {
      try {
        const vars = (m.names.length ? m.names : [...I.base.vars.keys()]).map((n) => [n, I.base.vars.get(n)!] as [string, Value]).filter(([, v]) => v && v.kind !== 'fhandle');
        post({ type: 'bytes', id: m.id, data: writeMat(vars) });
      } catch (e: any) {
        post({ type: 'bytes', id: m.id, data: null, error: e.message });
      }
      break;
    }
    case 'clear': {
      I.clearAll();
      post({ type: 'done', id: m.id, ok: true, workspace: [], effects: [] });
      break;
    }
    case 'names': {
      post({ type: 'names', id: m.id, names: [...I.base.vars.keys(), ...I.builtins.keys()] });
      break;
    }
  }
};

void str;
