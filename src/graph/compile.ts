import type { Analysis, Annotation, DataTable, Graph, GraphOptions, MarkerShape, Project } from '../model/types';
import { cellStats, datasetValues, rowCount, selectedDatasets, xValue, isSummaryFormat, xyPoints, cellValue } from '../model/table';
import { describe as describeValues, kde, mean, sd, sortNum, percentile } from '../stats/descriptive';
import { tInv } from '../stats/distributions';
import { kaplanMeier } from '../stats/misc';
import { runAnalysis, survivalGroups } from '../analysis/registry';
import { emptyAxes, emptyFigure, paletteColor, type AxesSpec, type FigureSpec, type Marker, type SeriesSpec } from './spec';

const MARKERS: Marker[] = ['circle', 'square', 'triangle', 'diamond', 'triangleDown', 'cross', 'plus', 'star'];

export interface ResolveCtx {
  project: Project;
  tableFor(id: string): DataTable | undefined;
}

function seriesStyle(g: Graph, dsId: string, i: number) {
  const o = g.options;
  const s = o.series[dsId] ?? {};
  const color = s.color ?? paletteColor(o.palette, i);
  return {
    color,
    fill: s.fill ?? (o.barFill === 'hollow' ? 'none' : o.barFill === 'light' ? lighten(color, 0.6) : color),
    marker: (s.marker as Marker) ?? (o.palette === 'grayscale' || o.palette === 'prism' ? MARKERS[i % MARKERS.length] : 'circle'),
    markerSize: s.markerSize ?? o.pointSize,
    lineWidth: s.lineWidth ?? o.lineWidth,
    dash: s.dash ?? 'solid',
    hidden: !!s.hidden,
  };
}

export function lighten(hex: string, amt: number): string {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => Math.round(x + (255 - x) * amt));
  return '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('');
}

function errorFor(values: number[], kind: GraphOptions['errorBar'], center: number): [number, number] {
  const n = values.length;
  if (!n || kind === 'none') return [center, center];
  const s = sd(values);
  switch (kind) {
    case 'sd': return [center - s, center + s];
    case 'sem': return [center - s / Math.sqrt(n), center + s / Math.sqrt(n)];
    case 'ci95': {
      const h = n > 1 ? (tInv(0.975, n - 1) * s) / Math.sqrt(n) : 0;
      return [center - h, center + h];
    }
    case 'range': return [Math.min(...values), Math.max(...values)];
    case 'iqr': {
      const ss = sortNum(values);
      return [percentile(ss, 0.25), percentile(ss, 0.75)];
    }
  }
}

function errorFromSummary(sm: { n: number; mean: number; sd: number }, kind: GraphOptions['errorBar']): [number, number] {
  if (!Number.isFinite(sm.sd) || kind === 'none') return [sm.mean, sm.mean];
  const se = sm.sd / Math.sqrt(sm.n);
  if (kind === 'sem') return [sm.mean - se, sm.mean + se];
  if (kind === 'ci95') {
    const h = sm.n > 1 ? tInv(0.975, sm.n - 1) * se : 0;
    return [sm.mean - h, sm.mean + h];
  }
  return [sm.mean - sm.sd, sm.mean + sm.sd];
}

function dirErr(lo: number, hi: number, c: number, dir: GraphOptions['errorDirection']): [number, number] {
  if (dir === 'above') return [c, hi];
  if (dir === 'below') return [lo, c];
  return [lo, hi];
}

/** Spread points horizontally so they don't overlap (simple beeswarm). */
export function beeswarm(values: number[], width: number, yRange: number, pointFrac = 0.035): number[] {
  const idx = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const offs = new Array(values.length).fill(0);
  const placed: { y: number; x: number }[] = [];
  const dy = yRange * pointFrac;
  const dx = width * 0.11;
  for (const i of idx) {
    const y = values[i];
    let k = 0;
    const cand = [0];
    for (let s = 1; s < 40; s++) cand.push(s * dx, -s * dx);
    for (const c of cand) {
      if (Math.abs(c) > width / 2) continue;
      if (placed.every((p) => Math.abs(p.y - y) >= dy || Math.abs(p.x - c) >= dx * 0.95)) {
        offs[i] = c;
        k = 1;
        break;
      }
    }
    if (!k) offs[i] = (Math.random() - 0.5) * width;
    placed.push({ y, x: offs[i] });
  }
  return offs;
}

