import { CellArray, MError, StructArray, Tensor, bool, isStringLike, num, rowVec, str, toNumber, toStringValue, toTensor, zeros, type Value, cellStrings } from '../value';
import type { Interpreter, CallContext } from '../interp';
import { def, minArgs } from './helpers';
import { emptyAxes, emptyFigure, colormapColor, type AxesSpec, type Dash, type FigureSpec, type Marker, type SeriesSpec, PALETTES } from '../../graph/spec';
import { contourLines } from '../../graph/contour';

export const MATLAB_COLORS = PALETTES.matlab.colors;

interface AxState {
  spec: AxesSpec;
  hold: boolean;
  colorIndex: number;
  handle: number;
}

interface FigState {
  number: number;
  name: string;
  spec: FigureSpec;
  axes: AxState[];
  current: number;
  dirty: boolean;
}

export class GraphicsState {
  figures = new Map<number, FigState>();
  current = 0;
  nextHandle = 1000;
  handles = new Map<number, { type: 'axes' | 'series'; fig: number; ax: number; series?: SeriesSpec }>();
  changed = false;

  reset() {
    this.figures.clear();
    this.current = 0;
    this.handles.clear();
    this.changed = true;
  }

  figure(n?: number): FigState {
    if (n === undefined) {
      n = 1;
      while (this.figures.has(n)) n++;
    }
    let f = this.figures.get(n);
    if (!f) {
      f = { number: n, name: '', spec: emptyFigure('matlab'), axes: [], current: -1, dirty: true };
      this.figures.set(n, f);
    }
    this.current = n;
    this.changed = true;
    return f;
  }

  gcf(): FigState {
    return this.figures.get(this.current) ?? this.figure();
  }

  gca(): AxState {
    const f = this.gcf();
    if (f.current < 0 || !f.axes[f.current]) {
      const ax = this.newAxes(f, 0, 0);
      f.current = f.axes.indexOf(ax);
    }
    this.changed = true;
    f.dirty = true;
    return f.axes[f.current];
  }

  newAxes(f: FigState, row: number, col: number, rowSpan = 1, colSpan = 1): AxState {
    const h = this.nextHandle++;
    const spec = emptyAxes(`ax${h}`, row, col);
    spec.rowSpan = rowSpan;
    spec.colSpan = colSpan;
    const ax: AxState = { spec, hold: false, colorIndex: 0, handle: h };
    f.axes.push(ax);
    this.handles.set(h, { type: 'axes', fig: f.number, ax: f.axes.length - 1 });
    return ax;
  }

  subplot(m: number, n: number, p: number[]): AxState {
    const f = this.gcf();
    const ps = p.map((x) => x - 1);
    const rows = ps.map((q) => Math.floor(q / n)), cols = ps.map((q) => q % n);
    const r0 = Math.min(...rows), c0 = Math.min(...cols);
    const rs = Math.max(...rows) - r0 + 1, cs = Math.max(...cols) - c0 + 1;
    if (f.spec.rows !== m || f.spec.cols !== n) {
      // changing grid: drop axes that don't fit the new layout
      f.axes = f.axes.filter((a) => a.spec.row < m && a.spec.col < n && (f.spec.rows === 1 && f.spec.cols === 1 ? a.spec.series.length > 0 && false : true));
      f.spec.rows = m;
      f.spec.cols = n;
    }
    let idx = f.axes.findIndex((a) => a.spec.row === r0 && a.spec.col === c0 && (a.spec.rowSpan ?? 1) === rs && (a.spec.colSpan ?? 1) === cs);
    if (idx < 0) {
      // remove overlapping axes
      f.axes = f.axes.filter((a) => !(a.spec.row < r0 + rs && a.spec.row + (a.spec.rowSpan ?? 1) > r0 && a.spec.col < c0 + cs && a.spec.col + (a.spec.colSpan ?? 1) > c0));
      this.newAxes(f, r0, c0, rs, cs);
      idx = f.axes.length - 1;
    }
    f.current = idx;
    f.dirty = true;
    this.changed = true;
    return f.axes[idx];
  }

  /** Prepare current axes for a new plot command (respects hold). */
  plotTarget(): AxState {
    const ax = this.gca();
    if (!ax.hold) {
      ax.spec.series = [];
      ax.colorIndex = 0;
      ax.spec.legend = { show: ax.spec.legend.show && false, location: ax.spec.legend.location };
      ax.spec.kind = 'cartesian';
      ax.spec.colorbar = undefined;
      ax.spec.x.scale = 'linear';
      ax.spec.y.scale = 'linear';
      ax.spec.x.categories = undefined;
      ax.spec.x.ticks = undefined;
      ax.spec.x.tickLabels = undefined;
    }
    return ax;
  }

  nextColor(ax: AxState): string {
    const c = MATLAB_COLORS[ax.colorIndex % MATLAB_COLORS.length];
    ax.colorIndex++;
    return c;
  }

  addSeries(ax: AxState, s: SeriesSpec): number {
    ax.spec.series.push(s);
    const h = this.nextHandle++;
    const f = this.gcf();
    this.handles.set(h, { type: 'series', fig: f.number, ax: f.axes.indexOf(ax), series: s });
    return h;
  }

  snapshot(): { number: number; name: string; spec: FigureSpec }[] {
    return [...this.figures.values()].map((f) => ({ number: f.number, name: f.name || `Figure ${f.number}`, spec: { ...f.spec, axes: f.axes.map((a) => ({ ...a.spec, hold: a.hold })) } }));
  }
}

// ---------------- Color & line spec parsing ----------------
const COLOR_CHARS: Record<string, string> = { r: '#FF0000', g: '#00FF00', b: '#0000FF', c: '#00FFFF', m: '#FF00FF', y: '#FFFF00', k: '#000000', w: '#FFFFFF' };
const COLOR_NAMES: Record<string, string> = { red: '#FF0000', green: '#00FF00', blue: '#0000FF', cyan: '#00FFFF', magenta: '#FF00FF', yellow: '#FFFF00', black: '#000000', white: '#FFFFFF', none: 'none' };

