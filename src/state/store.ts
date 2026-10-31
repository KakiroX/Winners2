import { create } from 'zustand';
import { produce, setAutoFreeze } from 'immer';
import type { Analysis, AnalysisKind, AnyItem, ChartType, DataTable, Figure, Graph, InfoSheet, ItemType, Project, Script, TableKind, YFormat } from '../model/types';
import { newGraph, newProject, newTable, sampleTable, uid, defaultChartFor } from '../model/table';
import { analysisDef, defaultParams, runAnalysis } from '../analysis/registry';
import type { VarInfo, FigureSnapshot } from '../lang/protocol';

setAutoFreeze(false);

export interface ConsoleEntry {
  id: number;
  kind: 'input' | 'output' | 'error' | 'info';
  text: string;
}

export type DialogState =
  | { kind: 'newTable' }
  | { kind: 'analyze'; tableId?: string; analysisId?: string; presetKind?: AnalysisKind }
  | { kind: 'newGraph'; tableId?: string }
  | { kind: 'export'; itemId: string }
  | { kind: 'settings'; tab?: string }
  | { kind: 'about' }
  | { kind: 'variable'; name: string }
  | { kind: 'confirm'; title: string; message: string; onOk: () => void; okLabel?: string }
  | { kind: 'prompt'; title: string; label: string; value: string; onOk: (v: string) => void }
  | null;

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
}

export interface Settings {
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  theme: 'light' | 'dark' | 'system';
  defaultGraphTheme: 'prism' | 'matlab' | 'minimal';
  defaultPalette: string;
  exportDpi: number;
  autosave: boolean;
  allowClaudeCode: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  model: 'claude-opus-5-5',
  effort: 'medium',
  theme: 'light',
  defaultGraphTheme: 'prism',
  defaultPalette: 'prism',
  exportDpi: 300,
  autosave: false,
  allowClaudeCode: true,
};

interface State {
  project: Project;
  filePath: string | null;
  dirty: boolean;
  activeId: string | null;
  openTabs: string[];
  past: Project[];
  future: Project[];
  rightPanel: 'format' | 'claude' | null;
  bottomOpen: boolean;
  navWidth: number;
  rightWidth: number;
  bottomHeight: number;
  dialog: DialogState;
  console: ConsoleEntry[];
  history: string[];
  workspace: VarInfo[];
  engineBusy: boolean;
  settings: Settings;
  apiKeySet: boolean;
  toasts: Toast[];
  selectedSeries: string | null;

  update: (fn: (p: Project) => void, opts?: { undoable?: boolean }) => void;
  undo: () => void;
  redo: () => void;
  open: (id: string | null) => void;
  closeTab: (id: string) => void;
  setDialog: (d: DialogState) => void;
  set: (patch: Partial<State>) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  log: (kind: ConsoleEntry['kind'], text: string) => void;

  addTable: (kind: TableKind, opts?: { name?: string; sample?: boolean; replicates?: number; yFormat?: YFormat; open?: boolean }) => string;
  addTableObject: (t: DataTable, open?: boolean) => string;
  addAnalysis: (tableId: string, kind: AnalysisKind, params?: Record<string, any>, datasetIds?: string[], open?: boolean) => string;
  addGraph: (tableId: string, chart?: ChartType, opts?: { analysisId?: string; name?: string; open?: boolean }) => string;
  addScript: (name?: string, code?: string, open?: boolean) => string;
  addInfo: (name?: string, text?: string) => string;
  syncFigures: (figs: FigureSnapshot[]) => void;
  deleteItem: (id: string) => void;
  renameItem: (id: string, name: string) => void;
  duplicateItem: (id: string) => string | null;
  loadProject: (p: Project, path: string | null) => void;
  newProjectAction: () => void;
}

let consoleSeq = 0;
let toastSeq = 0;