function prismAxes(g: Graph): AxesSpec {
  const ax = emptyAxes(g.id);
  const o = g.options;
  ax.title = o.title || undefined;
  ax.x = { label: o.xAxis.title || undefined, scale: o.xAxis.scale === 'linear' ? 'linear' : 'log', min: o.xAxis.auto ? undefined : o.xAxis.min, max: o.xAxis.auto ? undefined : o.xAxis.max, grid: o.xAxis.gridlines, format: o.xAxis.format, rotateLabels: o.rotateXLabels };
  ax.y = { label: o.yAxis.title || undefined, scale: o.yAxis.scale === 'linear' ? 'linear' : 'log', min: o.yAxis.auto ? undefined : o.yAxis.min, max: o.yAxis.auto ? undefined : o.yAxis.max, grid: o.yAxis.gridlines, format: o.yAxis.format };
  if (!o.xAxis.auto && o.xAxis.tickInterval && o.xAxis.min !== undefined && o.xAxis.max !== undefined) ax.x.ticks = ticksFrom(o.xAxis.min, o.xAxis.max, o.xAxis.tickInterval);
  if (!o.yAxis.auto && o.yAxis.tickInterval && o.yAxis.min !== undefined && o.yAxis.max !== undefined) ax.y.ticks = ticksFrom(o.yAxis.min, o.yAxis.max, o.yAxis.tickInterval);
  ax.box = o.frame === 'box';
  ax.legend = { show: false, location: o.legend === 'inside' ? 'northeast' : o.legend === 'top' ? 'top' : 'right' };
  return ax;
}

function ticksFrom(lo: number, hi: number, step: number) {
  const out: number[] = [];
  if (step <= 0) return out;
  for (let v = lo; v <= hi + step * 1e-9 && out.length < 200; v += step) out.push(Math.round(v / step) * step);
  return out;
}