export function parseColor(v: Value): string {
  if (isStringLike(v)) {
    const s = toStringValue(v).trim();
    if (s.startsWith('#')) return s;
    if (COLOR_CHARS[s]) return COLOR_CHARS[s];
    if (COLOR_NAMES[s.toLowerCase()]) return COLOR_NAMES[s.toLowerCase()];
    return s;
  }
  const t = toTensor(v);
  if (t.numel >= 3) {
    const scale = Math.max(t.re[0], t.re[1], t.re[2]) > 1 ? 1 : 255;
    const c = [0, 1, 2].map((i) => Math.round(Math.max(0, Math.min(255, t.re[i] * scale))));
    return '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  throw new MError('Invalid color specification.');
}

const MARKERS: Record<string, Marker> = { o: 'circle', '+': 'plus', '*': 'star', '.': 'point', x: 'cross', s: 'square', d: 'diamond', '^': 'triangle', v: 'triangleDown', '<': 'triangleLeft', '>': 'triangleRight', p: 'pentagram', h: 'hexagram' };
const MARKER_NAMES: Record<string, Marker> = { circle: 'circle', square: 'square', diamond: 'diamond', none: 'none', pentagram: 'pentagram', hexagram: 'hexagram', '^': 'triangle', v: 'triangleDown' };

export function parseLineSpec(s: string): { color?: string; dash?: Dash; marker?: Marker } | null {
  let rest = s;
  const out: { color?: string; dash?: Dash; marker?: Marker } = {};
  const styles: [string, Dash][] = [['--', 'dash'], ['-.', 'dashdot'], ['-', 'solid'], [':', 'dot']];
  for (const [tok, d] of styles) {
    if (rest.includes(tok)) {
      out.dash = d;
      rest = rest.replace(tok, '');
      break;
    }
  }
  for (const ch of rest) {
    if (COLOR_CHARS[ch]) out.color = COLOR_CHARS[ch];
    else if (MARKERS[ch]) out.marker = MARKERS[ch];
    else return null;
  }
  return out;
}

function isLineSpec(v: Value): boolean {
  if (!isStringLike(v)) return false;
  const s = toStringValue(v);
  if (!s.length || s.length > 4) return false;
  return parseLineSpec(s) !== null;
}

const NV_PROPS = new Set(['linewidth', 'color', 'markersize', 'markerfacecolor', 'markeredgecolor', 'displayname', 'linestyle', 'marker', 'facecolor', 'edgecolor', 'facealpha', 'barwidth', 'basevalue', 'normalization', 'binwidth', 'binedges', 'numbins', 'cdata', 'markerfacealpha', 'alpha', 'sizedata', 'horizontalalignment', 'fontsize', 'fontweight', 'location', 'orientation', 'capsize', 'labels', 'levelstep', 'levellist', 'showtext', 'linecolor', 'interpreter', 'autoupdate', 'box', 'textcolor', 'colormap']);

function splitNameValue(a: Value[]): { pos: Value[]; nv: Map<string, Value> } {
  const nv = new Map<string, Value>();
  let k = a.length;
  for (let i = 0; i < a.length; i++) {
    if (isStringLike(a[i]) && NV_PROPS.has(toStringValue(a[i]).toLowerCase()) && i + 1 < a.length) {
      k = i;
      break;
    }
  }
  for (let i = k; i + 1 < a.length; i += 2) if (isStringLike(a[i])) nv.set(toStringValue(a[i]).toLowerCase(), a[i + 1]);
  return { pos: a.slice(0, k), nv };
}

function columns(t: Tensor): number[][] {
  if (t.rows === 1 || t.cols === 1) return [Array.from(t.re)];
  return Array.from({ length: t.cols }, (_, j) => Array.from(t.re.subarray(j * t.rows, (j + 1) * t.rows)));
}

function asSeriesMatrix(t: Tensor, n: number): number[][] {
  // returns list of series each of length n (matching x length when possible)
  if (t.rows === 1 || t.cols === 1) return [Array.from(t.re)];
  if (t.rows === n) return Array.from({ length: t.cols }, (_, j) => Array.from(t.re.subarray(j * t.rows, (j + 1) * t.rows)));
  if (t.cols === n) return Array.from({ length: t.rows }, (_, i) => Array.from({ length: t.cols }, (_, j) => t.re[j * t.rows + i]));
  return columns(t);
}

function applyLineNV(s: SeriesSpec & { type: 'line' }, nv: Map<string, Value>) {
  if (nv.has('linewidth')) s.width = toNumber(nv.get('linewidth')!);
  if (nv.has('color')) s.color = parseColor(nv.get('color')!);
  if (nv.has('markersize')) s.markerSize = toNumber(nv.get('markersize')!);
  if (nv.has('markerfacecolor')) s.markerFill = parseColor(nv.get('markerfacecolor')!);
  if (nv.has('markeredgecolor')) s.markerEdge = parseColor(nv.get('markeredgecolor')!);
  if (nv.has('displayname')) s.label = toStringValue(nv.get('displayname')!);
  if (nv.has('linestyle')) {
    const ls = toStringValue(nv.get('linestyle')!);
    s.dash = ls === 'none' ? 'none' : (parseLineSpec(ls)?.dash ?? 'solid');
  }
  if (nv.has('marker')) {
    const m = toStringValue(nv.get('marker')!);
    s.marker = MARKERS[m] ?? MARKER_NAMES[m.toLowerCase()] ?? 'none';
  }
}

function plotCommand(G: GraphicsState, a: Value[], scale?: { x?: 'log'; y?: 'log' }, step?: 'post'): Value[] {
  const { pos, nv } = splitNameValue(a);
  const ax = G.plotTarget();
  if (scale?.x) ax.spec.x.scale = 'log';
  if (scale?.y) ax.spec.y.scale = 'log';
  const handles: number[] = [];
  let i = 0;
  while (i < pos.length) {
    let X: Tensor | null = null, Y: Tensor;
    const first = toTensor(pos[i]);
    if (i + 1 < pos.length && !isLineSpec(pos[i + 1])) {
      X = first;
      Y = toTensor(pos[i + 1]);
      i += 2;
    } else {
      Y = first;
      i += 1;
    }
    let spec: ReturnType<typeof parseLineSpec> = null;
    if (i < pos.length && isLineSpec(pos[i])) {
      spec = parseLineSpec(toStringValue(pos[i]));
      i++;
    }
    let ys: number[][];
    let xs: number[][];
    if (Y.im && !X) {
      // plot(z) for complex z: real vs imag
      xs = [Array.from(Y.re)];
      ys = [Array.from(Y.im)];
    } else if (!X) {
      ys = columns(Y);
      xs = ys.map((y) => y.map((_, k) => k + 1));
    } else {
      const xc = columns(X);
      if (xc.length > 1 && (Y.rows === 1 || Y.cols === 1)) {
        xs = xc;
        ys = xc.map(() => Array.from(Y.re));
      } else {
        const n = xc[0].length;
        ys = asSeriesMatrix(Y, n);
        xs = xc.length === ys.length ? xc : ys.map(() => xc[0]);
      }
    }
    ys.forEach((y, k) => {
      const color = spec?.color ?? G.nextColor(ax);
      const marker = spec?.marker ?? 'none';
      const dash: Dash = spec?.dash ?? (spec?.marker ? 'none' : 'solid');
      const s: SeriesSpec & { type: 'line' } = { type: 'line', x: xs[k], y, color, width: 0.5 * 1.0 + 0.5, dash, marker, markerSize: 6, step };
      applyLineNV(s, nv);
      handles.push(G.addSeries(ax, s));
    });
  }
  return handles.length ? [rowVec(handles)] : [];
}

function gridOf(t: Tensor): number[][] {
  // rows of a matrix
  return Array.from({ length: t.rows }, (_, i) => Array.from({ length: t.cols }, (_, j) => t.re[j * t.rows + i]));
}

export function registerGraphics(I: Interpreter) {
  const G = new GraphicsState();
  I.graphics = G;
  const ret = (nargout: number, h: number) => (nargout > 0 ? [num(h)] : []);

  def(I, 'figure', (a, nargout) => {
    let n: number | undefined;
    const rest = [...a];
    if (rest.length && !isStringLike(rest[0])) n = toNumber(rest.shift()!);
    const f = G.figure(n);
    for (let i = 0; i + 1 < rest.length; i += 2) {
      const k = toStringValue(rest[i]).toLowerCase();
      if (k === 'name') f.name = toStringValue(rest[i + 1]);
      if (k === 'position') {
        const p = toTensor(rest[i + 1]);
        if (p.numel >= 4) {
          f.spec.width = p.re[2];
          f.spec.height = p.re[3];
        }
      }
      if (k === 'color') f.spec.background = parseColor(rest[i + 1]);
    }
    return ret(nargout, f.number);
  });
  def(I, 'gcf', () => num(G.gcf().number));
  def(I, 'gca', () => num(G.gca().handle));
  def(I, 'clf', () => {
    const f = G.gcf();
    f.axes = [];
    f.current = -1;
    f.spec.rows = 1;
    f.spec.cols = 1;
    f.spec.title = undefined;
    f.dirty = true;
    G.changed = true;
  });
  def(I, 'cla', () => {
    const ax = G.gca();
    ax.spec.series = [];
    ax.colorIndex = 0;
  });
  def(I, 'close', (a) => {
    if (!a.length) {
      G.figures.delete(G.current);
      G.current = [...G.figures.keys()].pop() ?? 0;
    } else if (isStringLike(a[0]) && toStringValue(a[0]) === 'all') G.reset();
    else for (const v of Array.from(toTensor(a[0]).re)) G.figures.delete(v);
    G.changed = true;
  });
  def(I, 'hold', (a) => {
    const ax = G.gca();
    if (!a.length) ax.hold = !ax.hold;
    else {
      const s = toStringValue(a[0]).toLowerCase();
      ax.hold = s === 'on' || s === 'all';
    }
  });
  def(I, 'ishold', () => bool(G.gca().hold));
  def(I, 'subplot', (a, nargout) => {
    let m: number, n: number, p: number[];
    if (a.length === 1) {
      const code = Math.floor(toNumber(a[0]));
      m = Math.floor(code / 100);
      n = Math.floor((code % 100) / 10);
      p = [code % 10];
    } else {
      m = toNumber(a[0]);
      n = toNumber(a[1]);
      p = Array.from(toTensor(a[2]).re);
    }
    const ax = G.subplot(m, n, p);
    return ret(nargout, ax.handle);
  });
  def(I, 'tiledlayout', (a) => {
    const f = G.gcf();
    f.axes = [];
    f.spec.rows = toNumber(a[0]);
    f.spec.cols = toNumber(a[1]);
    (f as any).tile = 0;
  });
  def(I, 'nexttile', (a, nargout) => {
    const f = G.gcf();
    const t = a.length ? toNumber(a[0]) : ((f as any).tile ?? 0) + 1;
    (f as any).tile = t;
    const ax = G.subplot(f.spec.rows, f.spec.cols, [t]);
    return ret(nargout, ax.handle);
  });
  def(I, 'plot', (a, nargout) => {
    minArgs(a, 1);
    const h = plotCommand(G, a);
    return nargout > 0 ? h : [];
  });
  def(I, 'semilogx', (a, nargout) => (nargout > 0 ? plotCommand(G, a, { x: 'log' }) : (plotCommand(G, a, { x: 'log' }), [])));
  def(I, 'semilogy', (a, nargout) => (nargout > 0 ? plotCommand(G, a, { y: 'log' }) : (plotCommand(G, a, { y: 'log' }), [])));
  def(I, 'loglog', (a, nargout) => (nargout > 0 ? plotCommand(G, a, { x: 'log', y: 'log' }) : (plotCommand(G, a, { x: 'log', y: 'log' }), [])));
  def(I, 'stairs', (a, nargout) => (nargout > 0 ? plotCommand(G, a, undefined, 'post') : (plotCommand(G, a, undefined, 'post'), [])));
  def(I, 'line', (a, nargout) => {
    const ax = G.gca();
    const { pos, nv } = splitNameValue(a);
    const x = Array.from(toTensor(pos[0]).re), y = Array.from(toTensor(pos[1]).re);
    const s: SeriesSpec & { type: 'line' } = { type: 'line', x, y, color: G.nextColor(ax), width: 1, dash: 'solid', marker: 'none', markerSize: 6 };
    applyLineNV(s, nv);
    return ret(nargout, G.addSeries(ax, s));
  });
  def(I, 'fplot', (a, nargout, ctx) => {
    const f = a[0];
    const lim = a.length > 1 && !isStringLike(a[1]) ? Array.from(toTensor(a[1]).re) : [-5, 5];
    const N = 300;
    const xs = Array.from({ length: N }, (_, k) => lim[0] + ((lim[1] - lim[0]) * k) / (N - 1));
    let ys: number[];
    try {
      ys = Array.from(toTensor(ctx.interp.callHandle(f, [rowVec(xs)], 1, ctx.scope)[0]).re);
      if (ys.length !== xs.length) throw new Error('scalar');
    } catch {
      ys = xs.map((x) => toNumber(ctx.interp.callHandle(f, [num(x)], 1, ctx.scope)[0]));
    }
    const rest = a.slice(lim.length && a.length > 1 && !isStringLike(a[1]) ? 2 : 1);
    return plotCommand(G, [rowVec(xs), rowVec(ys), ...rest]).slice(0, nargout);
  });
  def(I, ['scatter', 'swarmchart'], (a, nargout) => {
    const { pos, nv } = splitNameValue(a);
    const ax = G.plotTarget();
    const x = Array.from(toTensor(pos[0]).re), y = Array.from(toTensor(pos[1]).re);
    let size = 36;
    let sizes: number[] | undefined;
    let color = G.nextColor(ax);
    let colors: string[] | undefined;
    let filled = false;
    let marker: Marker = 'circle';
    for (let i = 2; i < pos.length; i++) {
      const v = pos[i];
      if (isStringLike(v)) {
        const s = toStringValue(v);
        if (s === 'filled') filled = true;
        else if (MARKERS[s]) marker = MARKERS[s];
        else if (parseLineSpec(s)?.color) color = parseLineSpec(s)!.color!;
        continue;
      }
      const t = toTensor(v);
      if (i === 2) {
        if (t.numel === 1) size = t.re[0];
        else if (t.numel > 1) sizes = Array.from(t.re);
      } else if (i === 3) {
        if (t.numel === 3 && x.length !== 3) color = parseColor(t);
        else if (t.numel === x.length) {
          const v2 = Array.from(t.re);
          const lo = Math.min(...v2), hi = Math.max(...v2);
          const cmap = ax.spec.colormap ?? 'parula';
          colors = v2.map((c) => colormapColorLazy(cmap, (c - lo) / (hi - lo || 1)));
          ax.spec.colorbar = ax.spec.colorbar ?? undefined;
          ax.spec.clim = [lo, hi];
        } else if (t.numel === 3) color = parseColor(t);
      }
    }
    if (nv.has('markerfacecolor')) {
      filled = true;
      color = parseColor(nv.get('markerfacecolor')!);
    }
    if (nv.has('markeredgecolor') && !filled) color = parseColor(nv.get('markeredgecolor')!);
    const s: SeriesSpec = {
      type: 'scatter', x, y, color, marker, size: Math.sqrt(size), sizes: sizes?.map(Math.sqrt), colors, fill: filled ? 'auto' : 'none',
      label: nv.has('displayname') ? toStringValue(nv.get('displayname')!) : undefined, opacity: nv.has('markerfacealpha') ? toNumber(nv.get('markerfacealpha')!) : undefined,
    };
    return ret(nargout, G.addSeries(ax, s));
  });
  def(I, ['bar', 'barh'], (a, nargout, ctx) => {
    const { pos, nv } = splitNameValue(a);
    const ax = G.plotTarget();
    let x: number[] | null = null;
    let Y: Tensor;
    let rest: Value[];
    if (pos.length >= 2 && !isStringLike(pos[1]) && toTensor(pos[1]).numel > 1 || (pos.length >= 2 && !isStringLike(pos[1]) && toTensor(pos[0]).numel === toTensor(pos[1]).numel && toTensor(pos[1]).numel >= 1 && toTensor(pos[0]).numel > 1)) {
      x = Array.from(toTensor(pos[0]).re);
      Y = toTensor(pos[1]);
      rest = pos.slice(2);
    } else {
      Y = toTensor(pos[0]);
      rest = pos.slice(1);
    }
    let width = 0.8;
    let stacked = false;
    let color: string | undefined;
    for (const r of rest) {
      if (isStringLike(r)) {
        const s = toStringValue(r);
        if (s === 'stacked') stacked = true;
        else if (s === 'grouped') stacked = false;
        else if (parseLineSpec(s)?.color) color = parseLineSpec(s)!.color;
      } else width = toNumber(r);
    }
    if (nv.has('barwidth')) width = toNumber(nv.get('barwidth')!);
    if (nv.has('facecolor')) color = parseColor(nv.get('facecolor')!);
    const groups = Y.rows === 1 || Y.cols === 1 ? [Array.from(Y.re)] : Array.from({ length: Y.cols }, (_, j) => Array.from(Y.re.subarray(j * Y.rows, (j + 1) * Y.rows)));
    const n = groups[0].length;
    const xs = x ?? Array.from({ length: n }, (_, k) => k + 1);
    const horizontal = ctx.name === 'barh';
    const k = groups.length;
    const handles: number[] = [];
    const base = new Array(n).fill(0);
    groups.forEach((g, gi) => {
      const c = color && k === 1 ? color : G.nextColor(ax);
      const groupWidth = Math.min(0.8, k / (k + 1.5));
      const w = k === 1 || stacked ? width : (groupWidth / k) * width / 0.8;
      const offs = k === 1 || stacked ? 0 : -groupWidth / 2 + (groupWidth / k) * (gi + 0.5);
      const s: SeriesSpec = {
        type: 'bar', x: xs.map((v) => v + offs), y: stacked ? g.map((v, i) => base[i] + v) : g, base: stacked ? [...base] : undefined, width: w * (xs.length > 1 ? Math.min(...xs.slice(1).map((v, i) => v - xs[i])) : 1),
        color: '#000000', fill: c, edge: nv.has('edgecolor') ? parseColor(nv.get('edgecolor')!) : '#000000', edgeWidth: 0.5, horizontal, label: nv.has('displayname') ? toStringValue(nv.get('displayname')!) : undefined,
        opacity: nv.has('facealpha') ? toNumber(nv.get('facealpha')!) : undefined,
      };
      if (stacked) g.forEach((v, i) => (base[i] += v));
      handles.push(G.addSeries(ax, s));
    });
    if (!x && !horizontal) ax.spec.x.ticks = xs;
    if (!x && horizontal) ax.spec.y.ticks = xs;
    return nargout > 0 ? [rowVec(handles)] : [];
  });
  def(I, ['histogram', 'hist'], (a, nargout, ctx) => {
    const { pos, nv } = splitNameValue(a);
    const x = Array.from(toTensor(pos[0]).re).filter(Number.isFinite);
    let edges: number[];
    const lo = Math.min(...x), hi = Math.max(...x);
    if (pos.length > 1 && toTensor(pos[1]).numel > 1 && ctx.name === 'histogram') edges = Array.from(toTensor(pos[1]).re);
    else if (nv.has('binedges')) edges = Array.from(toTensor(nv.get('binedges')!).re);
    else {
      let nb: number;
      if (pos.length > 1 && toTensor(pos[1]).numel === 1) nb = toNumber(pos[1]);
      else if (nv.has('numbins')) nb = toNumber(nv.get('numbins')!);
      else if (ctx.name === 'hist') nb = 10;
      else {
        // Scott's rule like MATLAB's 'auto'
        const sd = Math.sqrt(x.reduce((s, v) => s + (v - x.reduce((p, q) => p + q, 0) / x.length) ** 2, 0) / Math.max(1, x.length - 1));
        let w = nv.has('binwidth') ? toNumber(nv.get('binwidth')!) : 3.5 * sd / Math.cbrt(x.length) || 1;
        const mag = Math.pow(10, Math.floor(Math.log10(w)));
        const r = w / mag;
        w = (r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10) * mag;
        const start = Math.floor(lo / w) * w;
        const end = Math.max(start + w, Math.ceil(hi / w) * w + (hi % w === 0 ? w : 0));
        nb = Math.max(1, Math.round((end - start) / w));
        edges = Array.from({ length: nb + 1 }, (_, i) => start + i * w);
        return finishHist(edges);
      }
      if (ctx.name === 'hist' && pos.length > 1 && toTensor(pos[1]).numel > 1) {
        // hist(x, centers)
        const centers = Array.from(toTensor(pos[1]).re);
        edges = [centers[0] - (centers[1] - centers[0]) / 2, ...centers.slice(0, -1).map((c, i) => (c + centers[i + 1]) / 2), centers[centers.length - 1] + (centers[centers.length - 1] - centers[centers.length - 2]) / 2];
      } else edges = Array.from({ length: nb + 1 }, (_, i) => lo + ((hi - lo || 1) * i) / nb);
    }
    return finishHist(edges);
    function finishHist(e: number[]): Value[] {
      const counts = new Array(e.length - 1).fill(0);
      for (const v of x) {
        let b = e.findIndex((edge, i) => i < e.length - 1 && v >= edge && (v < e[i + 1] || (i === e.length - 2 && v <= e[i + 1])));
        if (b < 0 && ctx.name === 'hist') b = v < e[0] ? 0 : counts.length - 1;
        if (b >= 0) counts[b]++;
      }
      const centers = counts.map((_, i) => (e[i] + e[i + 1]) / 2);
      if (ctx.name === 'hist' && nargout > 0) return [rowVec(counts), rowVec(centers)];
      const norm = nv.has('normalization') ? toStringValue(nv.get('normalization')!).toLowerCase() : 'count';
      const widths = counts.map((_, i) => e[i + 1] - e[i]);
      const vals = counts.map((c, i) => (norm === 'probability' ? c / x.length : norm === 'pdf' ? c / (x.length * widths[i]) : norm === 'cdf' ? counts.slice(0, i + 1).reduce((s, q) => s + q, 0) / x.length : norm === 'cumcount' ? counts.slice(0, i + 1).reduce((s, q) => s + q, 0) : norm === 'countdensity' ? c / widths[i] : c));
      const ax = G.plotTarget();
      const fill = nv.has('facecolor') ? parseColor(nv.get('facecolor')!) : G.nextColor(ax);
      const s: SeriesSpec = { type: 'bar', x: centers, y: vals, width: widths[0], color: '#000', fill, edge: nv.has('edgecolor') ? parseColor(nv.get('edgecolor')!) : '#000000', edgeWidth: 0.5, opacity: nv.has('facealpha') ? toNumber(nv.get('facealpha')!) : 0.6, label: nv.has('displayname') ? toStringValue(nv.get('displayname')!) : undefined };
      const h = G.addSeries(ax, s);
      if (nargout > 0) return [StructArray.scalar([['Values', rowVec(counts)], ['BinEdges', rowVec(e)], ['NumBins', num(counts.length)], ['Handle', num(h)]])];
      return [];
    }
  });
  def(I, 'errorbar', (a, nargout) => {
    const { pos, nv } = splitNameValue(a);
    const ax = G.plotTarget();
    const nums = pos.filter((v) => !isStringLike(v)).map((v) => Array.from(toTensor(v).re));
    const specV = pos.find((v) => isStringLike(v) && isLineSpec(v));
    const spec = specV ? parseLineSpec(toStringValue(specV)) : null;
    let x: number[], y: number[], lo: number[], hi: number[];
    if (nums.length === 2) {
      y = nums[0];
      x = y.map((_, i) => i + 1);
      lo = nums[1];
      hi = nums[1];
    } else if (nums.length === 3) {
      [x, y, lo] = nums;
      hi = lo;
    } else {
      [x, y, lo, hi] = nums;
    }
    const color = spec?.color ?? (nv.has('color') ? parseColor(nv.get('color')!) : G.nextColor(ax));
    const lineS: SeriesSpec & { type: 'line' } = { type: 'line', x, y, color, width: 1, dash: spec?.dash ?? (spec?.marker ? 'none' : 'solid'), marker: spec?.marker ?? 'none', markerSize: 6 };
    applyLineNV(lineS, nv);
    G.addSeries(ax, { type: 'errorbar', x, y, lo: y.map((v, i) => v - (lo[lo.length === 1 ? 0 : i] ?? 0)), hi: y.map((v, i) => v + (hi[hi.length === 1 ? 0 : i] ?? 0)), color, width: lineS.width, cap: nv.has('capsize') ? toNumber(nv.get('capsize')!) : 6 });
    return ret(nargout, G.addSeries(ax, lineS));
  });
  def(I, 'area', (a, nargout) => {
    const { pos, nv } = splitNameValue(a);
    const ax = G.plotTarget();
    const x = pos.length > 1 ? Array.from(toTensor(pos[0]).re) : null;
    const Y = toTensor(pos[pos.length > 1 ? 1 : 0]);
    const ys = Y.rows === 1 || Y.cols === 1 ? [Array.from(Y.re)] : Array.from({ length: Y.cols }, (_, j) => Array.from(Y.re.subarray(j * Y.rows, (j + 1) * Y.rows)));
    const xs = x ?? ys[0].map((_, i) => i + 1);
    let base = new Array(xs.length).fill(0);
    ys.forEach((y) => {
      const top = y.map((v, i) => v + base[i]);
      G.addSeries(ax, { type: 'area', x: xs, y: top, y0: [...base], color: nv.has('facecolor') ? parseColor(nv.get('facecolor')!) : G.nextColor(ax), opacity: nv.has('facealpha') ? toNumber(nv.get('facealpha')!) : 1, edge: '#000000' });
      base = top;
    });
    return ret(nargout, 0);
  });
  def(I, ['fill', 'patch'], (a, nargout) => {
    const ax = G.gca();
    const x = Array.from(toTensor(a[0]).re), y = Array.from(toTensor(a[1]).re);
    const { nv } = splitNameValue(a.slice(2));
    const c = a.length > 2 && !NV_PROPS.has(isStringLike(a[2]) ? toStringValue(a[2]).toLowerCase() : '') ? parseColor(a[2]) : G.nextColor(ax);
    return ret(nargout, G.addSeries(ax, { type: 'polygon', x, y, color: nv.has('facecolor') ? parseColor(nv.get('facecolor')!) : c, opacity: nv.has('facealpha') ? toNumber(nv.get('facealpha')!) : 1, edge: nv.has('edgecolor') ? parseColor(nv.get('edgecolor')!) : '#000000' }));
  });
  def(I, 'stem', (a, nargout) => {
    const { pos, nv } = splitNameValue(a);
    const ax = G.plotTarget();
    const nums = pos.filter((v) => !isStringLike(v)).map((v) => Array.from(toTensor(v).re));
    const y = nums.length > 1 ? nums[1] : nums[0];
    const x = nums.length > 1 ? nums[0] : y.map((_, i) => i + 1);
    const filled = pos.some((v) => isStringLike(v) && toStringValue(v) === 'filled');
    const color = nv.has('color') ? parseColor(nv.get('color')!) : G.nextColor(ax);
    return ret(nargout, G.addSeries(ax, { type: 'stem', x, y, base: 0, color, width: 1, marker: 'circle', markerSize: 6, markerFill: filled ? color : 'none' }));
  });
  def(I, 'pie', (a) => {
    const ax = G.plotTarget();
    const v = Array.from(toTensor(a[0]).re);
    let labels = v.map((x) => `${Math.round((100 * x) / v.reduce((s, y) => s + y, 0))}%`);
    const labArg = a.find((x, i) => i > 0 && (x.kind === 'cell' || x.kind === 'string'));
    if (labArg) labels = cellStrings(labArg);
    ax.spec.kind = 'pie';
    ax.spec.x.hidden = true;
    ax.spec.y.hidden = true;
    G.addSeries(ax, { type: 'pie', values: v, labels, colors: v.map((_, i) => colormapColorLazy(ax.spec.colormap ?? 'parula', v.length > 1 ? i / (v.length - 1) : 0.5)), donut: 0, showPercent: !labArg });
  });
  def(I, 'boxplot', (a) => {
    const ax = G.plotTarget();
    const t = toTensor(a[0]);
    let groups: number[][];
    let names: string[];
    if (a.length > 1 && !isStringLike(a[1]) || a[1]?.kind === 'cell') {
      const g = a[1].kind === 'cell' ? a[1].data.map((v) => toStringValue(v)) : Array.from(toTensor(a[1]).re, String);
      names = [...new Set(g)];
      groups = names.map((n) => Array.from(t.re).filter((_, i) => g[i] === n));
    } else {
      groups = t.rows === 1 || t.cols === 1 ? [Array.from(t.re)] : Array.from({ length: t.cols }, (_, j) => Array.from(t.re.subarray(j * t.rows, (j + 1) * t.rows)));
      names = groups.map((_, i) => String(i + 1));
    }
    const lab = a.findIndex((v) => isStringLike(v) && toStringValue(v).toLowerCase() === 'labels');
    if (lab >= 0) names = cellStrings(a[lab + 1]);
    groups.forEach((g, i) => {
      const s = g.filter(Number.isFinite).sort((p, q) => p - q);
      const q = (p: number) => {
        const n = s.length, h = n * p + 0.5;
        if (h <= 1) return s[0];
        if (h >= n) return s[n - 1];
        const lo = Math.floor(h);
        return s[lo - 1] + (h - lo) * (s[lo] - s[lo - 1]);
      };
      const q1 = q(0.25), q3 = q(0.75), med = q(0.5), iqr = q3 - q1;
      const inl = s.filter((v) => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
      G.addSeries(ax, { type: 'box', x: i + 1, width: 0.5, q1, med, q3, lo: inl[0], hi: inl[inl.length - 1], outliers: s.filter((v) => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr), color: '#0000FF', fill: 'none', lineWidth: 1 });
    });
    ax.spec.x.categories = names;
  });
  def(I, ['imagesc', 'image', 'heatmap', 'pcolor'], (a, nargout, ctx) => {
    const ax = G.plotTarget();
    let C: Tensor, x0 = 1, x1: number, y0 = 1, y1: number;
    const nums = a.filter((v) => !isStringLike(v) && v.kind !== 'cell');
    if (nums.length >= 3) {
      const xv = Array.from(toTensor(nums[0]).re), yv = Array.from(toTensor(nums[1]).re);
      C = toTensor(nums[2]);
      x0 = xv[0];
      x1 = xv[xv.length - 1];
      y0 = yv[0];
      y1 = yv[yv.length - 1];
    } else {
      C = toTensor(nums[0]);
      x1 = C.cols;
      y1 = C.rows;
    }
    const z = gridOf(C);
    const vals = z.flat().filter(Number.isFinite);
    const cmin = ax.spec.clim?.[0] ?? Math.min(...vals), cmax = ax.spec.clim?.[1] ?? Math.max(...vals);
    const cmap = ax.spec.colormap ?? 'parula';
    const isHeat = ctx.name === 'heatmap';
    const cells = a.filter((v) => v.kind === 'cell');
    G.addSeries(ax, { type: 'heatmap', z, x0, x1, y0, y1, colormap: cmap, cmin, cmax, showValues: isHeat, colLabels: isHeat && cells[0] ? cellStrings(cells[0]) : undefined, rowLabels: isHeat && cells[1] ? cellStrings(cells[1]) : undefined });
    ax.spec.y.reverse = ctx.name !== 'pcolor';
    ax.spec.box = true;
    if (isHeat) ax.spec.colorbar = { colormap: cmap, min: cmin, max: cmax };
    return ret(nargout, 0);
  });
  def(I, ['contour', 'contourf'], (a, nargout, ctx) => {
    const ax = G.plotTarget();
    const nums = a.filter((v) => !isStringLike(v));
    let X: number[][], Y: number[][], Z: number[][];
    let nlev = 10;
    let levels: number[] | null = null;
    if (nums.length >= 3) {
      const xt = toTensor(nums[0]), yt = toTensor(nums[1]);
      Z = gridOf(toTensor(nums[2]));
      X = xt.rows === 1 || xt.cols === 1 ? Z.map(() => Array.from(xt.re)) : gridOf(xt);
      Y = yt.rows === 1 || yt.cols === 1 ? Z.map((_, i) => Z[0].map(() => yt.re[i])) : gridOf(yt);
      if (nums[3]) {
        const l = toTensor(nums[3]);
        if (l.numel === 1) nlev = l.re[0];
        else levels = Array.from(l.re);
      }
    } else {
      Z = gridOf(toTensor(nums[0]));
      X = Z.map((r) => r.map((_, j) => j + 1));
      Y = Z.map((r, i) => r.map(() => i + 1));
      if (nums[1]) {
        const l = toTensor(nums[1]);
        if (l.numel === 1) nlev = l.re[0];
        else levels = Array.from(l.re);
      }
    }
    const vals = Z.flat().filter(Number.isFinite);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const lev = levels ?? Array.from({ length: nlev }, (_, k) => lo + ((hi - lo) * (k + 1)) / (nlev + 1));
    const cmap = ax.spec.colormap ?? 'parula';
    if (ctx.name === 'contourf') {
      const xs = X[0], ys = Y.map((r) => r[0]);
      G.addSeries(ax, { type: 'heatmap', z: Z.map((r) => r.map((v) => {
        let k = 0;
        while (k < lev.length && v >= lev[k]) k++;
        return k;
      })), x0: xs[0], x1: xs[xs.length - 1], y0: ys[0], y1: ys[ys.length - 1], colormap: cmap, cmin: 0, cmax: lev.length });
    }
    for (const [k, level] of lev.entries()) {
      for (const path of contourLines(X, Y, Z, level)) {
        G.addSeries(ax, { type: 'line', x: path.map((p) => p[0]), y: path.map((p) => p[1]), color: ctx.name === 'contourf' ? '#000000' : colormapColorLazy(cmap, lev.length > 1 ? k / (lev.length - 1) : 0.5), width: ctx.name === 'contourf' ? 0.5 : 1, dash: 'solid', marker: 'none', markerSize: 0 });
      }
    }
    return ret(nargout, 0);
  });
  def(I, ['surf', 'mesh', 'surfc', 'meshc', 'waterfall'], (a, nargout, ctx) => {
    const ax = G.plotTarget();
    const nums = a.filter((v) => !isStringLike(v));
    let X: number[][], Y: number[][], Z: number[][];
    if (nums.length >= 3) {
      const xt = toTensor(nums[0]), yt = toTensor(nums[1]);
      Z = gridOf(toTensor(nums[2]));
      X = xt.rows === 1 || xt.cols === 1 ? Z.map(() => Array.from(xt.re)) : gridOf(xt);
      Y = yt.rows === 1 || yt.cols === 1 ? Z.map((_, i) => Z[0].map(() => yt.re[i])) : gridOf(yt);
    } else {
      Z = gridOf(toTensor(nums[0]));
      X = Z.map((r) => r.map((_, j) => j + 1));
      Y = Z.map((r, i) => r.map(() => i + 1));
    }
    ax.spec.kind = '3d';
    ax.spec.view = ax.spec.view ?? [-37.5, 30];
    const mesh = ctx.name.startsWith('mesh') || ctx.name === 'waterfall';
    G.addSeries(ax, { type: 'surface', x: X, y: Y, z: Z, colormap: ax.spec.colormap ?? 'parula', mesh, edge: '#000000', faceAlpha: 1 });
    return ret(nargout, 0);
  });
  def(I, ['plot3', 'scatter3'], (a, nargout, ctx) => {
    const ax = G.plotTarget();
    const { pos, nv } = splitNameValue(a);
    const x = Array.from(toTensor(pos[0]).re), y = Array.from(toTensor(pos[1]).re), z = Array.from(toTensor(pos[2]).re);
    const spec = pos[3] && isLineSpec(pos[3]) ? parseLineSpec(toStringValue(pos[3])) : null;
    ax.spec.kind = '3d';
    ax.spec.view = ax.spec.view ?? [-37.5, 30];
    const sc = ctx.name === 'scatter3';
    const color = spec?.color ?? (nv.has('color') ? parseColor(nv.get('color')!) : G.nextColor(ax));
    return ret(nargout, G.addSeries(ax, { type: 'line3', x, y, z, color, width: nv.has('linewidth') ? toNumber(nv.get('linewidth')!) : 1, dash: sc ? 'none' : spec?.dash ?? (spec?.marker ? 'none' : 'solid'), marker: sc ? 'circle' : spec?.marker ?? 'none', markerSize: 6, scatter: sc }));
  });
  def(I, 'view', (a) => {
    const ax = G.gca();
    if (a.length === 1) {
      const v = toTensor(a[0]);
      ax.spec.view = v.numel >= 2 ? [v.re[0], v.re[1]] : v.re[0] === 2 ? [0, 90] : [-37.5, 30];
    } else ax.spec.view = [toNumber(a[0]), toNumber(a[1])];
    if (ax.spec.view[1] === 90 && ax.spec.view[0] === 0 && ax.spec.kind === '3d') ax.spec.kind = '3d';
  });
  def(I, ['xline', 'yline'], (a, nargout, ctx) => {
    const ax = G.gca();
    const vals = Array.from(toTensor(a[0]).re);
    const spec = a[1] && isLineSpec(a[1]) ? parseLineSpec(toStringValue(a[1])) : null;
    const label = a.find((v, i) => i >= 1 && isStringLike(v) && !isLineSpec(v) && !NV_PROPS.has(toStringValue(v).toLowerCase()));
    const { nv } = splitNameValue(a.slice(1));
    for (const v of vals) G.addSeries(ax, { type: ctx.name === 'xline' ? 'vline' : 'hline', value: v, color: spec?.color ?? (nv.has('color') ? parseColor(nv.get('color')!) : '#262626'), dash: spec?.dash ?? 'solid', width: nv.has('linewidth') ? toNumber(nv.get('linewidth')!) : 0.75, label: label ? toStringValue(label) : undefined });
    return ret(nargout, 0);
  });
  def(I, 'text', (a, nargout) => {
    const ax = G.gca();
    const { pos, nv } = splitNameValue(a);
    const xs = Array.from(toTensor(pos[0]).re), ys = Array.from(toTensor(pos[1]).re);
    const strs = pos[2].kind === 'cell' ? cellStrings(pos[2]) : [toStringValue(pos[pos.length > 3 && !isStringLike(pos[2]) ? 3 : 2])];
    xs.forEach((x, i) => G.addSeries(ax, { type: 'text', x, y: ys[i], text: strs[Math.min(i, strs.length - 1)], color: nv.has('color') ? parseColor(nv.get('color')!) : '#000000', size: nv.has('fontsize') ? toNumber(nv.get('fontsize')!) : 10, anchor: nv.has('horizontalalignment') ? ({ left: 'start', center: 'middle', right: 'end' } as any)[toStringValue(nv.get('horizontalalignment')!).toLowerCase()] ?? 'start' : 'start' }));
    return ret(nargout, 0);
  });
  def(I, 'title', (a) => {
    if (!a.length) return;
    G.gca().spec.title = titleText(a[0]);
  });
  def(I, ['sgtitle', 'suptitle'], (a) => {
    G.gcf().spec.title = titleText(a[0]);
  });
  def(I, 'xlabel', (a) => {
    G.gca().spec.x.label = titleText(a[0]);
  });
  def(I, 'ylabel', (a) => {
    G.gca().spec.y.label = titleText(a[0]);
  });
  def(I, 'zlabel', (a) => {
    const ax = G.gca();
    ax.spec.z = ax.spec.z ?? { scale: 'linear' };
    ax.spec.z.label = titleText(a[0]);
  });
  def(I, 'legend', (a) => {
    const ax = G.gca();
    const { pos, nv } = splitNameValue(a);
    if (pos.length === 1 && isStringLike(pos[0]) && ['off', 'hide'].includes(toStringValue(pos[0]).toLowerCase())) {
      ax.spec.legend.show = false;
      return;
    }
    if (pos.length === 1 && isStringLike(pos[0]) && ['show', 'on', 'boxoff', 'boxon'].includes(toStringValue(pos[0]).toLowerCase())) {
      ax.spec.legend.show = true;
      return;
    }
    const labels = pos.flatMap((v) => (v.kind === 'cell' || v.kind === 'string' ? cellStrings(v) : isStringLike(v) ? [toStringValue(v)] : []));
    const labelable = ax.spec.series.filter((s) => ['line', 'scatter', 'bar', 'area', 'stem', 'polygon', 'line3', 'box', 'violin'].includes(s.type));
    labels.forEach((l, i) => {
      if (labelable[i]) (labelable[i] as any).label = l;
    });
    ax.spec.legend.show = true;
    if (nv.has('location')) ax.spec.legend.location = toStringValue(nv.get('location')!).toLowerCase().replace('outside', '') as any;
  });
  def(I, 'grid', (a) => {
    const ax = G.gca();
    const on = !a.length ? !ax.spec.x.grid : ['on', 'minor'].includes(toStringValue(a[0]).toLowerCase());
    ax.spec.x.grid = on;
    ax.spec.y.grid = on;
    if (ax.spec.z) ax.spec.z.grid = on;
  });
  def(I, 'box', (a) => {
    const ax = G.gca();
    ax.spec.box = !a.length ? !ax.spec.box : toStringValue(a[0]).toLowerCase() === 'on';
  });
  def(I, 'axis', (a, nargout) => {
    const ax = G.gca();
    if (!a.length) return rowVec([ax.spec.x.min ?? NaN, ax.spec.x.max ?? NaN, ax.spec.y.min ?? NaN, ax.spec.y.max ?? NaN]);
    for (const v of a) {
      if (isStringLike(v)) {
        const s = toStringValue(v).toLowerCase();
        if (s === 'equal' || s === 'image' || s === 'square') ax.spec.equal = true;
        else if (s === 'normal') ax.spec.equal = false;
        else if (s === 'off') {
          ax.spec.x.hidden = true;
          ax.spec.y.hidden = true;
        } else if (s === 'on') {
          ax.spec.x.hidden = false;
          ax.spec.y.hidden = false;
        } else if (s === 'auto') {
          ax.spec.x.min = ax.spec.x.max = ax.spec.y.min = ax.spec.y.max = undefined;
        } else if (s === 'tight') (ax.spec as any).tight = true;
        else if (s === 'ij') ax.spec.y.reverse = true;
        else if (s === 'xy') ax.spec.y.reverse = false;
      } else {
        const t = toTensor(v);
        [ax.spec.x.min, ax.spec.x.max, ax.spec.y.min, ax.spec.y.max] = [t.re[0], t.re[1], t.re[2], t.re[3]];
        if (t.numel >= 6) {
          ax.spec.z = ax.spec.z ?? { scale: 'linear' };
          ax.spec.z.min = t.re[4];
          ax.spec.z.max = t.re[5];
        }
      }
    }
    void nargout;
  });
  for (const [name, key] of [['xlim', 'x'], ['ylim', 'y'], ['zlim', 'z']] as const) {
    def(I, name, (a) => {
      const ax = G.gca();
      if (key === 'z') ax.spec.z = ax.spec.z ?? { scale: 'linear' };
      const axis = ax.spec[key]!;
      if (!a.length) return rowVec([axis.min ?? NaN, axis.max ?? NaN]);
      if (isStringLike(a[0])) {
        axis.min = axis.max = undefined;
        return;
      }
      const t = toTensor(a[0]);
      axis.min = Number.isFinite(t.re[0]) ? t.re[0] : undefined;
      axis.max = Number.isFinite(t.re[1]) ? t.re[1] : undefined;
    });
  }
  for (const [name, key] of [['xticks', 'x'], ['yticks', 'y']] as const) {
    def(I, name, (a) => {
      const ax = G.gca();
      if (!a.length) return rowVec(ax.spec[key].ticks ?? []);
      ax.spec[key].ticks = Array.from(toTensor(a[0]).re);
    });
  }
  for (const [name, key] of [['xticklabels', 'x'], ['yticklabels', 'y']] as const) {
    def(I, name, (a) => {
      G.gca().spec[key].tickLabels = cellStrings(a[0]);
    });
  }
  def(I, 'xtickangle', (a) => {
    G.gca().spec.x.rotateLabels = toNumber(a[0]) !== 0;
  });
  def(I, 'colormap', (a) => {
    if (!a.length) return str(G.gca().spec.colormap ?? 'parula');
    const name = isStringLike(a[0]) ? toStringValue(a[0]).toLowerCase() : 'parula';
    const f = G.gcf();
    for (const ax of f.axes) {
      ax.spec.colormap = name;
      for (const s of ax.spec.series) if ('colormap' in s) (s as any).colormap = name;
      if (ax.spec.colorbar) ax.spec.colorbar.colormap = name;
    }
  });
  def(I, 'colorbar', (a) => {
    const ax = G.gca();
    if (a.length && isStringLike(a[0]) && toStringValue(a[0]) === 'off') {
      ax.spec.colorbar = undefined;
      return;
    }
    const hm = ax.spec.series.find((s) => s.type === 'heatmap' || s.type === 'surface') as any;
    let lo = 0, hi = 1;
    if (hm?.type === 'heatmap') {
      lo = hm.cmin;
      hi = hm.cmax;
    } else if (hm?.type === 'surface') {
      const v = hm.z.flat().filter(Number.isFinite);
      lo = Math.min(...v);
      hi = Math.max(...v);
    } else if (ax.spec.clim) [lo, hi] = ax.spec.clim;
    ax.spec.colorbar = { colormap: ax.spec.colormap ?? 'parula', min: lo, max: hi };
  });
  def(I, ['caxis', 'clim'], (a) => {
    const ax = G.gca();
    if (!a.length) return rowVec(ax.spec.clim ?? [0, 1]);
    const t = toTensor(a[0]);
    ax.spec.clim = [t.re[0], t.re[1]];
    for (const s of ax.spec.series) if (s.type === 'heatmap') {
      s.cmin = t.re[0];
      s.cmax = t.re[1];
    }
    if (ax.spec.colorbar) {
      ax.spec.colorbar.min = t.re[0];
      ax.spec.colorbar.max = t.re[1];
    }
  });
  def(I, ['shading', 'lighting', 'material', 'camlight', 'rotate3d', 'zoom', 'pan', 'datacursormode', 'alpha'], () => []);
  def(I, 'set', (a) => {
    minArgs(a, 1);
    const hs = Array.from(toTensor(a[0]).re);
    for (const h of hs) {
      const obj = G.handles.get(h) ?? (G.figures.has(h) ? { type: 'figure' as const } : undefined);
      for (let i = 1; i + 1 < a.length; i += 2) {
        const k = toStringValue(a[i]).toLowerCase();
        const v = a[i + 1];
        if (!obj) continue;
        if (obj.type === 'axes') {
          const ax = G.figures.get((obj as any).fig)!.axes[(obj as any).ax].spec;
          if (k === 'xscale') ax.x.scale = toStringValue(v) === 'log' ? 'log' : 'linear';
          else if (k === 'yscale') ax.y.scale = toStringValue(v) === 'log' ? 'log' : 'linear';
          else if (k === 'xlim') [ax.x.min, ax.x.max] = Array.from(toTensor(v).re);
          else if (k === 'ylim') [ax.y.min, ax.y.max] = Array.from(toTensor(v).re);
          else if (k === 'xtick') ax.x.ticks = Array.from(toTensor(v).re);
          else if (k === 'ytick') ax.y.ticks = Array.from(toTensor(v).re);
          else if (k === 'xticklabel') ax.x.tickLabels = cellStrings(v);
          else if (k === 'yticklabel') ax.y.tickLabels = cellStrings(v);
          else if (k === 'xgrid') ax.x.grid = toStringValue(v) === 'on';
          else if (k === 'ygrid') ax.y.grid = toStringValue(v) === 'on';
          else if (k === 'box') ax.box = toStringValue(v) === 'on';
          else if (k === 'ydir') ax.y.reverse = toStringValue(v) === 'reverse';
          else if (k === 'xdir') ax.x.reverse = toStringValue(v) === 'reverse';
          else if (k === 'fontsize') G.gcf().spec.fontSize = toNumber(v);
        } else if (obj.type === 'series' && obj.series) {
          const s: any = obj.series;
          if (k === 'color') s.color = parseColor(v);
          else if (k === 'linewidth') s.width = toNumber(v);
          else if (k === 'linestyle') s.dash = toStringValue(v) === 'none' ? 'none' : parseLineSpec(toStringValue(v))?.dash ?? 'solid';
          else if (k === 'marker') s.marker = MARKERS[toStringValue(v)] ?? MARKER_NAMES[toStringValue(v).toLowerCase()] ?? 'none';
          else if (k === 'markersize') s.markerSize = toNumber(v);
          else if (k === 'markerfacecolor') s.markerFill = parseColor(v);
          else if (k === 'displayname') s.label = toStringValue(v);
          else if (k === 'facecolor') s.fill = parseColor(v);
          else if (k === 'xdata') s.x = Array.from(toTensor(v).re);
          else if (k === 'ydata') s.y = Array.from(toTensor(v).re);
        } else if (obj.type === 'figure') {
          const f = G.figures.get(h)!;
          if (k === 'name') f.name = toStringValue(v);
          if (k === 'color') f.spec.background = parseColor(v);
          if (k === 'position') {
            const p = toTensor(v);
            f.spec.width = p.re[2];
            f.spec.height = p.re[3];
          }
        }
      }
    }
    G.changed = true;
  });
  def(I, 'get', (a) => {
    const h = toNumber(a[0]);
    const k = a.length > 1 ? toStringValue(a[1]).toLowerCase() : '';
    const obj = G.handles.get(h);
    if (obj?.type === 'axes') {
      const ax = G.figures.get(obj.fig)!.axes[obj.ax].spec;
      if (k === 'xlim') return rowVec([ax.x.min ?? NaN, ax.x.max ?? NaN]);
      if (k === 'ylim') return rowVec([ax.y.min ?? NaN, ax.y.max ?? NaN]);
      if (k === 'xscale') return str(ax.x.scale);
      if (k === 'yscale') return str(ax.y.scale);
      if (k === 'children') return rowVec([...G.handles.entries()].filter(([, v]) => v.type === 'series' && v.fig === obj.fig && v.ax === obj.ax).map(([hh]) => hh));
    }
    if (obj?.type === 'series' && obj.series) {
      const s: any = obj.series;
      if (k === 'xdata') return rowVec(s.x ?? []);
      if (k === 'ydata') return rowVec(s.y ?? []);
      if (k === 'color') return str(s.color ?? '');
    }
    return zeros(0, 0);
  });
  def(I, 'ishandle', (a) => bool(G.handles.has(toNumber(a[0])) || G.figures.has(toNumber(a[0]))));
  def(I, 'isgraphics', (a) => bool(G.handles.has(toNumber(a[0])) || G.figures.has(toNumber(a[0]))));
  def(I, 'findobj', () => zeros(0, 0));
  def(I, 'linkaxes', () => []);
  def(I, ['saveas', 'exportgraphics', 'print'], (a, _n, ctx) => {
    const save = ctx.interp.builtins.get('__savefigure__');
    if (!save) {
      ctx.interp.warn('Saving figures from code is not available here. Use the Export button on the figure.');
      return;
    }
    save(a, 0, ctx);
  });
  void CellArray;
}

function titleText(v: Value): string {
  if (v.kind === 'cell' || v.kind === 'string') return cellStrings(v).join('\n');
  return toStringValue(v);
}

function colormapColorLazy(name: string, t: number) {
  return colormapColor(name, t);
}

export type { CallContext };