export const useStore = create<State>((set, get) => ({
  project: newProject(),
  filePath: null,
  dirty: false,
  activeId: null,
  openTabs: [],
  past: [],
  future: [],
  rightPanel: 'format',
  bottomOpen: true,
  navWidth: 250,
  rightWidth: 360,
  bottomHeight: 230,
  dialog: null,
  console: [{ id: consoleSeq++, kind: 'info', text: 'Quanta Studio command window — MATLAB-compatible. Type commands at the >> prompt, e.g.  x = linspace(0, 2*pi); plot(x, sin(x))' }],
  history: [],
  workspace: [],
  engineBusy: false,
  settings: DEFAULT_SETTINGS,
  apiKeySet: false,
  toasts: [],
  selectedSeries: null,

  update(fn, opts = {}) {
    const prev = get().project;
    const next = produce(prev, (d) => {
      fn(d as Project);
    });
    if (next === prev) return;
    set({ project: next, dirty: true, ...(opts.undoable === false ? {} : { past: [...get().past.slice(-80), prev], future: [] }) });
  },
  undo() {
    const { past, project, future } = get();
    if (!past.length) return;
    set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future], dirty: true });
  },
  redo() {
    const { past, project, future } = get();
    if (!future.length) return;
    set({ project: future[0], future: future.slice(1), past: [...past, project], dirty: true });
  },
  open(id) {
    if (!id) return set({ activeId: null });
    const tabs = get().openTabs;
    set({ activeId: id, openTabs: tabs.includes(id) ? tabs : [...tabs, id].slice(-12), selectedSeries: null });
  },
  closeTab(id) {
    const tabs = get().openTabs.filter((t) => t !== id);
    const active = get().activeId === id ? tabs[tabs.length - 1] ?? null : get().activeId;
    set({ openTabs: tabs, activeId: active });
  },
  setDialog(d) {
    set({ dialog: d });
  },
  set(patch) {
    set(patch as any);
  },
  toast(text, kind = 'info') {
    const t = { id: toastSeq++, text, kind };
    set({ toasts: [...get().toasts, t] });
    setTimeout(() => set({ toasts: get().toasts.filter((x) => x.id !== t.id) }), kind === 'error' ? 7000 : 3500);
  },
  log(kind, text) {
    const c = get().console;
    if (text === '\x1b[clear]' || text.includes('\x1b[clear]')) {
      set({ console: [] });
      text = text.split('\x1b[clear]').pop() ?? '';
      if (!text) return;
    }
    const last = c[c.length - 1];
    if (last && last.kind === kind && kind === 'output') {
      const merged = [...c.slice(0, -1), { ...last, text: last.text + text }];
      set({ console: merged.slice(-2000) });
    } else set({ console: [...c, { id: consoleSeq++, kind, text }].slice(-2000) });
  },

  addTable(kind, opts = {}) {
    const p = get().project;
    const name = opts.name ?? `Data ${p.tables.filter((t) => !t.derivedFrom).length + 1}`;
    const t = opts.sample ? sampleTable(kind, name, p.tables.length) : newTable(kind, name, { replicates: opts.replicates, yFormat: opts.yFormat });
    return get().addTableObject(t, opts.open !== false);
  },
  addTableObject(t, open = true) {
    get().update((p) => {
      p.tables.push(t);
    });
    if (open) get().open(t.id);
    return t.id;
  },
  addAnalysis(tableId, kind, params, datasetIds, open = true) {
    const def = analysisDef(kind);
    const t = tableFor(get().project, tableId);
    const a: Analysis = { id: uid('an'), type: 'analysis', name: `${def.name.split(' (')[0]} of ${t?.name ?? 'data'}`, kind, tableId, datasetIds, params: { ...defaultParams(kind), ...(params ?? {}) } };
    get().update((p) => {
      p.analyses.push(a);
    });
    if (open) get().open(a.id);
    return a.id;
  },
  addGraph(tableId, chart, opts = {}) {
    const proj = get().project;
    const t = tableFor(proj, opts.analysisId ? `derived:${opts.analysisId}` : tableId) ?? tableFor(proj, tableId);
    if (!t) return '';
    const g: Graph = newGraph(t, opts.name ?? `${t.name}`, chart ?? defaultChartFor(t.kind), opts.analysisId);
    g.tableId = t.derivedFrom ? (proj.analyses.find((a) => a.id === t.derivedFrom)?.tableId ?? tableId) : tableId;
    const s = get().settings;
    g.options.theme = s.defaultGraphTheme;
    g.options.palette = s.defaultGraphTheme === 'matlab' && s.defaultPalette === 'prism' ? 'matlab' : s.defaultPalette;
    // Overlay curve fits from analyses on this table
    g.fitAnalysisIds = proj.analyses.filter((a) => a.tableId === t.id && (a.kind === 'nonlin' || a.kind === 'linreg')).map((a) => a.id);
    if (opts.analysisId) {
      const an = proj.analyses.find((a) => a.id === opts.analysisId);
      if (an?.kind === 'freqDist') {
        g.chart = chart ?? 'histogram';
        g.options.yAxis.title = an.params.relative === 'percent' ? 'Percent' : an.params.relative === 'fraction' ? 'Fraction' : 'Number of values';
        g.options.xAxis.title = 'Bin center';
        g.options.barWidth = 1;
      }
      if (an?.kind === 'roc') {
        g.chart = 'xy';
        g.options.xAxis.title = '100% - Specificity%';
        g.options.yAxis.title = 'Sensitivity%';
        g.options.showPoints = false;
        g.options.connectLines = true;
      }
      if (an?.kind === 'blandAltman') {
        g.chart = 'xy';
        g.options.xAxis.title = 'Average';
        g.options.yAxis.title = 'Difference';
        g.options.connectLines = false;
      }
      if (an?.kind === 'corrMatrix') g.chart = 'heatmap';
      if (an?.kind === 'pca') {
        g.chart = 'xy';
        g.options.xAxis.title = 'PC1';
        g.options.yAxis.title = 'PC2';
        g.options.connectLines = false;
        g.datasetIds = t.datasets.slice(0, 1).map((d) => d.id);
      }
    }
    if (t.kind === 'multi' && (chart ?? g.chart) === 'xy' && t.datasets.length >= 2 && !opts.analysisId) {
      g.datasetIds = t.datasets.slice(0, 2).map((d) => d.id);
      g.options.xAxis.title = t.datasets[0].title;
      g.options.yAxis.title = t.datasets[1].title;
    }
    get().update((p) => {
      p.graphs.push(g);
    });
    if (opts.open !== false) get().open(g.id);
    return g.id;
  },
  addScript(name, code, open = true) {
    const p = get().project;
    const s: Script = { id: uid('sc'), type: 'script', name: name ?? `script${p.scripts.length + 1}.m`, code: code ?? '% New script\n' };
    get().update((d) => {
      d.scripts.push(s);
    });
    if (open) get().open(s.id);
    return s.id;
  },
  addInfo(name, text) {
    const p = get().project;
    const i: InfoSheet = { id: uid('info'), type: 'info', name: name ?? `Notes ${p.infos.length + 1}`, text: text ?? '' };
    get().update((d) => {
      d.infos.push(i);
    });
    get().open(i.id);
    return i.id;
  },
  syncFigures(figs) {
    const p = get().project;
    const byNum = new Map(p.figures.map((f) => [f.number, f]));
    const next: Figure[] = figs.map((f) => ({ id: byNum.get(f.number)?.id ?? uid('fig'), type: 'figure', name: f.name, number: f.number, spec: f.spec }));
    const added = next.filter((f) => !byNum.has(f.number));
    const changed = next.filter((f) => byNum.has(f.number) && byNum.get(f.number)!.spec !== f.spec);
    get().update((d) => {
      d.figures = next;
    }, { undoable: false });
    const target = added[added.length - 1] ?? changed[changed.length - 1];
    if (target) get().open(target.id);
    const valid = new Set(next.map((f) => f.id));
    const allIds = new Set(allItems(get().project).map((x) => x.id));
    set({ openTabs: get().openTabs.filter((t) => valid.has(t) || allIds.has(t)) });
  },
  deleteItem(id) {
    const p = get().project;
    const found = findItem(p, id);
    if (!found) return;
    get().update((d) => {
      switch (found.type) {
        case 'table': {
          const anIds = d.analyses.filter((a) => a.tableId === id).map((a) => a.id);
          d.tables = d.tables.filter((t) => t.id !== id);
          d.analyses = d.analyses.filter((a) => a.tableId !== id);
          d.graphs = d.graphs.filter((g) => g.tableId !== id && !anIds.includes(g.analysisId ?? ''));
          break;
        }
        case 'analysis':
          d.analyses = d.analyses.filter((a) => a.id !== id);
          d.graphs = d.graphs.filter((g) => g.analysisId !== id).map((g) => ({ ...g, fitAnalysisIds: g.fitAnalysisIds.filter((f) => f !== id) }));
          break;
        case 'graph':
          d.graphs = d.graphs.filter((g) => g.id !== id);
          break;
        case 'script':
          d.scripts = d.scripts.filter((s) => s.id !== id);
          break;
        case 'figure':
          d.figures = d.figures.filter((f) => f.id !== id);
          break;
        case 'info':
          d.infos = d.infos.filter((i) => i.id !== id);
          break;
      }
    });
    const ids = new Set(allItems(get().project).map((x) => x.id));
    const tabs = get().openTabs.filter((t) => ids.has(t));
    set({ openTabs: tabs, activeId: get().activeId && ids.has(get().activeId!) ? get().activeId : tabs[tabs.length - 1] ?? null });
  },
  renameItem(id, name) {
    get().update((d) => {
      const f = findItem(d, id);
      if (f) (f.item as any).name = name;
    });
  },
  duplicateItem(id) {
    const f = findItem(get().project, id);
    if (!f || f.type === 'figure') return null;
    const copy: any = structuredClone(f.item);
    copy.id = uid(f.type.slice(0, 3));
    copy.name = `${copy.name} (copy)`;
    if (f.type === 'table') copy.datasets = copy.datasets.map((d: any) => ({ ...d, id: uid('ds') }));
    get().update((d) => {
      const key = ({ table: 'tables', analysis: 'analyses', graph: 'graphs', script: 'scripts', info: 'infos' } as const)[f.type as Exclude<ItemType, 'figure'>];
      (d as any)[key].push(copy);
    });
    get().open(copy.id);
    return copy.id;
  },
  loadProject(p, path) {
    set({ project: p, filePath: path, dirty: false, past: [], future: [], openTabs: [], activeId: null });
    const first = p.graphs[0]?.id ?? p.tables[0]?.id ?? p.scripts[0]?.id ?? null;
    if (first) get().open(first);
  },
  newProjectAction() {
    set({ project: newProject(), filePath: null, dirty: false, past: [], future: [], openTabs: [], activeId: null });
  },
}));

