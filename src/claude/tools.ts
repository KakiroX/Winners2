// Tools that let Claude operate Quanta Studio. The same tool set is exposed to the in-app assistant
// and (via the MCP bridge) to Claude Desktop / Claude Code.
import { z } from 'zod';
import { useStore, tableFor, findItem, graphCtx } from '../state/store';
import { ANALYSES, analysisDef, resultsToText, runAnalysis } from '../analysis/registry';
import { CHART_LABELS, chartsFor, emptyDataset, newTable, rowCount, tableSummaryText, TABLE_KIND_INFO, subcolCount } from '../model/table';
import type { AnalysisKind, ChartType, DataTable, Graph, TableKind, YFormat } from '../model/types';
import { compileGraph, significanceAnnotations } from '../graph/compile';
import { renderFigure } from '../graph/render';
import { svgToPngBase64 } from '../graph/export';
import { runCode } from '../state/actions';
import { NL_MODELS } from '../stats/regression';
import { PALETTES } from '../graph/spec';

export type ToolContent = string | ({ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: 'image/png'; data: string } })[];

export interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodType<any>;
  run: (input: any) => Promise<ToolContent>;
}

const S = () => useStore.getState();

function resolveTable(ref: string): DataTable {
  const p = S().project;
  const t = tableFor(p, ref) ?? p.tables.find((x) => x.name === ref) ?? p.tables.find((x) => x.name.toLowerCase() === ref.toLowerCase());
  if (t) return t;
  // analysis output tables
  const a = p.analyses.find((x) => x.id === ref || x.name === ref);
  if (a) {
    const d = tableFor(p, `derived:${a.id}`);
    if (d) return d;
  }
  throw new Error(`No data table "${ref}". Call get_project_overview to see table ids and names.`);
}

function resolveItem(ref: string, prefer: string[] = []) {
  const p = S().project;
  const byId = findItem(p, ref);
  if (byId) return byId;
  const lists = [['table', p.tables], ['analysis', p.analyses], ['graph', p.graphs], ['script', p.scripts], ['figure', p.figures], ['info', p.infos]] as const;
  const ordered = [...lists.filter(([t]) => prefer.includes(t)), ...lists.filter(([t]) => !prefer.includes(t))];
  for (const [type, list] of ordered) {
    const it = (list as any[]).find((x) => x.name === ref || x.name.toLowerCase() === ref.toLowerCase());
    if (it) return { type, item: it };
  }
  throw new Error(`No sheet "${ref}". Call get_project_overview to list sheets.`);
}

const cellArr = z.array(z.union([z.number(), z.null()]));
const dataSetSchema = z.object({
  title: z.string().describe('Data set (column group) title'),
  values: z.union([cellArr, z.array(cellArr)]).describe('Column/multi/contingency/parts/survival tables: one value per row. XY/grouped tables: one array per row containing the replicate values (or [mean, SD] / [mean, SD, N] for summary formats). Use null for empty cells.'),
});

function buildDatasets(t: DataTable, sets: z.infer<typeof dataSetSchema>[]) {
  const nsub = subcolCount(t);
  t.datasets = sets.map((s) => {
    const ds = emptyDataset(t, s.title);
    const rows = s.values as any[];
    if (rows.length && Array.isArray(rows[0])) {
      ds.cols = Array.from({ length: nsub }, (_, k) => rows.map((r: any[]) => (r[k] === undefined ? null : r[k])));
      if (nsub === 1 && (rows as any[][]).some((r) => r.length > 1)) ds.cols = [rows.flat()];
    } else ds.cols = Array.from({ length: nsub }, (_, k) => (k === 0 ? (rows as (number | null)[]) : []));
    return ds;
  });
}

