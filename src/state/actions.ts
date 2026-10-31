import { useStore, tableFor, findItem, graphCtx } from './store';
import { engine, referencedReadPaths, type ExecResult } from '../lang/client';
import { platform } from '../platform';
import { deserializeProject, serializeProject, PROJECT_EXT } from '../io/project';
import { readPzfx, writePzfx } from '../io/pzfx';
import { tableFromDelimited, tableToCSV } from '../io/csv';
import { compileGraph } from '../graph/compile';
import { renderFigure } from '../graph/render';
import { exportBytes, EXPORT_FORMATS, type ExportFormat } from '../graph/export';
import type { AnalysisKind, ChartType, Graph, Figure, TableKind } from '../model/types';
import type { FigureSpec } from '../graph/spec';
import { CHART_LABELS, chartsFor } from '../model/table';

const S = () => useStore.getState();

// ---------------- Code execution ----------------
export async function runCode(code: string, opts: { echo?: boolean; sandbox?: boolean; timeoutMs?: number; unitName?: string; quiet?: boolean } = {}): Promise<ExecResult> {
  const st = S();
  const p = st.project;
  if (opts.echo) st.log('input', code);
  // Preload files referenced by literal paths (desktop only)
  const files: Record<string, Uint8Array> = {};
  if (platform.isDesktop && !opts.sandbox) {
    for (const path of referencedReadPaths(code)) {
      try {
        const resolved = await platform.bridge!.resolvePath(path);
        const data = await platform.readFile(resolved);
        if (data) files[path] = data;
      } catch {
        /* the interpreter reports missing files */
      }
    }
  }
  const tables = [...p.tables, ...p.analyses.map((a) => tableFor(p, `derived:${a.id}`)).filter((t): t is NonNullable<typeof t> => !!t)];
  useStore.setState({ engineBusy: true });
  const res = await engine().exec(code, {
    tables,
    files,
    sandbox: opts.sandbox,
    timeoutMs: opts.timeoutMs ?? (opts.sandbox ? 30000 : 0),
    library: p.scripts.map((s) => ({ name: s.name.replace(/\.m$/, ''), code: s.code })),
    unitName: opts.unitName,
    onOutput: opts.quiet ? undefined : (s) => S().log('output', s),
  });
  useStore.setState({ engineBusy: false, workspace: res.workspace });
  if (res.timedOut && !opts.quiet) S().log('error', res.error ?? 'Execution stopped.');
  await applyEffects(res, opts.sandbox);
  if (res.figures) S().syncFigures(res.figures);
  return res;
}

async function applyEffects(res: ExecResult, sandbox?: boolean) {
  const st = S();
  for (const e of res.effects) {
    switch (e.type) {
      case 'putTable': {
        const exists = st.project.tables.some((t) => t.id === e.table.id);
        if (exists) st.update((p) => {
          p.tables = p.tables.map((t) => (t.id === e.table.id ? { ...e.table, notes: t.notes } : t));
        });
        else st.addTableObject(e.table, false);
        break;
      }
      case 'createGraph': {
        const t = S().project.tables.find((x) => x.name === e.tableName);
        if (t) S().addGraph(t.id, (chartsFor(t.kind).includes(e.chart as ChartType) ? e.chart : undefined) as ChartType | undefined);
        break;
      }
      case 'createAnalysis': {
        const t = S().project.tables.find((x) => x.name === e.tableName);
        if (t) S().addAnalysis(t.id, e.kind as AnalysisKind, e.params);
        break;
      }
      case 'writeFile': {
        if (sandbox) break;
        try {
          const path = await platform.bridge?.resolvePath(e.path) ?? e.path;
          await platform.writeFile(path, e.data);
          S().log('info', `Saved ${path}`);
        } catch (err: any) {
          S().log('error', `Could not write ${e.path}: ${err.message}`);
        }
        break;
      }
      case 'saveFigure': {
        if (sandbox) break;
        const fig = (res.figures ?? []).find((f) => f.number === e.number) ?? S().project.figures.find((f) => f.number === e.number);
        if (!fig) break;
        const fmt = (({ jpg: 'jpeg', jpeg: 'jpeg', png: 'png', svg: 'svg', pdf: 'pdf', tif: 'tiff', tiff: 'tiff' } as Record<string, ExportFormat>)[e.format] ?? 'png') as ExportFormat;
        try {
          const bytes = await exportBytes(renderFigure(fig.spec), fig.spec.width, fig.spec.height, fmt, S().settings.exportDpi);
          const path = await platform.bridge?.resolvePath(e.path) ?? e.path;
          await platform.writeFile(path, bytes);
          S().log('info', `Saved figure to ${path}`);
        } catch (err: any) {
          S().log('error', `Could not save figure: ${err.message}`);
        }
        break;
      }
    }
  }
}