export function compileGraph(g: Graph, ctx: ResolveCtx): FigureSpec {
  const fig = emptyFigure(g.options.theme === 'matlab' ? 'matlab' : g.options.theme === 'dark' ? 'dark' : g.options.theme === 'minimal' ? 'minimal' : 'prism');
  fig.width = g.options.width;
  fig.height = g.options.height;
  fig.fontFamily = g.options.fontFamily;
  fig.fontSize = g.options.fontSize;
  fig.rows = 1;
  fig.cols = 1;
  const t = ctx.tableFor(g.analysisId ? `derived:${g.analysisId}` : g.tableId) ?? ctx.tableFor(g.tableId);
  const ax = prismAxes(g);
  fig.axes = [ax];
  if (!t) {
    ax.title = 'Data table not found';
    return fig;
  }
  const idx = selectedDatasets(t, g.datasetIds).filter((i) => !(g.options.series[t.datasets[i].id]?.hidden));
  const o = g.options;
  const add = (s: SeriesSpec) => ax.series.push(s);
  switch (g.chart) {
    case 'scatter':
    case 'bar':
    case 'box':
    case 'violin':
    case 'meanError':
    case 'beforeAfter': {
      const names = idx.map((i) => t.datasets[i].title);
      ax.x.categories = names;
      const all = idx.flatMap((i) => valuesFor(t, i));
      const yRange = all.length ? Math.max(...all) - Math.min(...all) || 1 : 1;
      if (g.chart === 'beforeAfter') {
        const n = rowCount(t);
        for (let r = 0; r < n; r++) {
          const ys = idx.map((i) => cellValue(t, i, 0, r));
          if (ys.filter((v) => v !== null).length < 2) continue;
          add({ type: 'line', x: idx.map((_, k) => k + 1), y: ys.map((v) => (v === null ? NaN : v)), color: o.palette === 'prism' ? '#555555' : paletteColor(o.palette, r), width: o.lineWidth * 0.8, dash: 'solid', marker: 'circle', markerSize: o.pointSize, markerFill: 'auto' });
        }
        break;
      }
      idx.forEach((i, k) => {
        const st = seriesStyle(g, t.datasets[i].id, k);
        const vals = valuesFor(t, i);
        const x = k + 1;
        if (!vals.length) return;
        const d = describeValues(vals);
        const center = o.center === 'median' ? d.median : d.mean;
        const [lo0, hi0] = isSummaryFormat(t) ? errorFromSummary(summaryOf(t, i), o.errorBar) : errorFor(vals, o.errorBar, center);
        const [lo, hi] = dirErr(lo0, hi0, center, g.chart === 'bar' ? o.errorDirection : 'both');
        const w = o.barWidth;
        if (g.chart === 'bar') {
          add({ type: 'bar', x: [x], y: [center], width: w, color: st.color, fill: st.fill, edge: o.barFill === 'solid' && o.palette !== 'prism' ? darken(st.color) : st.color, edgeWidth: o.lineWidth, label: t.datasets[i].title });
        }
        if (g.chart === 'box') {
          const ss = sortNum(vals);
          let wl: number, wh: number;
          const q1 = percentile(ss, 0.25), q3 = percentile(ss, 0.75), iqr = q3 - q1;
          let outl: number[] = [];
          if (o.whiskers === 'tukey') {
            const inl = ss.filter((v) => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
            wl = inl[0];
            wh = inl[inl.length - 1];
            outl = ss.filter((v) => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr);
          } else if (o.whiskers === '5-95' || o.whiskers === '10-90') {
            const p = o.whiskers === '5-95' ? 0.05 : 0.1;
            wl = percentile(ss, p);
            wh = percentile(ss, 1 - p);
            outl = ss.filter((v) => v < wl || v > wh);
          } else {
            wl = ss[0];
            wh = ss[ss.length - 1];
          }
          add({ type: 'box', x, width: w, q1, med: percentile(ss, 0.5), q3, lo: wl, hi: wh, outliers: o.showPoints ? [] : outl, color: st.color, fill: o.barFill === 'solid' ? lighten(st.color, 0.75) : o.barFill === 'light' ? lighten(st.color, 0.85) : 'none', lineWidth: o.lineWidth, label: t.datasets[i].title });
        }
        if (g.chart === 'violin') {
          const ss = sortNum(vals);
          add({ type: 'violin', x, width: Math.min(0.9, w * 1.2), density: kde(vals, 80), q1: percentile(ss, 0.25), med: percentile(ss, 0.5), q3: percentile(ss, 0.75), color: st.color, fill: lighten(st.color, 0.7), lineWidth: o.lineWidth, label: t.datasets[i].title });
        }
        const showPts = o.showPoints && g.chart !== 'meanError' && !isSummaryFormat(t);
        if (showPts) {
          const offs = beeswarm(vals, g.chart === 'scatter' ? 0.6 : w * 0.8, yRange, (o.pointSize / Math.max(120, o.height)) * 1.4);
          add({ type: 'scatter', x: vals.map((_, j) => x + offs[j]), y: vals, color: g.chart === 'bar' && o.barFill === 'solid' ? '#000000' : st.color, marker: st.marker, size: o.pointSize, fill: g.chart === 'scatter' ? st.color : g.chart === 'bar' ? 'none' : st.color, label: g.chart === 'scatter' ? t.datasets[i].title : undefined, edgeWidth: 1 });
        }
        if (g.chart === 'scatter' || g.chart === 'meanError') {
          const half = 0.22;
          add({ type: 'line', x: [x - half, x + half], y: [center, center], color: g.chart === 'scatter' ? '#000000' : st.color, width: o.lineWidth * 1.3, dash: 'solid', marker: 'none', markerSize: 0 });
          if (g.chart === 'meanError') add({ type: 'scatter', x: [x], y: [center], color: st.color, marker: st.marker, size: o.pointSize * 1.3, fill: st.color, label: t.datasets[i].title });
        }
        if (o.errorBar !== 'none' && (g.chart === 'scatter' || g.chart === 'bar' || g.chart === 'meanError')) {
          add({ type: 'errorbar', x: [x], y: [center], lo: [lo], hi: [hi], color: g.chart === 'scatter' ? '#000000' : g.chart === 'bar' && o.barFill === 'solid' ? '#000000' : st.color, width: o.lineWidth, cap: g.chart === 'scatter' ? 14 : 12 });
        }
      });
      break;
    }
    case 'xy': {
      if (t.kind === 'multi' && idx.length >= 2) {
        // multiple-variable table: first selected = X, rest = Y
        const xi = idx[0];
        ax.x.label = ax.x.label || t.datasets[xi].title;
        idx.slice(1).forEach((i, k) => {
          const st = seriesStyle(g, t.datasets[i].id, k);
          const xsv: number[] = [], ysv: number[] = [];
          for (let r = 0; r < rowCount(t); r++) {
            const a = cellValue(t, xi, 0, r), b = cellValue(t, i, 0, r);
            if (a !== null && b !== null) {
              xsv.push(a);
              ysv.push(b);
            }
          }
          add({ type: 'scatter', x: xsv, y: ysv, color: st.color, marker: st.marker, size: o.pointSize, fill: st.color, label: t.datasets[i].title });
        });
        break;
      }
      const fits = fitCurvesFor(g, t, ctx);
      idx.forEach((i, k) => {
        const ds = t.datasets[i];
        const st = seriesStyle(g, ds.id, k);
        const pts = xyPoints(t, i);
        const hasReps = pts.some((p) => p.values.length > 1) || isSummaryFormat(t);
        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.summary!.mean);
        const hasFit = fits.some((f) => f.datasetId === ds.id);
        if (o.showPoints) {
          if (hasReps && o.errorBar !== 'none') {
            const errs = pts.map((p) => (isSummaryFormat(t) ? errorFromSummary(p.summary!, o.errorBar) : errorFor(p.values, o.errorBar, p.summary!.mean)));
            add({ type: 'errorbar', x: xs, y: ys, lo: errs.map((e) => e[0]), hi: errs.map((e) => e[1]), color: st.color, width: o.lineWidth, cap: 8 });
          }
          if (hasReps && o.errorBar === 'none' && !isSummaryFormat(t)) {
            // plot every replicate
            add({ type: 'scatter', x: pts.flatMap((p) => p.values.map(() => p.x)), y: pts.flatMap((p) => p.values), color: st.color, marker: st.marker, size: o.pointSize, fill: st.color, label: ds.title });
          }
        }
        add({ type: 'line', x: xs, y: ys, color: st.color, width: st.lineWidth, dash: o.connectLines && !hasFit ? (st.dash as any) : 'none', marker: o.showPoints && !(hasReps && o.errorBar === 'none') ? st.marker : 'none', markerSize: st.markerSize, markerFill: st.color, label: ds.title });
      });
      for (const f of fits) {
        const k = idx.findIndex((i) => t.datasets[i].id === f.datasetId);
        if (k < 0) continue;
        const st = seriesStyle(g, f.datasetId, k);
        if (f.lo && f.hi) add({ type: 'band', x: f.x, lo: f.lo, hi: f.hi, color: st.color, opacity: 0.15 });
        add({ type: 'line', x: f.x, y: f.y, color: st.color, width: st.lineWidth, dash: st.dash as any, marker: 'none', markerSize: 0 });
      }
      if (t.derivedFrom && ctx.project.analyses.find((a) => a.id === t.derivedFrom)?.kind === 'blandAltman') {
        const a = ctx.project.analyses.find((x) => x.id === t.derivedFrom)!;
        const src = ctx.tableFor(a.tableId);
        if (src) {
          const res = runAnalysis(src, a);
          const bias = parseFloat(res.tables[0]?.rows[0]?.[1] ?? 'NaN');
          const loa = (res.tables[0]?.rows[2]?.[1] ?? '').split(' to ').map(parseFloat);
          if (Number.isFinite(bias)) add({ type: 'hline', value: bias, color: '#000000', dash: 'solid', width: 1, label: 'Bias' });
          for (const v of loa) if (Number.isFinite(v)) add({ type: 'hline', value: v, color: '#000000', dash: 'dash', width: 1 });
        }
      }
      if (t.derivedFrom && ctx.project.analyses.find((a) => a.id === t.derivedFrom)?.kind === 'roc') {
        add({ type: 'line', x: [0, 100], y: [0, 100], color: '#999999', width: 1, dash: 'dash', marker: 'none', markerSize: 0 });
        ax.series.forEach((s) => {
          if (s.type === 'line' && s.label) {
            s.step = undefined;
            s.dash = 'solid';
          }
        });
      }
      break;
    }
    case 'histogram': {
      const cx = t.x.map((v) => (v === null ? NaN : v));
      const w = cx.length > 1 ? Math.abs((cx[1] as number) - (cx[0] as number)) : 1;
      idx.forEach((i, k) => {
        const st = seriesStyle(g, t.datasets[i].id, k);
        const ys = cx.map((_, r) => cellValue(t, i, 0, r) ?? 0);
        add({ type: 'bar', x: cx, y: ys, width: w * o.barWidth, color: st.color, fill: idx.length > 1 ? lighten(st.color, 0.3) : st.fill, edge: o.palette === 'prism' ? '#000000' : darken(st.color), edgeWidth: o.lineWidth * 0.7, label: t.datasets[i].title, opacity: idx.length > 1 ? 0.65 : undefined });
      });
      break;
    }
    case 'groupedBar':
    case 'stackedBar':
    case 'groupedScatter': {
      const n = rowCount(t);
      const rows: number[] = [];
      for (let r = 0; r < n; r++) if (idx.some((i) => cellStats(t, i, r).summary)) rows.push(r);
      if (t.kind === 'parts') {
        // stacked 100% from parts of whole
        ax.x.categories = idx.map((i) => t.datasets[i].title);
        const totals = idx.map((i) => datasetValues(t, i).reduce((a, b) => a + b, 0));
        const base = idx.map(() => 0);
        rows.forEach((r, rk) => {
          const vals = idx.map((i, k) => (100 * (cellValue(t, i, 0, r) ?? 0)) / (totals[k] || 1));
          const c = paletteColor(o.palette === 'prism' ? 'colorblind' : o.palette, rk);
          add({ type: 'bar', x: idx.map((_, k) => k + 1), y: vals.map((v, k) => base[k] + v), base: [...base], width: o.barWidth, color: c, fill: c, edge: '#000000', edgeWidth: o.lineWidth * 0.6, label: t.rowTitles[r] || `Row ${r + 1}` });
          vals.forEach((v, k) => (base[k] += v));
        });
        ax.legend.show = o.legend !== 'none';
        if (!o.yAxis.title || o.yAxis.title === 'Response') ax.y.label = 'Percent of total';
        break;
      }
      ax.x.categories = rows.map((r) => t.rowTitles[r] || (t.kind === 'xy' ? String(xValue(t, r) ?? r + 1) : `Row ${r + 1}`));
      const k = idx.length;
      const groupW = Math.min(0.85, o.barWidth + 0.15);
      const bw = g.chart === 'stackedBar' ? o.barWidth : groupW / k;
      const stackBase = rows.map(() => 0);
      idx.forEach((i, j) => {
        const st = seriesStyle(g, t.datasets[i].id, j);
        const off = g.chart === 'stackedBar' ? 0 : -groupW / 2 + bw * (j + 0.5);
        const centers: number[] = [], los: number[] = [], his: number[] = [], xsArr: number[] = [];
        const ptsX: number[] = [], ptsY: number[] = [];
        rows.forEach((r, rk) => {
          const cs = cellStats(t, i, r);
          if (!cs.summary) {
            centers.push(NaN);
            los.push(NaN);
            his.push(NaN);
            xsArr.push(rk + 1 + off);
            return;
          }
          const c = o.center === 'median' && !isSummaryFormat(t) ? describeValues(cs.values).median : cs.summary.mean;
          const [lo0, hi0] = isSummaryFormat(t) ? errorFromSummary(cs.summary, o.errorBar) : errorFor(cs.values, o.errorBar, c);
          const [lo, hi] = dirErr(lo0, hi0, c, g.chart === 'groupedScatter' ? 'both' : o.errorDirection);
          xsArr.push(rk + 1 + off);
          if (g.chart === 'stackedBar') {
            centers.push(stackBase[rk] + c);
            los.push(stackBase[rk] + c - (c - lo));
            his.push(stackBase[rk] + c + (hi - c));
          } else {
            centers.push(c);
            los.push(lo);
            his.push(hi);
          }
          if (o.showPoints && !isSummaryFormat(t) && g.chart !== 'stackedBar') {
            const offs = beeswarm(cs.values, bw * 0.8, Math.max(1e-9, Math.abs(hi - lo) * 4 || 1));
            cs.values.forEach((v, q) => {
              ptsX.push(rk + 1 + off + offs[q]);
              ptsY.push(v);
            });
          }
        });
        if (g.chart === 'groupedScatter') {
          add({ type: 'scatter', x: ptsX, y: ptsY, color: st.color, marker: st.marker, size: o.pointSize, fill: st.color, label: t.datasets[i].title });
          add({ type: 'scatter', x: xsArr, y: centers, color: '#000000', marker: 'bar', size: bw * 120, fill: 'none' });
        } else {
          add({ type: 'bar', x: xsArr, y: centers, base: g.chart === 'stackedBar' ? [...stackBase] : undefined, width: bw * (g.chart === 'stackedBar' ? 1 : 0.92), color: st.color, fill: st.fill, edge: o.barFill === 'solid' && o.palette !== 'prism' ? darken(st.color) : '#000000', edgeWidth: o.lineWidth * 0.8, label: t.datasets[i].title });
          if (o.showPoints && ptsX.length) add({ type: 'scatter', x: ptsX, y: ptsY, color: '#000000', marker: st.marker, size: o.pointSize * 0.8, fill: 'none' });
        }
        if (o.errorBar !== 'none' && t.kind !== 'contingency') add({ type: 'errorbar', x: xsArr, y: centers, lo: los, hi: his, color: '#000000', width: o.lineWidth, cap: Math.min(10, bw * 40) });
        if (g.chart === 'stackedBar') rows.forEach((r, rk) => {
          const cs = cellStats(t, i, r);
          if (cs.summary) stackBase[rk] += cs.summary.mean;
        });
      });
      ax.legend.show = o.legend !== 'none';
      break;
    }
    case 'survival': {
      const groups = survivalGroups(t, g.datasetIds);
      const pct = o.survivalPercent ? 100 : 1;
      groups.forEach((gr, k) => {
        if (o.series[t.datasets[gr.idx].id]?.hidden) return;
        const st = seriesStyle(g, t.datasets[gr.idx].id, k);
        const km = kaplanMeier(gr.times, gr.events);
        const xs = km.steps.map((s) => s.time), ys = km.steps.map((s) => s.survival * pct);
        // extend to last observation time
        const lastT = Math.max(...gr.times, xs[xs.length - 1] ?? 0);
        if (lastT > xs[xs.length - 1]) {
          xs.push(lastT);
          ys.push(ys[ys.length - 1]);
        }
        if (o.showCI) {
          const bx: number[] = [], blo: number[] = [], bhi: number[] = [];
          km.steps.forEach((s, j) => {
            const next = km.steps[j + 1]?.time ?? lastT;
            const lo = Number.isFinite(s.lo) ? s.lo * pct : s.survival * pct, hi = Number.isFinite(s.hi) ? s.hi * pct : s.survival * pct;
            bx.push(s.time, next);
            blo.push(lo, lo);
            bhi.push(hi, hi);
          });
          add({ type: 'band', x: bx, lo: blo, hi: bhi, color: st.color, opacity: 0.15 });
        }
        add({ type: 'line', x: xs, y: ys, color: st.color, width: st.lineWidth, dash: st.dash as any, marker: 'none', markerSize: 0, step: 'post', label: gr.name });
        if (o.showCensored && km.censorTimes.length) add({ type: 'scatter', x: km.censorTimes.map((c) => c.time), y: km.censorTimes.map((c) => c.survival * pct), color: st.color, marker: 'bar', size: o.pointSize * 1.3, fill: 'none' });
      });
      ax.y.min = ax.y.min ?? 0;
      ax.y.max = ax.y.max ?? (o.survivalPercent ? 100 : 1);
      if (o.yAxis.auto) ax.y.ticks = o.survivalPercent ? [0, 25, 50, 75, 100] : [0, 0.25, 0.5, 0.75, 1];
      ax.x.min = ax.x.min ?? 0;
      ax.legend.show = o.legend !== 'none';
      break;
    }
    case 'pie':
    case 'donut': {
      const i = idx[0] ?? 0;
      const n = rowCount(t);
      const values: number[] = [], labels: string[] = [];
      for (let r = 0; r < n; r++) {
        const v = cellValue(t, i, 0, r);
        if (v === null) continue;
        values.push(v);
        labels.push(t.rowTitles[r] || `Row ${r + 1}`);
      }
      ax.kind = 'pie';
      ax.series = [{ type: 'pie', values, labels, colors: values.map((_, k) => g.options.series[`row${k}`]?.color ?? paletteColor(o.palette === 'prism' ? 'colorblind' : o.palette, k)), donut: g.chart === 'donut' ? 0.55 : 0, showPercent: false }];
      ax.legend.show = o.legend !== 'none';
      break;
    }
    case 'heatmap': {
      const n = rowCount(t);
      const z: number[][] = [];
      for (let r = 0; r < n; r++) z.push(idx.map((i) => cellValue(t, i, 0, r) ?? NaN));
      const cols = idx.map((i) => t.datasets[i].title);
      const isCorr = t.derivedFrom && ctx.project.analyses.find((a) => a.id === t.derivedFrom)?.kind === 'corrMatrix';
      const vals = z.flat().filter(Number.isFinite);
      const cmap = isCorr ? 'redblue' : 'viridis';
      const cmin = isCorr ? -1 : Math.min(...vals), cmax = isCorr ? 1 : Math.max(...vals);
      ax.series = [{ type: 'heatmap', z, x0: 1, x1: cols.length, y0: 1, y1: n, colormap: cmap, cmin, cmax, showValues: z.length * cols.length <= 150 }];
      ax.x.categories = cols;
      ax.y.reverse = true;
      ax.y.ticks = Array.from({ length: n }, (_, r) => r + 1);
      ax.y.tickLabels = Array.from({ length: n }, (_, r) => t.rowTitles[r] || `${r + 1}`);
      ax.colorbar = { colormap: cmap, min: cmin, max: cmax };
      ax.box = true;
      break;
    }
  }
  if (o.legend === 'none') ax.legend.show = false;
  else if (o.legend !== 'auto') ax.legend.show = true;
  else if (g.chart === 'xy' || g.chart === 'survival' || g.chart.startsWith('grouped') || g.chart === 'stackedBar' || g.chart === 'pie' || g.chart === 'donut' || (g.chart === 'histogram' && idx.length > 1)) ax.legend.show = (t.kind === 'multi' && g.chart === 'xy' ? idx.length > 2 : idx.length > 1) || g.chart === 'pie' || g.chart === 'donut' || t.kind === 'parts';
  addAnnotations(ax, g.annotations, fig);
  return fig;
}