function overview(): string {
  const p = S().project;
  const st = S();
  const lines: string[] = [`Project: ${p.name}`];
  const active = st.activeId ? findItem(p, st.activeId) : null;
  if (active) lines.push(`Currently open sheet: ${active.type} "${(active.item as any).name}" (id ${active.item.id})`);
  lines.push('', 'DATA TABLES:');
  for (const t of p.tables) lines.push(`- id=${t.id} name="${t.name}" kind=${t.kind} rows=${rowCount(t)} format=${t.yFormat}${t.kind === 'xy' || t.kind === 'grouped' ? ` replicates=${t.replicates}` : ''} data_sets=[${t.datasets.map((d) => `"${d.title}"`).join(', ')}]${TABLE_KIND_INFO[t.kind].hasX ? ` x_title="${t.xTitle}"` : ''}`);
  if (!p.tables.length) lines.push('(none)');
  lines.push('', 'ANALYSES (results sheets):');
  for (const a of p.analyses) lines.push(`- id=${a.id} name="${a.name}" kind=${a.kind} table=${a.tableId}${runAnalysisSafe(a.id)}`);
  if (!p.analyses.length) lines.push('(none)');
  lines.push('', 'GRAPHS:');
  for (const g of p.graphs) lines.push(`- id=${g.id} name="${g.name}" chart=${g.chart} table=${g.tableId}${g.analysisId ? ` analysis=${g.analysisId}` : ''}`);
  if (!p.graphs.length) lines.push('(none)');
  lines.push('', 'SCRIPTS:');
  for (const s of p.scripts) lines.push(`- id=${s.id} name="${s.name}" (${s.code.split('\n').length} lines)`);
  lines.push('', 'FIGURES (from code):');
  for (const f of p.figures) lines.push(`- id=${f.id} "${f.name}" (figure ${f.number})`);
  lines.push('', `WORKSPACE VARIABLES: ${st.workspace.map((v) => `${v.name} ${v.size} ${v.cls}`).join('; ') || '(none)'}`);
  return lines.join('\n');
}

function runAnalysisSafe(id: string): string {
  try {
    const p = S().project;
    const a = p.analyses.find((x) => x.id === id)!;
    const t = tableFor(p, a.tableId);
    if (!t) return '';
    const r = runAnalysis(t, a);
    return r.derivedTable ? ` (has results table "derived:${a.id}" that can be graphed)` : '';
  } catch {
    return '';
  }
}

function analysisCatalog(kind?: string): string {
  const defs = kind ? ANALYSES.filter((a) => a.tableKinds.includes(kind as TableKind)) : ANALYSES;
  return defs
    .map((d) => {
      const params = d.params.map((p) => `${p.key} (${p.type}${p.options ? `: ${p.options.map((o) => o.value).join('|')}` : ''}, default ${JSON.stringify(p.default)})${p.type === 'model' ? ` models: ${NL_MODELS.map((m) => m.id).join('|')}|custom` : ''}`).join('; ');
      return `- kind="${d.kind}" — ${d.name}. Tables: ${d.tableKinds.join(', ')}. ${d.description}${params ? ` Params: ${params}` : ''}`;
    })
    .join('\n');
}

async function graphImage(id: string) {
  const p = S().project;
  const f = findItem(p, id);
  if (!f || (f.type !== 'graph' && f.type !== 'figure')) throw new Error('Not a graph or figure');
  const spec = f.type === 'graph' ? compileGraph(f.item as Graph, graphCtx(p)) : (f.item as any).spec;
  const svg = renderFigure(spec);
  const b64 = await svgToPngBase64(svg, spec.width, spec.height, 110);
  return { b64, spec };
}

const graphOptionsSchema = {
  title: z.string().optional().describe('Graph title ("" for none)'),
  x_title: z.string().optional(),
  y_title: z.string().optional(),
  chart: z.string().optional().describe('Chart type; must be valid for the table kind (see create_graph)'),
  error_bar: z.enum(['sd', 'sem', 'ci95', 'range', 'iqr', 'none']).optional(),
  center: z.enum(['mean', 'median']).optional(),
  show_points: z.boolean().optional(),
  connect_lines: z.boolean().optional(),
  x_log: z.boolean().optional(),
  y_log: z.boolean().optional(),
  x_min: z.number().optional(),
  x_max: z.number().optional(),
  y_min: z.number().optional(),
  y_max: z.number().optional(),
  palette: z.string().optional().describe(`Color scheme: ${Object.keys(PALETTES).join(', ')}`),
  theme: z.enum(['prism', 'matlab', 'minimal', 'dark']).optional().describe('prism = publication style'),
  legend: z.enum(['auto', 'right', 'top', 'inside', 'none']).optional(),
  width: z.number().optional().describe('Points (72 per inch)'),
  height: z.number().optional(),
  font_size: z.number().optional(),
  bar_fill: z.enum(['solid', 'light', 'hollow']).optional(),
  colors: z.record(z.string(), z.string()).optional().describe('Map of data set title to hex color'),
  data_sets: z.array(z.string()).optional().describe('Titles of data sets to show (default all)'),
  significance_from_analysis: z.string().optional().describe('Analysis id/name whose multiple comparisons should be drawn as asterisk brackets'),
  show_ns: z.boolean().optional().describe('Also draw non-significant (ns) brackets'),
  clear_annotations: z.boolean().optional(),
};