export async function runScript(scriptId: string, selection?: string) {
  const s = S().project.scripts.find((x) => x.id === scriptId);
  if (!s) return;
  S().set({ bottomOpen: true });
  const isFunctionFile = /^\s*(%[^\n]*\n\s*)*function\b/.test(s.code);
  if (isFunctionFile && !selection) {
    S().log('info', `${s.name} is a function file. Call it from the command window, e.g. ${s.name.replace(/\.m$/, '')}(...)`);
    return;
  }
  S().log('input', selection ? `% Run selection from ${s.name}` : `run('${s.name}')`);
  await runCode(selection ?? s.code, { unitName: s.name.replace(/\.m$/, '') });
}

export function stopExecution() {
  engine().restart();
  useStore.setState({ engineBusy: false, workspace: [] });
  S().log('error', 'Execution stopped by user. The workspace was cleared.');
}

// ---------------- Project files ----------------
const PROJECT_FILTERS = [{ name: 'Quanta Studio project', extensions: [PROJECT_EXT] }];

export async function saveProject(saveAs = false): Promise<boolean> {
  const st = S();
  const text = serializeProject(st.project);
  const name = `${st.project.name.replace(/[^\w\- ]+/g, '') || 'project'}.${PROJECT_EXT}`;
  const path = await platform.saveFile(name, PROJECT_FILTERS, text, saveAs ? null : st.filePath);
  if (!path) return false;
  useStore.setState({ filePath: platform.isDesktop ? path : null, dirty: false });
  if (platform.isDesktop) {
    const base = path.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
    if (st.project.name.startsWith('Untitled')) st.update((p) => void (p.name = base), { undoable: false });
    useStore.setState({ dirty: false });
  }
  st.toast('Project saved', 'success');
  return true;
}

export async function confirmDiscard(): Promise<boolean> {
  if (!S().dirty) return true;
  return new Promise((resolve) => {
    S().setDialog({ kind: 'confirm', title: 'Discard unsaved changes?', message: 'The current project has unsaved changes. Continue without saving?', okLabel: 'Discard changes', onOk: () => resolve(true) });
    const unsub = useStore.subscribe((s) => {
      if (!s.dialog) {
        unsub();
        resolve(false);
      }
    });
  });
}

export async function newProject() {
  if (!(await confirmDiscard())) return;
  S().newProjectAction();
}

export async function openProjectDialog() {
  const files = await platform.openFiles([
    { name: 'Projects and data', extensions: [PROJECT_EXT, 'pzfx', 'csv', 'tsv', 'txt', 'm', 'mat'] },
    { name: 'All files', extensions: ['*'] },
  ]);
  if (!files.length) return;
  await openFileData(files[0].name, files[0].data, files[0].path);
}

export async function openPath(path: string) {
  const data = await platform.readFile(path);
  if (!data) return S().toast(`Could not read ${path}`, 'error');
  await openFileData(path.replace(/^.*[\\/]/, ''), data, path);
}

export async function openFileData(name: string, data: Uint8Array, path: string | null) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  try {
    if (ext === PROJECT_EXT) {
      if (!(await confirmDiscard())) return;
      const p = deserializeProject(new TextDecoder().decode(data));
      S().loadProject(p, path);
      S().toast(`Opened ${name}`, 'success');
      return;
    }
    await importFileData(name, data);
  } catch (e: any) {
    S().toast(`Could not open ${name}: ${e.message}`, 'error');
  }
}

export async function importDialog() {
  const files = await platform.openFiles([
    { name: 'Data files', extensions: ['pzfx', 'csv', 'tsv', 'txt', 'mat', 'm'] },
    { name: 'All files', extensions: ['*'] },
  ], true);
  for (const f of files) await importFileData(f.name, f.data);
}