function darken(hex: string): string {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => Math.round(x * 0.6));
  return '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('');
}

function valuesFor(t: DataTable, i: number): number[] {
  if (isSummaryFormat(t)) {
    const out: number[] = [];
    for (let r = 0; r < rowCount(t); r++) {
      const s = cellStats(t, i, r).summary;
      if (s) out.push(s.mean);
    }
    return out;
  }
  return datasetValues(t, i);
}

function summaryOf(t: DataTable, i: number) {
  for (let r = 0; r < rowCount(t); r++) {
    const s = cellStats(t, i, r).summary;
    if (s) return s;
  }
  return { n: 0, mean: NaN, sd: NaN };
}

function fitCurvesFor(g: Graph, t: DataTable, ctx: ResolveCtx) {
  if (!g.options.showFitCurves) return [];
  const analyses: Analysis[] = ctx.project.analyses.filter((a) => (g.fitAnalysisIds.includes(a.id) || (g.fitAnalysisIds.length === 0 && a.tableId === t.id)) && (a.kind === 'nonlin' || a.kind === 'linreg'));
  const curves = [];
  for (const a of analyses) {
    const src = ctx.tableFor(a.tableId);
    if (!src) continue;
    const res = runAnalysis(src, a);
    for (const c of res.curves ?? []) if (c.x.length) curves.push(c);
  }
  return curves;
}

