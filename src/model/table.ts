import type { Cell, DataSet, DataTable, Graph, GraphOptions, Project, TableKind, YFormat, ChartType, AxisOptions } from './types';
import type { Summary } from '../stats/tests';
import { clean, mean, sd } from '../stats/descriptive';

let counter = 0;
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${counter.toString(36)}`;
}

export const TABLE_KIND_INFO: Record<TableKind, { label: string; description: string; hasX: boolean; hasRowTitles: boolean; allowFormats: boolean }> = {
  xy: { label: 'XY', description: 'Each point is defined by an X and Y value (dose-response, time course, standard curves, regression).', hasX: true, hasRowTitles: true, allowFormats: true },
  column: { label: 'Column', description: 'Each column is a group. Compare groups with t tests, ANOVA, or nonparametric tests.', hasX: false, hasRowTitles: true, allowFormats: false },
  grouped: { label: 'Grouped', description: 'Two grouping variables (rows × data sets) with replicates. Two-way ANOVA, grouped bar charts.', hasX: false, hasRowTitles: true, allowFormats: true },
  contingency: { label: 'Contingency', description: 'Counts of subjects in each category. Chi-square and Fisher\'s exact tests.', hasX: false, hasRowTitles: true, allowFormats: false },
  survival: { label: 'Survival', description: 'Time to event for each subject (1 = event, 0 = censored). Kaplan-Meier curves and log-rank tests.', hasX: true, hasRowTitles: true, allowFormats: false },
  parts: { label: 'Parts of whole', description: 'Values that are fractions of a whole. Pie and donut charts, fraction of total.', hasX: false, hasRowTitles: true, allowFormats: false },
  multi: { label: 'Multiple variables', description: 'Each row is an observation, each column a variable. Correlation matrices, multiple regression, PCA.', hasX: false, hasRowTitles: true, allowFormats: false },
};

export function subcolCount(t: Pick<DataTable, 'kind' | 'yFormat' | 'replicates'>): number {
  if (t.kind !== 'xy' && t.kind !== 'grouped') return 1;
  switch (t.yFormat) {
    case 'replicates': return Math.max(1, t.replicates);
    case 'meanSD':
    case 'meanSEM': return 2;
    case 'meanSDN':
    case 'meanSEMN': return 3;
  }
}

export function subcolLabels(t: DataTable): string[] {
  const n = subcolCount(t);
  if (t.kind !== 'xy' && t.kind !== 'grouped') return [''];
  switch (t.yFormat) {
    case 'replicates': return n === 1 ? ['Y'] : Array.from({ length: n }, (_, i) => `Y${i + 1}`);
    case 'meanSD': return ['Mean', 'SD'];
    case 'meanSEM': return ['Mean', 'SEM'];
    case 'meanSDN': return ['Mean', 'SD', 'N'];
    case 'meanSEMN': return ['Mean', 'SEM', 'N'];
  }
}

export function rowCount(t: DataTable): number {
  let n = t.x.length;
  n = Math.max(n, t.rowTitles.length);
  for (const ds of t.datasets) for (const c of ds.cols) n = Math.max(n, c.length);
  return n;
}

export function datasetLetter(i: number): string {
  let s = '';
  i += 1;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

export function isExcluded(t: DataTable, dsId: string, sub: number, row: number): boolean {
  return t.excluded.length > 0 && t.excluded.includes(`${dsId}:${sub}:${row}`);
}

export function cellValue(t: DataTable, dsIndex: number, sub: number, row: number): number | null {
  const ds = t.datasets[dsIndex];
  const v = ds?.cols[sub]?.[row];
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  if (isExcluded(t, ds.id, sub, row)) return null;
  return v;
}

export function xValue(t: DataTable, row: number): number | null {
  const v = t.x[row];
  return v === null || v === undefined || !Number.isFinite(v) ? null : v;
}

export function selectedDatasets(t: DataTable, ids?: string[]): number[] {
  const all = t.datasets.map((_, i) => i);
  if (!ids || !ids.length) return all.filter((i) => datasetHasData(t, i));
  return all.filter((i) => ids.includes(t.datasets[i].id));
}

export function datasetHasData(t: DataTable, i: number): boolean {
  return t.datasets[i].cols.some((c) => c.some((v) => v !== null && v !== undefined && Number.isFinite(v)));
}

/** All non-excluded raw values in a data set (all rows, all replicate subcolumns). */
export function datasetValues(t: DataTable, dsIndex: number): number[] {
  const out: number[] = [];
  const n = rowCount(t);
  const ds = t.datasets[dsIndex];
  if (!ds) return out;
  if ((t.kind === 'xy' || t.kind === 'grouped') && t.yFormat !== 'replicates') {
    for (let r = 0; r < n; r++) {
      const v = cellValue(t, dsIndex, 0, r);
      if (v !== null) out.push(v);
    }
    return out;
  }
  for (let s = 0; s < ds.cols.length; s++)
    for (let r = 0; r < n; r++) {
      const v = cellValue(t, dsIndex, s, r);
      if (v !== null) out.push(v);
    }
  return out;
}

/** Values for one row/cell (replicates) in a data set, or a summary when entered as mean/SD/N. */
export function cellStats(t: DataTable, dsIndex: number, row: number): { values: number[]; summary: Summary | null } {
  if (t.yFormat === 'replicates' || (t.kind !== 'xy' && t.kind !== 'grouped')) {
    const values: number[] = [];
    const ds = t.datasets[dsIndex];
    for (let s = 0; s < (ds?.cols.length ?? 0); s++) {
      const v = cellValue(t, dsIndex, s, row);
      if (v !== null) values.push(v);
    }
    return { values, summary: values.length ? { n: values.length, mean: mean(values), sd: values.length > 1 ? sd(values) : NaN } : null };
  }
  const m = cellValue(t, dsIndex, 0, row);
  const e = cellValue(t, dsIndex, 1, row);
  const nRaw = t.yFormat === 'meanSDN' || t.yFormat === 'meanSEMN' ? cellValue(t, dsIndex, 2, row) : null;
  if (m === null) return { values: [], summary: null };
  const n = nRaw ?? (t.yFormat === 'meanSD' || t.yFormat === 'meanSEM' ? NaN : NaN);
  let s = e ?? NaN;
  if ((t.yFormat === 'meanSEM' || t.yFormat === 'meanSEMN') && e !== null) s = Number.isFinite(n) ? e * Math.sqrt(n) : NaN;
  return { values: [m], summary: { n, mean: m, sd: s } };
}

/** Synthetic values reproducing a mean, SD and N exactly (used for analyses of summarized data). */
export function syntheticFromSummary(s: Summary): number[] {
  if (!Number.isFinite(s.n) || s.n < 1) return [];
  const n = Math.round(s.n);
  if (n === 1 || !Number.isFinite(s.sd)) return Array(n).fill(s.mean);
  const a = s.sd * Math.sqrt((n - 1) / 2);
  const out = Array(n).fill(s.mean);
  out[0] = s.mean - a;
  out[1] = s.mean + a;
  return out;
}

export function isSummaryFormat(t: DataTable): boolean {
  return (t.kind === 'xy' || t.kind === 'grouped') && t.yFormat !== 'replicates';
}

/** XY points for a data set: one entry per row with X and Y replicate values. */
export function xyPoints(t: DataTable, dsIndex: number) {
  const n = rowCount(t);
  const pts: { row: number; x: number; values: number[]; summary: Summary | null }[] = [];
  for (let r = 0; r < n; r++) {
    const x = t.kind === 'xy' || t.kind === 'survival' ? xValue(t, r) : r + 1;
    if (x === null) continue;
    const cs = cellStats(t, dsIndex, r);
    if (!cs.summary) continue;
    pts.push({ row: r, x, values: cs.values, summary: cs.summary });
  }
  return pts;
}

/** Flattened (x, y) pairs using every replicate as an individual point. */
export function xyPairs(t: DataTable, dsIndex: number, useMeans = false): { x: number[]; y: number[] } {
  const x: number[] = [], y: number[] = [];
  for (const p of xyPoints(t, dsIndex)) {
    if (useMeans || isSummaryFormat(t)) {
      x.push(p.x);
      y.push(p.summary!.mean);
    } else
      for (const v of p.values) {
        x.push(p.x);
        y.push(v);
      }
  }
  return { x, y };
}

export function emptyDataset(t: Pick<DataTable, 'kind' | 'yFormat' | 'replicates'>, title: string): DataSet {
  return { id: uid('ds'), title, cols: Array.from({ length: subcolCount(t) }, () => []) };
}

export function newTable(kind: TableKind, name: string, opts: { replicates?: number; yFormat?: YFormat; datasets?: number } = {}): DataTable {
  const t: DataTable = {
    id: uid('tbl'),
    type: 'table',
    name,
    kind,
    xTitle: kind === 'survival' ? 'Days' : 'X',
    x: [],
    rowTitles: [],
    yFormat: opts.yFormat ?? 'replicates',
    replicates: opts.replicates ?? (kind === 'xy' || kind === 'grouped' ? 3 : 1),
    datasets: [],
    excluded: [],
    notes: '',
  };
  const nds = opts.datasets ?? 3;
  for (let i = 0; i < nds; i++) t.datasets.push(emptyDataset(t, defaultDatasetTitle(kind, i)));
  return t;
}

export function defaultDatasetTitle(kind: TableKind, i: number): string {
  switch (kind) {
    case 'survival': return ['Control', 'Treated', 'Group C', 'Group D'][i] ?? `Group ${datasetLetter(i)}`;
    case 'contingency': return ['Outcome 1', 'Outcome 2', 'Outcome 3'][i] ?? `Outcome ${i + 1}`;
    case 'multi': return `Variable ${datasetLetter(i)}`;
    case 'parts': return i === 0 ? 'Values' : `Data set ${datasetLetter(i)}`;
    default: return `Group ${datasetLetter(i)}`;
  }
}

/** Resize replicates / format, preserving existing data. */
export function reformatTable(t: DataTable, yFormat: YFormat, replicates: number): DataTable {
  const next: DataTable = { ...t, yFormat, replicates };
  const n = subcolCount(next);
  next.datasets = t.datasets.map((ds) => ({ ...ds, cols: Array.from({ length: n }, (_, i) => ds.cols[i] ?? []) }));
  return next;
}

export function tableSummaryText(t: DataTable, maxRows = 200): string {
  const n = Math.min(rowCount(t), maxRows);
  const labels = subcolLabels(t);
  const header: string[] = [];
  const info = TABLE_KIND_INFO[t.kind];
  header.push('Row title');
  if (info.hasX) header.push(t.xTitle || 'X');
  t.datasets.forEach((ds, i) => {
    const subs = ds.cols.length;
    for (let s = 0; s < subs; s++) header.push(`${datasetLetter(i)}:${ds.title}${subs > 1 ? ` [${labels[s]}]` : ''}`);
  });
  const lines = [header.join('\t')];
  for (let r = 0; r < n; r++) {
    const row: string[] = [t.rowTitles[r] ?? ''];
    if (info.hasX) row.push(fmtCell(t.x[r]));
    t.datasets.forEach((ds) => ds.cols.forEach((c, s) => row.push(fmtCell(c[r]) + (isExcluded(t, ds.id, s, r) ? '*' : ''))));
    lines.push(row.join('\t'));
  }
  if (rowCount(t) > maxRows) lines.push(`... (${rowCount(t) - maxRows} more rows)`);
  return lines.join('\n');
}

function fmtCell(v: Cell | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '' : String(v);
}

// ---------------- Sample data ----------------
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function gauss(r: () => number) {
  const u = Math.max(1e-12, r()), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export function sampleTable(kind: TableKind, name: string, variant = 0): DataTable {
  const r = rng(42 + variant * 7);
  switch (kind) {
    case 'column': {
      const t = newTable('column', name, { datasets: 0 });
      const groups = [['Control', 50, 6], ['Treatment 1', 62, 7], ['Treatment 2', 71, 6.5], ['Treatment 3', 55, 8]] as const;
      for (const [title, mu, s] of groups) {
        const ds = emptyDataset(t, title);
        ds.cols[0] = Array.from({ length: 8 }, () => round(mu + s * gauss(r), 1));
        t.datasets.push(ds);
      }
      return t;
    }
    case 'xy': {
      const t = newTable('xy', name, { datasets: 0, replicates: 3 });
      t.xTitle = 'log[Agonist], M';
      t.x = [-9, -8.5, -8, -7.5, -7, -6.5, -6, -5.5, -5];
      const curves = [['No inhibitor', -7.2, 1.0, 100], ['Inhibitor', -6.4, 1.1, 95]] as const;
      for (const [title, ec, h, top] of curves) {
        const ds = emptyDataset(t, title);
        ds.cols = [0, 1, 2].map(() => t.x.map((x) => round(2 + (top - 2) / (1 + Math.pow(10, (ec - (x as number)) * h)) + 4 * gauss(r), 1)));
        t.datasets.push(ds);
      }
      return t;
    }
    case 'grouped': {
      const t = newTable('grouped', name, { datasets: 0, replicates: 3 });
      t.rowTitles = ['Day 1', 'Day 3', 'Day 7'];
      const groups = [['Wild type', [10, 14, 18]], ['Knockout', [11, 20, 31]], ['Rescue', [10, 15, 21]]] as const;
      for (const [title, mus] of groups) {
        const ds = emptyDataset(t, title);
        ds.cols = [0, 1, 2].map(() => mus.map((m) => round(m + 2 * gauss(r), 1)));
        t.datasets.push(ds);
      }
      return t;
    }
    case 'contingency': {
      const t = newTable('contingency', name, { datasets: 0 });
      t.rowTitles = ['Vaccinated', 'Placebo'];
      const a = emptyDataset(t, 'Infected');
      a.cols[0] = [12, 41];
      const b = emptyDataset(t, 'Not infected');
      b.cols[0] = [188, 159];
      t.datasets.push(a, b);
      return t;
    }
    case 'survival': {
      const t = newTable('survival', name, { datasets: 0 });
      t.xTitle = 'Days';
      const groups = [['Control', 30], ['Treated', 60]] as const;
      const dss = groups.map(([title]) => emptyDataset(t, title));
      groups.forEach(([, scale], gi) => {
        for (let k = 0; k < 14; k++) {
          const time = Math.max(1, Math.round(-scale * Math.log(Math.max(1e-6, r()))));
          const censored = r() < 0.25 || time > 120;
          t.x.push(Math.min(time, 120));
          dss.forEach((ds, j) => (ds.cols[0][t.x.length - 1] = j === gi ? (censored ? 0 : 1) : null));
        }
      });
      t.datasets.push(...dss);
      return t;
    }
    case 'parts': {
      const t = newTable('parts', name, { datasets: 0 });
      t.rowTitles = ['Protein', 'Carbohydrate', 'Fat', 'Fiber', 'Other'];
      const ds = emptyDataset(t, 'Composition (g)');
      ds.cols[0] = [32, 41, 18, 6, 3];
      t.datasets.push(ds);
      return t;
    }
    case 'multi': {
      const t = newTable('multi', name, { datasets: 0 });
      const names = ['Age', 'BMI', 'Systolic BP', 'Cholesterol'];
      const cols: number[][] = names.map(() => []);
      for (let i = 0; i < 30; i++) {
        const age = 30 + 40 * r();
        const bmi = 20 + 0.1 * age + 4 * gauss(r);
        const bp = 90 + 0.6 * age + 1.1 * bmi + 8 * gauss(r);
        const chol = 150 + 0.8 * age + 2 * bmi + 20 * gauss(r);
        [age, bmi, bp, chol].forEach((v, j) => cols[j].push(round(v, 1)));
      }
      names.forEach((n, j) => {
        const ds = emptyDataset(t, n);
        ds.cols[0] = cols[j];
        t.datasets.push(ds);
      });
      return t;
    }
  }
}

// ---------------- Graph defaults ----------------
export function defaultAxis(title = ''): AxisOptions {
  return { title, auto: true, scale: 'linear', format: 'auto', gridlines: false };
}

export function defaultGraphOptions(): GraphOptions {
  return {
    title: '',
    width: 420,
    height: 320,
    palette: 'prism',
    errorBar: 'sd',
    errorDirection: 'both',
    center: 'mean',
    showPoints: true,
    connectLines: true,
    pointSize: 6,
    barWidth: 0.65,
    lineWidth: 1.5,
    fontFamily: 'Arial, Helvetica, sans-serif',
    fontSize: 12,
    legend: 'auto',
    xAxis: defaultAxis(),
    yAxis: defaultAxis(),
    series: {},
    whiskers: 'minmax',
    survivalPercent: true,
    showCensored: true,
    showCI: false,
    theme: 'prism',
    frame: 'open',
    barFill: 'solid',
    rotateXLabels: false,
    showFitCurves: true,
  };
}

export function defaultChartFor(kind: TableKind): ChartType {
  switch (kind) {
    case 'xy': return 'xy';
    case 'column': return 'scatter';
    case 'grouped': return 'groupedBar';
    case 'contingency': return 'groupedBar';
    case 'survival': return 'survival';
    case 'parts': return 'pie';
    case 'multi': return 'xy';
  }
}

export function chartsFor(kind: TableKind): ChartType[] {
  switch (kind) {
    case 'xy': return ['xy', 'histogram', 'groupedBar'];
    case 'column': return ['scatter', 'bar', 'box', 'violin', 'meanError', 'beforeAfter'];
    case 'grouped': return ['groupedBar', 'stackedBar', 'groupedScatter'];
    case 'contingency': return ['groupedBar', 'stackedBar'];
    case 'survival': return ['survival'];
    case 'parts': return ['pie', 'donut', 'stackedBar'];
    case 'multi': return ['xy', 'heatmap', 'box', 'scatter', 'violin'];
  }
}

export const CHART_LABELS: Record<ChartType, string> = {
  scatter: 'Scatter dot plot',
  bar: 'Column bar',
  box: 'Box & whiskers',
  violin: 'Violin plot',
  meanError: 'Mean ± error',
  beforeAfter: 'Before-after',
  xy: 'XY points & lines',
  groupedBar: 'Grouped bars',
  stackedBar: 'Stacked bars',
  groupedScatter: 'Grouped scatter',
  survival: 'Survival curve',
  pie: 'Pie chart',
  donut: 'Donut chart',
  histogram: 'Histogram',
  heatmap: 'Heat map',
};

export function newGraph(table: DataTable, name: string, chart?: ChartType, analysisId?: string): Graph {
  const options = defaultGraphOptions();
  const c = chart ?? defaultChartFor(table.kind);
  options.xAxis.title = table.kind === 'xy' || table.kind === 'survival' ? table.xTitle : '';
  if (table.kind === 'survival') {
    options.yAxis.title = 'Percent survival';
    options.showPoints = false;
  } else if (table.kind === 'contingency') options.yAxis.title = 'Count';
  else options.yAxis.title = table.kind === 'parts' ? '' : 'Response';
  if (c === 'bar' || c === 'groupedBar') options.showPoints = c === 'bar';
  if (c === 'histogram') {
    options.yAxis.title = 'Frequency';
    options.barWidth = 1;
  }
  return { id: uid('gr'), type: 'graph', name, tableId: table.id, analysisId, chart: c, options, fitAnalysisIds: [], annotations: [] };
}

export function newProject(name = 'Untitled project'): Project {
  const now = new Date().toISOString();
  return { format: 'quanta-project', version: 1, name, tables: [], analyses: [], graphs: [], scripts: [], figures: [], infos: [], created: now, modified: now };
}

export function valuesSummary(values: number[]): Summary {
  const v = clean(values);
  return { n: v.length, mean: mean(v), sd: sd(v) };
}