export async function importFileData(name: string, data: Uint8Array, kind?: TableKind) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const st = S();
  const base = name.replace(/\.[^.]+$/, '');
  switch (ext) {
    case 'pzfx': {
      const r = readPzfx(new TextDecoder().decode(data));
      st.update((p) => {
        p.tables.push(...r.tables);
        p.infos.push(...r.infos);
      });
      if (r.tables[0]) st.open(r.tables[0].id);
      st.toast(`Imported ${r.tables.length} table(s) from ${name}${r.warnings.length ? ` — ${r.warnings.join(' ')}` : ''}`, 'success');
      return;
    }
    case 'csv':
    case 'tsv':
    case 'txt': {
      const t = tableFromDelimited(new TextDecoder().decode(data), kind ?? guessKind(new TextDecoder().decode(data)), base);
      st.addTableObject(t);
      st.toast(`Imported ${name} as a ${t.kind} table`, 'success');
      return;
    }
    case 'm': {
      st.addScript(name, new TextDecoder().decode(data));
      return;
    }
    case 'mat': {
      const r = await engine().loadMat(data);
      useStore.setState({ workspace: r.workspace, bottomOpen: true });
      st.log('info', r.ok ? `Loaded ${name} into the workspace.` : `Could not load ${name}: ${r.error}`);
      return;
    }
    default:
      st.toast(`Unsupported file type: .${ext}`, 'error');
  }
}

function guessKind(text: string): TableKind {
  const first = text.split(/\r?\n/)[0]?.toLowerCase() ?? '';
  if (/^\s*(x|time|dose|conc|concentration|log)/.test(first)) return 'xy';
  return 'column';
}

export async function exportTable(tableId: string, format: 'csv' | 'pzfx') {
  const t = tableFor(S().project, tableId);
  if (!t) return;
  if (format === 'csv') await platform.saveFile(`${t.name}.csv`, [{ name: 'CSV', extensions: ['csv'] }], tableToCSV(t));
  else await platform.saveFile(`${t.name}.pzfx`, [{ name: 'Prism XML', extensions: ['pzfx'] }], writePzfx([t]));
}

export async function exportAllPzfx() {
  const p = S().project;
  await platform.saveFile(`${p.name}.pzfx`, [{ name: 'Prism XML', extensions: ['pzfx'] }], writePzfx(p.tables, p.infos));
}

export async function saveScriptToDisk(scriptId: string) {
  const s = S().project.scripts.find((x) => x.id === scriptId);
  if (!s) return;
  const path = await platform.saveFile(s.name.endsWith('.m') ? s.name : `${s.name}.m`, [{ name: 'MATLAB script', extensions: ['m'] }], s.code, s.path ?? null);
  if (path && platform.isDesktop) S().update((p) => {
    const x = p.scripts.find((y) => y.id === scriptId);
    if (x) x.path = path;
  }, { undoable: false });
}

export async function saveWorkspaceMat() {
  const bytes = await engine().saveMat();
  await platform.saveFile('workspace.mat', [{ name: 'MAT-file', extensions: ['mat'] }], bytes);
}

// ---------------- Graph rendering & export ----------------
export function specForItem(id: string): FigureSpec | null {
  const p = S().project;
  const f = findItem(p, id);
  if (!f) return null;
  if (f.type === 'graph') return compileGraph(f.item as Graph, graphCtx(p));
  if (f.type === 'figure') return (f.item as Figure).spec;
  return null;
}

export function svgForItem(id: string, opts: { interactive?: boolean } = {}): string | null {
  const spec = specForItem(id);
  return spec ? renderFigure(spec, opts) : null;
}

export async function exportGraph(id: string, format: ExportFormat, dpi: number, scale = 1) {
  const spec = specForItem(id);
  if (!spec) return;
  const s = { ...spec, width: spec.width * scale, height: spec.height * scale };
  const svg = renderFigure(s);
  const bytes = await exportBytes(svg, s.width, s.height, format, dpi);
  const info = EXPORT_FORMATS.find((f) => f.value === format)!;
  const item = findItem(S().project, id)!;
  const path = await platform.saveFile(`${(item.item as any).name}.${info.ext}`, [{ name: info.label, extensions: [info.ext] }], bytes);
  if (path) S().toast(`Exported ${path.replace(/^.*[\\/]/, '')}`, 'success');
}

export function chartLabel(c: ChartType) {
  return CHART_LABELS[c];
}

export { analysisKindsFor } from './analysisHelpers';