function addAnnotations(ax: AxesSpec, anns: Annotation[], fig: FigureSpec) {
  if (!anns.length) return;
  // Estimate the data maximum to place brackets above
  let ymax = -Infinity, ymin = Infinity;
  for (const s of ax.series) {
    if (s.type === 'scatter' || s.type === 'line') s.y.forEach((v) => Number.isFinite(v) && ((ymax = Math.max(ymax, v)), (ymin = Math.min(ymin, v))));
    if (s.type === 'bar') s.y.forEach((v) => Number.isFinite(v) && ((ymax = Math.max(ymax, v)), (ymin = Math.min(ymin, v, 0))));
    if (s.type === 'errorbar') s.hi.forEach((v) => Number.isFinite(v) && (ymax = Math.max(ymax, v)));
    if (s.type === 'box') ((ymax = Math.max(ymax, s.hi, ...s.outliers)), (ymin = Math.min(ymin, s.lo)));
    if (s.type === 'violin') s.density.forEach((d) => (ymax = Math.max(ymax, d.y)));
  }
  if (!Number.isFinite(ymax)) return;
  const range = ymax - Math.min(ymin, 0) || 1;
  const step = range * 0.09;
  const brackets = anns.filter((a) => a.kind === 'bracket').sort((a, b) => Math.abs((a.to ?? 0) - (a.from ?? 0)) - Math.abs((b.to ?? 0) - (b.from ?? 0)));
  const levels: { from: number; to: number; level: number }[] = [];
  for (const b of brackets) {
    const from = Math.min(b.from ?? 0, b.to ?? 0) + 1, to = Math.max(b.from ?? 0, b.to ?? 0) + 1;
    let level = 0;
    while (levels.some((l) => l.level === level && !(to < l.from || from > l.to))) level++;
    levels.push({ from, to, level });
    const y = b.y ?? ymax + step * (level + 0.8);
    ax.series.push({ type: 'bracket', x1: from + 0.04, x2: to - 0.04, y, text: b.text, color: fig.style === 'dark' ? '#e6e8ee' : '#000000', width: 1.2 });
  }
  for (const a of anns.filter((x) => x.kind === 'text')) ax.series.push({ type: 'text', x: (a.x ?? 0) + 1, y: a.y ?? ymax, text: a.text, color: '#000000', size: fig.fontSize, anchor: 'middle' });
  const top = ymax + step * (Math.max(0, ...levels.map((l) => l.level)) + 1.6);
  if (ax.y.max === undefined) ax.y.max = undefined;
  // Expand y-range to fit brackets by adding an invisible point
  ax.series.push({ type: 'scatter', x: [NaN], y: [top], color: 'none', marker: 'none', size: 0, fill: 'none' });
  ax.series.push({ type: 'hline', value: top, color: 'none', dash: 'none', width: 0 });
}

export function significanceAnnotations(marks: { i: number; j: number; p: number; summary: string; row?: number }[], t: DataTable, g: Graph, showNs = false): Annotation[] {
  const idx = selectedDatasets(t, g.datasetIds);
  const pos = (dsIndex: number) => idx.indexOf(dsIndex);
  return marks
    .filter((m) => m.row === undefined)
    .filter((m) => showNs || m.summary !== 'ns')
    .filter((m) => pos(m.i) >= 0 && pos(m.j) >= 0)
    .map((m) => ({ id: `ann_${m.i}_${m.j}_${Math.random().toString(36).slice(2, 6)}`, kind: 'bracket' as const, from: pos(m.i), to: pos(m.j), text: m.summary }));
}

export function markerForShape(m: MarkerShape): Marker {
  return m as Marker;
}

export { mean };