function applyGraphOptions(g: Graph, o: any, t: DataTable) {
  const go = g.options;
  if (o.chart) {
    if (!chartsFor(t.kind).includes(o.chart as ChartType)) throw new Error(`Chart "${o.chart}" is not available for ${t.kind} tables. Options: ${chartsFor(t.kind).join(', ')}`);
    g.chart = o.chart;
  }
  if (o.title !== undefined) go.title = o.title;
  if (o.x_title !== undefined) go.xAxis.title = o.x_title;
  if (o.y_title !== undefined) go.yAxis.title = o.y_title;
  if (o.error_bar) go.errorBar = o.error_bar;
  if (o.center) go.center = o.center;
  if (o.show_points !== undefined) go.showPoints = o.show_points;
  if (o.connect_lines !== undefined) go.connectLines = o.connect_lines;
  if (o.x_log !== undefined) go.xAxis.scale = o.x_log ? 'log10' : 'linear';
  if (o.y_log !== undefined) go.yAxis.scale = o.y_log ? 'log10' : 'linear';
  if (o.x_min !== undefined || o.x_max !== undefined) {
    go.xAxis.auto = false;
    if (o.x_min !== undefined) go.xAxis.min = o.x_min;
    if (o.x_max !== undefined) go.xAxis.max = o.x_max;
  }
  if (o.y_min !== undefined || o.y_max !== undefined) {
    go.yAxis.auto = false;
    if (o.y_min !== undefined) go.yAxis.min = o.y_min;
    if (o.y_max !== undefined) go.yAxis.max = o.y_max;
  }
  if (o.palette) {
    if (!PALETTES[o.palette]) throw new Error(`Unknown palette. Use one of ${Object.keys(PALETTES).join(', ')}`);
    go.palette = o.palette;
  }
  if (o.theme) go.theme = o.theme;
  if (o.legend) go.legend = o.legend;
  if (o.width) go.width = Math.max(150, Math.min(2000, o.width));
  if (o.height) go.height = Math.max(120, Math.min(2000, o.height));
  if (o.font_size) go.fontSize = Math.max(6, Math.min(30, o.font_size));
  if (o.bar_fill) go.barFill = o.bar_fill;
  if (o.colors) for (const [title, c] of Object.entries(o.colors)) {
    const ds = t.datasets.find((d) => d.title === title);
    if (ds) go.series[ds.id] = { ...go.series[ds.id], color: c as string };
  }
  if (o.data_sets) g.datasetIds = t.datasets.filter((d) => o.data_sets.includes(d.title)).map((d) => d.id);
  if (o.clear_annotations) g.annotations = [];
  if (o.significance_from_analysis) {
    const p = S().project;
    const a = p.analyses.find((x) => x.id === o.significance_from_analysis || x.name === o.significance_from_analysis);
    if (!a) throw new Error('Analysis for significance not found');
    const src = tableFor(p, a.tableId)!;
    const res = runAnalysis(src, a);
    g.annotations = [...g.annotations.filter((x) => x.kind !== 'bracket'), ...significanceAnnotations(res.comparisons ?? [], t, g, !!o.show_ns)];
  }
}