// ---------------- Helpers ----------------
export function allItems(p: Project): AnyItem[] {
  return [...p.tables, ...p.analyses, ...p.graphs, ...p.scripts, ...p.figures, ...p.infos];
}

export function findItem(p: Project, id: string): { type: ItemType; item: AnyItem } | null {
  for (const t of p.tables) if (t.id === id) return { type: 'table', item: t };
  for (const a of p.analyses) if (a.id === id) return { type: 'analysis', item: a };
  for (const g of p.graphs) if (g.id === id) return { type: 'graph', item: g };
  for (const s of p.scripts) if (s.id === id) return { type: 'script', item: s };
  for (const f of p.figures) if (f.id === id) return { type: 'figure', item: f };
  for (const i of p.infos) if (i.id === id) return { type: 'info', item: i };
  return null;
}

/** Resolve a table id, including derived tables produced by analyses ("derived:<analysisId>"). */
export function tableFor(p: Project, id: string): DataTable | undefined {
  if (id.startsWith('derived:')) {
    const a = p.analyses.find((x) => x.id === id.slice(8));
    if (!a) return undefined;
    const src = tableFor(p, a.tableId);
    if (!src) return undefined;
    return runAnalysis(src, a).derivedTable;
  }
  return p.tables.find((t) => t.id === id);
}

export function graphCtx(p: Project) {
  return { project: p, tableFor: (id: string) => tableFor(p, id) };
}

export function itemIcon(type: ItemType): string {
  return type;
}