export const TOOLS: ToolDef[] = [
  {
    name: 'get_project_overview',
    description: 'List everything in the open project: data tables (ids, kinds, data sets), analyses, graphs, scripts, figures and MATLAB workspace variables, plus the sheet the user is looking at. Call this first when you need ids.',
    schema: z.object({}),
    run: async () => overview(),
  },
  {
    name: 'get_table',
    description: 'Read the contents of a data table (or an analysis results table, id "derived:<analysisId>") as tab-separated text.',
    schema: z.object({ table: z.string().describe('Table id or name'), max_rows: z.number().optional() }),
    run: async ({ table, max_rows }) => {
      const t = resolveTable(table);
      return `Table "${t.name}" (id ${t.id}, kind ${t.kind}, format ${t.yFormat}${t.kind === 'xy' || t.kind === 'grouped' ? `, ${t.replicates} replicates` : ''}). Excluded values are marked *.\n${tableSummaryText(t, max_rows ?? 200)}`;
    },
  },
  {
    name: 'create_table',
    description: 'Create a new data table (sheet) in the project. Table kinds: xy (X values + Y data sets with replicates), column (each data set is a group; values down the rows), grouped (rows = one factor, data sets = second factor, with replicates), contingency (counts; rows = groups, data sets = outcomes), survival (x_values = times; each data set has 1 = event / 0 = censored only in the rows belonging to that group, null elsewhere), parts (parts of whole; row titles + one data set), multi (multiple variables: each data set is a variable, each row an observation).',
    schema: z.object({
      name: z.string(),
      kind: z.enum(['xy', 'column', 'grouped', 'contingency', 'survival', 'parts', 'multi']),
      x_title: z.string().optional(),
      x_values: cellArr.optional().describe('X column (xy and survival tables)'),
      row_titles: z.array(z.string()).optional(),
      replicates: z.number().optional().describe('Replicates per row for xy/grouped tables (default: inferred from values)'),
      format: z.enum(['replicates', 'meanSD', 'meanSEM', 'meanSDN', 'meanSEMN']).optional().describe('xy/grouped only: enter summary data instead of replicates'),
      data_sets: z.array(dataSetSchema),
      open: z.boolean().optional().describe('Show the new table to the user (default true)'),
    }),
    run: async (i) => {
      const reps = i.replicates ?? Math.max(1, ...i.data_sets.map((d: any) => (Array.isArray(d.values[0]) ? Math.max(...d.values.map((r: any[]) => r.length)) : 1)));
      const t = newTable(i.kind, i.name, { datasets: 0, replicates: i.kind === 'xy' || i.kind === 'grouped' ? reps : 1, yFormat: (i.format ?? 'replicates') as YFormat });
      if (i.x_title) t.xTitle = i.x_title;
      if (i.x_values) t.x = i.x_values;
      if (i.row_titles) t.rowTitles = i.row_titles;
      buildDatasets(t, i.data_sets);
      S().addTableObject(t, i.open !== false);
      return `Created ${i.kind} table "${t.name}" (id ${t.id}) with ${rowCount(t)} rows and ${t.datasets.length} data sets.`;
    },
  },
  {
    name: 'update_table',
    description: 'Edit an existing data table. Provide only the parts to change: name, x_title, x_values, row_titles, data_sets (replaces ALL data sets), or set_cells for individual cells. You can also exclude/include values from analysis.',
    schema: z.object({
      table: z.string(),
      name: z.string().optional(),
      x_title: z.string().optional(),
      x_values: cellArr.optional(),
      row_titles: z.array(z.string()).optional(),
      data_sets: z.array(dataSetSchema).optional(),
      set_cells: z.array(z.object({ row: z.number().describe('0-based row'), data_set: z.string().describe('Data set title, or "X" / "row_title"'), subcolumn: z.number().optional().describe('0-based replicate index'), value: z.union([z.number(), z.string(), z.null()]) })).optional(),
      exclude: z.array(z.object({ row: z.number(), data_set: z.string(), subcolumn: z.number().optional(), excluded: z.boolean() })).optional(),
    }),
    run: async (i) => {
      const t0 = resolveTable(i.table);
      if (t0.derivedFrom) throw new Error('Analysis result tables are read-only; edit the source table instead.');
      S().update((p) => {
        const t = p.tables.find((x) => x.id === t0.id)!;
        if (i.name) t.name = i.name;
        if (i.x_title !== undefined) t.xTitle = i.x_title;
        if (i.x_values) t.x = i.x_values;
        if (i.row_titles) t.rowTitles = i.row_titles;
        if (i.data_sets) {
          t.excluded = [];
          buildDatasets(t, i.data_sets);
        }
        for (const c of i.set_cells ?? []) {
          if (c.data_set === 'X') {
            while (t.x.length <= c.row) t.x.push(null);
            t.x[c.row] = c.value === null ? null : Number(c.value);
          } else if (c.data_set === 'row_title') {
            while (t.rowTitles.length <= c.row) t.rowTitles.push('');
            t.rowTitles[c.row] = String(c.value ?? '');
          } else {
            const ds = t.datasets.find((d) => d.title === c.data_set);
            if (!ds) throw new Error(`No data set "${c.data_set}"`);
            const col = ds.cols[c.subcolumn ?? 0];
            if (!col) throw new Error('Subcolumn out of range');
            while (col.length <= c.row) col.push(null);
            col[c.row] = c.value === null || c.value === '' ? null : Number(c.value);
          }
        }
        for (const e of i.exclude ?? []) {
          const ds = t.datasets.find((d) => d.title === e.data_set);
          if (!ds) throw new Error(`No data set "${e.data_set}"`);
          const key = `${ds.id}:${e.subcolumn ?? 0}:${e.row}`;
          t.excluded = e.excluded ? [...new Set([...t.excluded, key])] : t.excluded.filter((k) => k !== key);
        }
      });
      return `Updated table "${i.name ?? t0.name}". Linked analyses and graphs update automatically.`;
    },
  },
  {
    name: 'list_analysis_types',
    description: 'List available statistical analyses (kinds, which table kinds they apply to, and their parameters). Optionally filter by table kind.',
    schema: z.object({ table_kind: z.string().optional() }),
    run: async ({ table_kind }) => analysisCatalog(table_kind),
  },
  {
    name: 'run_analysis',
    description: 'Run a statistical analysis on a data table and add it to the project as a linked results sheet (it recalculates when data change). Returns the full results. Use list_analysis_types for kinds and parameters. Examples: kind="ttest" params {test:"welch"}; kind="anova1" params {test:"ordinary", posthoc:"tukey"}; kind="nonlin" params {model:"logAgonist4"} or {model:"custom", custom:"Y = A*exp(-k*X)+C"}.',
    schema: z.object({
      table: z.string(),
      kind: z.string(),
      params: z.record(z.string(), z.any()).optional(),
      data_sets: z.array(z.string()).optional().describe('Titles of data sets to include (default all)'),
      name: z.string().optional(),
      open: z.boolean().optional(),
    }),
    run: async (i) => {
      const t = resolveTable(i.table);
      const def = ANALYSES.find((a) => a.kind === i.kind);
      if (!def) throw new Error(`Unknown analysis kind "${i.kind}". Use list_analysis_types.`);
      if (!def.tableKinds.includes(t.kind)) throw new Error(`${def.name} cannot be used on ${t.kind} tables. Valid table kinds: ${def.tableKinds.join(', ')}.`);
      const ids = i.data_sets ? t.datasets.filter((d) => i.data_sets.includes(d.title)).map((d) => d.id) : undefined;
      const id = S().addAnalysis(t.id, i.kind as AnalysisKind, i.params ?? {}, ids, i.open !== false);
      if (i.name) S().renameItem(id, i.name);
      const a = S().project.analyses.find((x) => x.id === id)!;
      const res = runAnalysis(t, a);
      return `Analysis sheet "${a.name}" (id ${a.id}) created.${res.derivedTable ? ` It produced a graphable results table (use create_graph with analysis="${a.id}").` : ''}\n\n${resultsToText(res)}`;
    },
  },
  {
    name: 'get_analysis_results',
    description: 'Get the current results of an existing analysis sheet as text.',
    schema: z.object({ analysis: z.string() }),
    run: async ({ analysis }) => {
      const f = resolveItem(analysis, ['analysis']);
      if (f.type !== 'analysis') throw new Error('Not an analysis');
      const a = f.item as any;
      const t = tableFor(S().project, a.tableId);
      if (!t) throw new Error('Source table missing');
      return `${analysisDef(a.kind).name} — params ${JSON.stringify(a.params)}\n${resultsToText(runAnalysis(t, a))}`;
    },
  },
  {
    name: 'update_analysis',
    description: 'Change the parameters (or analysis kind) of an existing analysis sheet; returns new results.',
    schema: z.object({ analysis: z.string(), kind: z.string().optional(), params: z.record(z.string(), z.any()).optional(), data_sets: z.array(z.string()).optional() }),
    run: async (i) => {
      const f = resolveItem(i.analysis, ['analysis']);
      if (f.type !== 'analysis') throw new Error('Not an analysis');
      const t = tableFor(S().project, (f.item as any).tableId)!;
      S().update((p) => {
        const a = p.analyses.find((x) => x.id === f.item.id)!;
        if (i.kind) a.kind = i.kind as AnalysisKind;
        if (i.params) a.params = { ...a.params, ...i.params };
        if (i.data_sets) a.datasetIds = t.datasets.filter((d) => i.data_sets.includes(d.title)).map((d) => d.id);
      });
      const a = S().project.analyses.find((x) => x.id === f.item.id)!;
      return resultsToText(runAnalysis(t, a));
    },
  },
  {
    name: 'create_graph',
    description: `Create a publication-quality graph of a data table (or of an analysis results table by passing analysis). Chart types by table kind: ${(['column', 'xy', 'grouped', 'contingency', 'survival', 'parts', 'multi'] as TableKind[]).map((k) => `${k}: ${chartsFor(k).join('/')}`).join('; ')}. Regression/curve-fit analyses on XY tables are overlaid automatically. After creating, call view_graph to check it.`,
    schema: z.object({ table: z.string().optional(), analysis: z.string().optional().describe('Analysis id whose results table to graph (e.g. frequency distribution, ROC, PCA scores)'), name: z.string().optional(), ...graphOptionsSchema }),
    run: async (i) => {
      const p = S().project;
      let tableId: string, analysisId: string | undefined;
      if (i.analysis) {
        const a = p.analyses.find((x) => x.id === i.analysis || x.name === i.analysis);
        if (!a) throw new Error('Analysis not found');
        analysisId = a.id;
        tableId = a.tableId;
      } else {
        if (!i.table) throw new Error('Provide table or analysis');
        tableId = resolveTable(i.table).id;
      }
      const id = S().addGraph(tableId, i.chart as ChartType | undefined, { analysisId, name: i.name });
      if (!id) throw new Error('Could not create graph');
      const t = tableFor(S().project, analysisId ? `derived:${analysisId}` : tableId)!;
      S().update((d) => applyGraphOptions(d.graphs.find((g) => g.id === id)!, { ...i, chart: undefined }, t));
      const g = S().project.graphs.find((x) => x.id === id)!;
      return `Created graph "${g.name}" (id ${g.id}, ${CHART_LABELS[g.chart]}).`;
    },
  },
  {
    name: 'update_graph',
    description: 'Change a graph: chart type, titles, axis ranges/log scales, error bars, colors, palette, style, size, legend, which data sets are shown, and significance asterisk brackets from an analysis.',
    schema: z.object({ graph: z.string(), name: z.string().optional(), ...graphOptionsSchema }),
    run: async (i) => {
      const f = resolveItem(i.graph, ['graph']);
      if (f.type !== 'graph') throw new Error('Not a graph (MATLAB figures are changed by running code)');
      const g0 = f.item as Graph;
      const t = tableFor(S().project, g0.analysisId ? `derived:${g0.analysisId}` : g0.tableId) ?? tableFor(S().project, g0.tableId)!;
      S().update((d) => {
        const g = d.graphs.find((x) => x.id === g0.id)!;
        if (i.name) g.name = i.name;
        applyGraphOptions(g, i, t);
      });
      return `Updated graph "${i.name ?? g0.name}".`;
    },
  },
  {
    name: 'view_graph',
    description: 'Render a graph or MATLAB figure and return it as an image so you can check how it looks.',
    schema: z.object({ item: z.string().describe('Graph or figure id/name') }),
    run: async ({ item }) => {
      const f = resolveItem(item, ['graph', 'figure']);
      const { b64, spec } = await graphImage(f.item.id);
      return [
        { type: 'text', text: `Rendering of "${(f.item as any).name}" (${spec.width}×${spec.height} pt, style ${spec.style}).` },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } },
      ];
    },
  },
  {
    name: 'run_matlab',
    description: 'Run MATLAB-language code in the Quanta Studio engine (a large MATLAB-compatible subset: matrices, linear algebra, statistics, ode45, fzero, fminsearch, fft, cell arrays, structs, local functions, plotting with plot/scatter/bar/histogram/errorbar/surf/contour/subplot etc.). Variables persist in the shared workspace. Use gettable(name) / puttable(name, X, Y, ...) to move data between code and data tables, analyze(table, kind, ...) for statistics. File access is disabled. Returns console output and any figures created.',
    schema: z.object({ code: z.string() }),
    run: async ({ code }) => {
      if (!S().settings.allowClaudeCode) throw new Error('The user has disabled code execution by the assistant in Settings.');
      S().log('input', `% (Claude)\n${code}`);
      const before = new Set(S().project.figures.map((f) => `${f.id}`));
      const res = await runCode(code, { sandbox: true, timeoutMs: 30000 });
      const figs = S().project.figures;
      const newFigs = figs.filter((f) => !before.has(f.id));
      const out = res.output.length > 12000 ? res.output.slice(0, 12000) + '\n…(output truncated)' : res.output;
      return `${res.ok ? 'OK' : 'ERROR'}\n${out || '(no output)'}${res.figures ? `\nFigures: ${figs.map((f) => `${f.name} (id ${f.id})${newFigs.includes(f) ? ' [new]' : ''}`).join(', ')}` : ''}\nWorkspace: ${res.workspace.map((v) => `${v.name} ${v.size} ${v.cls}`).join('; ')}`;
    },
  },
  {
    name: 'write_script',
    description: 'Create or overwrite a MATLAB script (.m) in the project so the user can read, edit and run it. Does not run it. Function files (starting with "function") become callable from other code.',
    schema: z.object({ name: z.string().describe('File name, e.g. analysis.m'), code: z.string(), open: z.boolean().optional() }),
    run: async ({ name, code, open }) => {
      const p = S().project;
      const existing = p.scripts.find((s) => s.name === name || s.id === name);
      if (existing) {
        S().update((d) => void (d.scripts.find((s) => s.id === existing.id)!.code = code));
        if (open !== false) S().open(existing.id);
        return `Updated script ${existing.name}.`;
      }
      const id = S().addScript(name.endsWith('.m') ? name : `${name}.m`, code, open !== false);
      return `Created script ${name} (id ${id}).`;
    },
  },
  {
    name: 'read_script',
    description: 'Read the code of a script in the project.',
    schema: z.object({ script: z.string() }),
    run: async ({ script }) => {
      const f = resolveItem(script, ['script']);
      if (f.type !== 'script') throw new Error('Not a script');
      return (f.item as any).code;
    },
  },
  {
    name: 'open_sheet',
    description: 'Show a sheet (table, results, graph, script, figure, notes) to the user in the main window.',
    schema: z.object({ item: z.string() }),
    run: async ({ item }) => {
      const f = resolveItem(item);
      S().open(f.item.id);
      return `Opened ${f.type} "${(f.item as any).name}".`;
    },
  },
  {
    name: 'rename_or_delete_sheet',
    description: 'Rename a sheet, or delete it (deleting a table also deletes its analyses and graphs; the user can undo).',
    schema: z.object({ item: z.string(), new_name: z.string().optional(), delete: z.boolean().optional() }),
    run: async (i) => {
      const f = resolveItem(i.item);
      if (i.delete) {
        S().deleteItem(f.item.id);
        return `Deleted ${f.type} "${(f.item as any).name}".`;
      }
      if (i.new_name) {
        S().renameItem(f.item.id, i.new_name);
        return `Renamed to "${i.new_name}".`;
      }
      return 'Nothing to do.';
    },
  },
  {
    name: 'write_notes',
    description: 'Create a notes sheet (e.g. a methods or results paragraph) in the project.',
    schema: z.object({ name: z.string(), text: z.string() }),
    run: async ({ name, text }) => {
      const id = S().addInfo(name, text);
      return `Created notes sheet "${name}" (id ${id}).`;
    },
  },
];

export function toolJsonSchemas(eager = true) {
  return TOOLS.map((t) => {
    const js: any = z.toJSONSchema(t.schema, { target: 'draft-7' } as any);
    delete js.$schema;
    if (js.type !== 'object') js.type = 'object';
    return { name: t.name, description: t.description, input_schema: js, ...(eager ? { eager_input_streaming: true } : {}) };
  });
}

export async function executeTool(name: string, input: unknown): Promise<{ content: ToolContent; isError: boolean }> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { content: `Unknown tool ${name}`, isError: true };
  const parsed = tool.schema.safeParse(input ?? {});
  if (!parsed.success) return { content: JSON.stringify({ INVALID_INPUT: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }), isError: true };
  try {
    return { content: await tool.run(parsed.data), isError: false };
  } catch (e: any) {
    return { content: `Error: ${e?.message ?? e}`, isError: true };
  }
}
