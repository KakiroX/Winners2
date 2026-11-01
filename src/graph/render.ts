// Pure SVG renderer for FigureSpec (no DOM required: runs in workers, Node tests and exports).
import { colormapColor, colormapStops, type AxesSpec, type AxisSpec, type Dash, type FigureSpec, type Marker, type SeriesSpec } from './spec';

interface Theme {
  axisColor: string;
  axisWidth: number;
  tickLen: number;
  tickDir: 'out' | 'in';
  gridColor: string;
  textColor: string;
  titleWeight: string;
  labelWeight: string;
  tickFontScale: number;
  labelFontScale: number;
  titleFontScale: number;
  box: boolean | null;
  background: string;
  plotBackground: string;
}

function themeFor(style: FigureSpec['style']): Theme {
  switch (style) {
    case 'prism':
      return { axisColor: '#000000', axisWidth: 1.5, tickLen: 6, tickDir: 'out', gridColor: '#d9d9d9', textColor: '#000000', titleWeight: 'bold', labelWeight: 'bold', tickFontScale: 1, labelFontScale: 1.08, titleFontScale: 1.25, box: null, background: '#ffffff', plotBackground: 'none' };
    case 'dark':
      return { axisColor: '#d0d4dc', axisWidth: 1.2, tickLen: 5, tickDir: 'out', gridColor: '#3a3f4b', textColor: '#e6e8ee', titleWeight: 'bold', labelWeight: '600', tickFontScale: 0.95, labelFontScale: 1.05, titleFontScale: 1.2, box: null, background: '#1e2128', plotBackground: 'none' };
    case 'minimal':
      return { axisColor: '#666666', axisWidth: 0.8, tickLen: 4, tickDir: 'out', gridColor: '#e6e6e6', textColor: '#333333', titleWeight: '600', labelWeight: 'normal', tickFontScale: 0.92, labelFontScale: 1, titleFontScale: 1.15, box: false, background: '#ffffff', plotBackground: 'none' };
    default:
      return { axisColor: '#262626', axisWidth: 0.6, tickLen: 5, tickDir: 'in', gridColor: '#dfdfdf', textColor: '#262626', titleWeight: 'bold', labelWeight: 'normal', tickFontScale: 0.9, labelFontScale: 1, titleFontScale: 1.1, box: null, background: '#ffffff', plotBackground: '#ffffff' };
  }
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const f2 = (v: number) => (Math.round(v * 100) / 100).toString();

// ---------------- Ticks ----------------
export function niceNum(range: number, round: boolean): number {
  const exp = Math.floor(Math.log10(range));
  const f = range / Math.pow(10, exp);
  let nf: number;
  if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * Math.pow(10, exp);
}

export function niceTicks(lo: number, hi: number, maxTicks = 6): { min: number; max: number; step: number; ticks: number[] } {
  if (!(hi > lo)) {
    const d = lo === 0 ? 1 : Math.abs(lo) * 0.1;
    lo -= d;
    hi += d;
  }
  const range = niceNum(hi - lo, false);
  const step = niceNum(range / (maxTicks - 1), true);
  const min = Math.floor(lo / step + 1e-9) * step;
  const max = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step * 1e-6; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return { min, max, step, ticks };
}

let trimZeros = false;

function fmtTick(v: number, step: number, format: AxisSpec['format'] = 'auto'): string {
  const r = fmtTickRaw(v, step, format);
  return trimZeros && r.includes('.') && !r.includes('e') ? r.replace(/\.?0+$/, '') : r;
}

function fmtTickRaw(v: number, step: number, format: AxisSpec['format'] = 'auto'): string {
  if (format === 'percent') return `${f2(v)}%`;
  if (format === 'scientific') return v === 0 ? '0' : v.toExponential(1);
  const a = Math.abs(v);
  if (v !== 0 && (a >= 1e6 || a < 1e-4)) return v.toExponential(Math.max(0, Math.min(3, -Math.floor(Math.log10(step / a)))));
  const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return v.toFixed(Math.min(dec, 10));
}

interface Scale {
  (v: number): number;
  ticks: number[];
  labels: string[];
  lo: number;
  hi: number;
  log: boolean;
  minor: number[];
}

function makeScale(axis: AxisSpec, dataLo: number, dataHi: number, p0: number, p1: number, opts: { padFrac?: number; categories?: number; tight?: boolean; forceZero?: boolean } = {}): Scale {
  const log = axis.scale === 'log';
  let lo = axis.min ?? dataLo, hi = axis.max ?? dataHi;
  let ticks: number[] = [];
  const minor: number[] = [];
  let labels: string[] = [];
  if (opts.categories) {
    lo = axis.min ?? 0.5;
    hi = axis.max ?? opts.categories + 0.5;
    ticks = Array.from({ length: opts.categories }, (_, i) => i + 1);
    labels = axis.categories ?? ticks.map(String);
  } else if (log) {
    if (!(lo > 0)) lo = hi > 0 ? hi / 1000 : 1;
    if (!(hi > 0)) hi = 10;
    if (axis.min === undefined) lo = Math.pow(10, Math.floor(Math.log10(lo) + 1e-9));
    if (axis.max === undefined) hi = Math.pow(10, Math.ceil(Math.log10(hi) - 1e-9));
    if (hi <= lo) hi = lo * 10;
    const e0 = Math.floor(Math.log10(lo) + 1e-9), e1 = Math.ceil(Math.log10(hi) - 1e-9);
    const stepE = Math.max(1, Math.ceil((e1 - e0) / 8));
    for (let e = e0; e <= e1; e += stepE) {
      const v = Math.pow(10, e);
      if (v >= lo * 0.999 && v <= hi * 1.001) ticks.push(v);
      if (stepE === 1) for (let m = 2; m < 10; m++) {
        const mv = m * v;
        if (mv > lo && mv < hi) minor.push(mv);
      }
    }
    labels = ticks.map((v) => {
      const e = Math.round(Math.log10(v));
      return axis.format === 'decimal' ? (e >= 0 ? String(v) : v.toFixed(-e)) : `10^${e}`;
    });
  } else {
    if (axis.min === undefined && axis.max === undefined && !opts.tight) {
      const nt = niceTicks(opts.forceZero ? Math.min(0, lo) : lo, opts.forceZero ? Math.max(0, hi) : hi, Math.max(3, Math.round(Math.abs(p1 - p0) / 55)));
      lo = nt.min;
      hi = nt.max;
      ticks = nt.ticks;
    } else {
      if (!(hi > lo)) {
        hi = lo + 1;
      }
      const nt = niceTicks(lo, hi, Math.max(3, Math.round(Math.abs(p1 - p0) / 55)));
      ticks = nt.ticks.filter((v) => v >= lo - 1e-9 * Math.abs(hi - lo) && v <= hi + 1e-9 * Math.abs(hi - lo));
    }
    const step = ticks.length > 1 ? ticks[1] - ticks[0] : 1;
    labels = ticks.map((v) => fmtTick(v, step, axis.format));
  }
  if (axis.ticks && !opts.categories) {
    ticks = axis.ticks.filter((v) => v >= Math.min(lo, hi) && v <= Math.max(lo, hi));
    const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1;
    labels = ticks.map((v) => (log ? `10^${Math.round(Math.log10(v))}` : fmtTick(v, step, axis.format)));
  }
  if (axis.tickLabels) labels = ticks.map((_, i) => axis.tickLabels![i] ?? '');
  const tf = (v: number) => (log ? Math.log10(v) : v);
  const a = tf(lo), b = tf(hi);
  const [q0, q1] = axis.reverse ? [p1, p0] : [p0, p1];
  const s = ((v: number) => q0 + ((tf(v) - a) / (b - a || 1)) * (q1 - q0)) as Scale;
  s.ticks = ticks;
  s.labels = labels;
  s.lo = lo;
  s.hi = hi;
  s.log = log;
  s.minor = minor;
  return s;
}

// ---------------- Primitives ----------------
function dashArray(d: Dash, w: number): string {
  switch (d) {
    case 'dash': return `${f2(6 * Math.max(1, w / 1.5))},${f2(4 * Math.max(1, w / 1.5))}`;
    case 'dot': return `${f2(Math.max(1, w))},${f2(3 * Math.max(1, w / 1.5))}`;
    case 'dashdot': return `${f2(7 * Math.max(1, w / 1.5))},${f2(3)},${f2(Math.max(1, w))},${f2(3)}`;
    default: return '';
  }
}

export function markerPath(m: Marker, x: number, y: number, s: number): string {
  const r = s / 2;
  switch (m) {
    case 'circle': return `M${f2(x - r)},${f2(y)}a${f2(r)},${f2(r)} 0 1,0 ${f2(2 * r)},0a${f2(r)},${f2(r)} 0 1,0 ${f2(-2 * r)},0Z`;
    case 'point': return `M${f2(x - r / 3)},${f2(y)}a${f2(r / 3)},${f2(r / 3)} 0 1,0 ${f2((2 * r) / 3)},0a${f2(r / 3)},${f2(r / 3)} 0 1,0 ${f2((-2 * r) / 3)},0Z`;
    case 'square': return `M${f2(x - r * 0.88)},${f2(y - r * 0.88)}h${f2(r * 1.76)}v${f2(r * 1.76)}h${f2(-r * 1.76)}Z`;
    case 'diamond': return `M${f2(x)},${f2(y - r * 1.2)}L${f2(x + r)},${f2(y)}L${f2(x)},${f2(y + r * 1.2)}L${f2(x - r)},${f2(y)}Z`;
    case 'triangle': return `M${f2(x)},${f2(y - r * 1.1)}L${f2(x + r)},${f2(y + r * 0.8)}L${f2(x - r)},${f2(y + r * 0.8)}Z`;
    case 'triangleDown': return `M${f2(x)},${f2(y + r * 1.1)}L${f2(x + r)},${f2(y - r * 0.8)}L${f2(x - r)},${f2(y - r * 0.8)}Z`;
    case 'triangleLeft': return `M${f2(x - r * 1.1)},${f2(y)}L${f2(x + r * 0.8)},${f2(y - r)}L${f2(x + r * 0.8)},${f2(y + r)}Z`;
    case 'triangleRight': return `M${f2(x + r * 1.1)},${f2(y)}L${f2(x - r * 0.8)},${f2(y - r)}L${f2(x - r * 0.8)},${f2(y + r)}Z`;
    case 'cross': return `M${f2(x - r)},${f2(y - r)}L${f2(x + r)},${f2(y + r)}M${f2(x - r)},${f2(y + r)}L${f2(x + r)},${f2(y - r)}`;
    case 'plus': return `M${f2(x - r)},${f2(y)}L${f2(x + r)},${f2(y)}M${f2(x)},${f2(y - r)}L${f2(x)},${f2(y + r)}`;
    case 'bar': return `M${f2(x)},${f2(y - r)}L${f2(x)},${f2(y + r)}`;
    case 'star': return `${markerPath('plus', x, y, s)}${markerPath('cross', x, y, s * 0.8)}`;
    case 'pentagram':
    case 'hexagram': {
      const pts = m === 'pentagram' ? 5 : 6;
      let d = '';
      for (let k = 0; k < pts * 2; k++) {
        const ang = (Math.PI * k) / pts - Math.PI / 2;
        const rr = k % 2 ? r * 0.45 : r * 1.15;
        d += `${k ? 'L' : 'M'}${f2(x + rr * Math.cos(ang))},${f2(y + rr * Math.sin(ang))}`;
      }
      return d + 'Z';
    }
    default: return '';
  }
}

function isOpenMarker(m: Marker) {
  return m === 'cross' || m === 'plus' || m === 'star' || m === 'bar';
}

function markerSvg(m: Marker, x: number, y: number, size: number, stroke: string, fill: string, sw = 1, opacity?: number): string {
  if (m === 'none') return '';
  const d = markerPath(m, x, y, size);
  const op = opacity !== undefined && opacity < 1 ? ` fill-opacity="${opacity}"` : '';
  if (isOpenMarker(m)) return `<path d="${d}" stroke="${stroke}" stroke-width="${f2(sw)}" fill="none"/>`;
  return `<path d="${d}" stroke="${stroke}" stroke-width="${f2(sw)}" fill="${fill}"${op}/>`;
}

function textSvg(x: number, y: number, s: string, opts: { size: number; anchor?: string; baseline?: string; weight?: string; color: string; rotate?: number; family: string; italic?: boolean }): string {
  const rot = opts.rotate ? ` transform="rotate(${opts.rotate} ${f2(x)} ${f2(y)})"` : '';
  const lines = s.split('\n');
  const content = lines.length > 1
    ? lines.map((l, i) => `<tspan x="${f2(x)}" dy="${i === 0 ? f2(-((lines.length - 1) * opts.size * 1.15) / 2) : f2(opts.size * 1.15)}">${richText(l, opts.size)}</tspan>`).join('')
    : richText(s, opts.size);
  return `<text x="${f2(x)}" y="${f2(y)}" font-family="${esc(opts.family)}" font-size="${f2(opts.size)}" fill="${opts.color}" text-anchor="${opts.anchor ?? 'middle'}" dominant-baseline="${opts.baseline ?? 'auto'}"${opts.weight && opts.weight !== 'normal' ? ` font-weight="${opts.weight}"` : ''}${opts.italic ? ' font-style="italic"' : ''}${rot}>${content}</text>`;
}

/** Supports ^{...}/_{...} (TeX-like) and 10^n exponents in labels. */
function richText(s: string, size: number): string {
  const parts: string[] = [];
  const re = /(\^\{[^}]*\}|_\{[^}]*\}|\^-?[0-9]+|\\[a-zA-Z]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const greek: Record<string, string> = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ', epsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', Sigma: 'Σ', tau: 'τ', phi: 'φ', omega: 'ω', Omega: 'Ω', pm: '±', times: '×', circ: '°', deg: '°', infty: '∞', leq: '≤', geq: '≥', approx: '≈' };
  while ((m = re.exec(s))) {
    parts.push(esc(s.slice(last, m.index)));
    const tok = m[0];
    if (tok.startsWith('\\')) parts.push(esc(greek[tok.slice(1)] ?? tok));
    else {
      const sup = tok[0] === '^';
      const inner = tok[1] === '{' ? tok.slice(2, -1) : tok.slice(1);
      parts.push(`<tspan baseline-shift="${sup ? 'super' : 'sub'}" font-size="${f2(size * 0.72)}">${esc(inner)}</tspan>`);
    }
    last = m.index + tok.length;
  }
  parts.push(esc(s.slice(last)));
  return parts.join('');
}

function approxTextWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s.replace(/\^\{|\}|_\{/g, '')) w += /[il.,:;|'!]/.test(ch) ? 0.28 : /[mwMW]/.test(ch) ? 0.85 : /[A-Z0-9]/.test(ch) ? 0.62 : 0.52;
  return w * size;
}

// ---------------- Data extents ----------------
function extents(ax: AxesSpec) {
  let xlo = Infinity, xhi = -Infinity, ylo = Infinity, yhi = -Infinity;
  const ax_ = (v: number) => {
    if (Number.isFinite(v) && !(ax.x.scale === 'log' && v <= 0)) {
      xlo = Math.min(xlo, v);
      xhi = Math.max(xhi, v);
    }
  };
  const ay = (v: number) => {
    if (Number.isFinite(v) && !(ax.y.scale === 'log' && v <= 0)) {
      ylo = Math.min(ylo, v);
      yhi = Math.max(yhi, v);
    }
  };
  let hasBar = false;
  for (const s of ax.series) {
    switch (s.type) {
      case 'line':
      case 'scatter':
        s.x.forEach(ax_);
        s.y.forEach(ay);
        break;
      case 'bar':
        hasBar = true;
        s.x.forEach((v) => {
          if (s.horizontal) ay(v - s.width / 2), ay(v + s.width / 2);
          else ax_(v - s.width / 2), ax_(v + s.width / 2);
        });
        s.y.forEach((v) => (s.horizontal ? ax_(v) : ay(v)));
        (s.base ?? []).forEach((v) => (s.horizontal ? ax_(v) : ay(v)));
        if (!s.base) s.horizontal ? ax_(0) : ay(0);
        break;
      case 'errorbar':
        s.x.forEach(ax_);
        s.lo.forEach(ay);
        s.hi.forEach(ay);
        break;
      case 'box':
        ax_(s.x - s.width / 2);
        ax_(s.x + s.width / 2);
        ay(s.lo);
        ay(s.hi);
        s.outliers.forEach(ay);
        break;
      case 'violin':
        ax_(s.x - s.width / 2);
        ax_(s.x + s.width / 2);
        s.density.forEach((d) => ay(d.y));
        break;
      case 'area':
        s.x.forEach(ax_);
        s.y.forEach(ay);
        (s.y0 ?? [0]).forEach(ay);
        break;
      case 'band':
        s.x.forEach(ax_);
        s.lo.forEach(ay);
        s.hi.forEach(ay);
        break;
      case 'polygon':
        s.x.forEach(ax_);
        s.y.forEach(ay);
        break;
      case 'stem':
        s.x.forEach(ax_);
        s.y.forEach(ay);
        ay(s.base);
        break;
      case 'hline':
        ay(s.value);
        break;
      case 'vline':
        ax_(s.value);
        break;
      case 'heatmap': {
        const nx = s.z[0]?.length ?? 1, ny = s.z.length;
        const dx = nx > 1 ? (s.x1 - s.x0) / (nx - 1) : 1, dy = ny > 1 ? (s.y1 - s.y0) / (ny - 1) : 1;
        ax_(s.x0 - dx / 2);
        ax_(s.x1 + dx / 2);
        ay(s.y0 - dy / 2);
        ay(s.y1 + dy / 2);
        break;
      }
      case 'text':
        ax_(s.x);
        ay(s.y);
        break;
      case 'bracket':
        ay(s.y);
        break;
    }
  }
  return { xlo, xhi, ylo, yhi, hasBar };
}

// ---------------- Main renderer ----------------
export interface RenderOptions {
  /** emit data-* attributes for interactive selection */
  interactive?: boolean;
  scale?: number;
  transparent?: boolean;
}

let renderSeq = 0;
let idp = 'q';

export function renderFigure(fig: FigureSpec, opts: RenderOptions = {}): string {
  idp = 'q' + (++renderSeq).toString(36) + Math.random().toString(36).slice(2, 6);
  trimZeros = fig.style === 'matlab';
  const W = fig.width, H = fig.height;
  const th = themeFor(fig.style);
  const bg = fig.background && fig.style !== 'dark' ? fig.background : th.background;
  const fs = fig.fontSize;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${esc(fig.fontFamily)}">`);
  if (!opts.transparent) out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`);
  let top = 0;
  if (fig.title) {
    out.push(textSvg(W / 2, fs * 1.6, fig.title, { size: fs * 1.3, weight: 'bold', color: th.textColor, family: fig.fontFamily }));
    top = fs * 2.4;
  }
  const rows = Math.max(1, fig.rows), cols = Math.max(1, fig.cols);
  const cw = W / cols, ch = (H - top) / rows;
  fig.axes.forEach((ax, ai) => {
    const x0 = ax.col * cw, y0 = top + ax.row * ch;
    const w = cw * (ax.colSpan ?? 1), h = ch * (ax.rowSpan ?? 1);
    out.push(`<g${opts.interactive ? ` data-axes="${ai}"` : ''}>`);
    if (ax.kind === 'pie') out.push(renderPie(ax, x0, y0, w, h, fig, th));
    else if (ax.kind === '3d') out.push(render3D(ax, x0, y0, w, h, fig, th, ai));
    else out.push(renderAxes(ax, x0, y0, w, h, fig, th, ai, opts));
    out.push('</g>');
  });
  out.push('</svg>');
  return out.join('');
}

function legendEntries(ax: AxesSpec) {
  if (ax.legend.entries) return ax.legend.entries;
  const ents: { label: string; color: string; marker: Marker; dash: Dash; kind: 'line' | 'patch' | 'marker'; fill?: string }[] = [];
  for (const s of ax.series) {
    const lab = (s as any).label as string | undefined;
    if (!lab) continue;
    if (ents.some((e) => e.label === lab)) continue;
    switch (s.type) {
      case 'line': ents.push({ label: lab, color: s.color, marker: s.marker, dash: s.dash, kind: 'line', fill: s.markerFill }); break;
      case 'scatter': ents.push({ label: lab, color: s.color, marker: s.marker, dash: 'none', kind: 'marker', fill: s.fill === 'none' ? 'none' : s.fill === 'auto' ? s.color : s.fill }); break;
      case 'bar': ents.push({ label: lab, color: s.edge, marker: 'square', dash: 'none', kind: 'patch', fill: s.fill }); break;
      case 'area':
      case 'polygon': ents.push({ label: lab, color: s.color, marker: 'square', dash: 'none', kind: 'patch', fill: s.color }); break;
      case 'stem': ents.push({ label: lab, color: s.color, marker: s.marker, dash: 'solid', kind: 'line' }); break;
      case 'box':
      case 'violin': ents.push({ label: lab, color: s.color, marker: 'square', dash: 'none', kind: 'patch', fill: s.fill }); break;
    }
  }
  return ents;
}

function renderAxes(ax: AxesSpec, X0: number, Y0: number, W: number, H: number, fig: FigureSpec, th: Theme, ai: number, opts: RenderOptions): string {
  const out: string[] = [];
  const fs = fig.fontSize;
  const tickFs = fs * th.tickFontScale, labFs = fs * th.labelFontScale, titFs = fs * th.titleFontScale;
  const ents = ax.legend.show ? legendEntries(ax) : [];
  const legendRight = ents.length > 0 && (ax.legend.location === 'right' || (fig.style === 'prism' && ax.legend.location !== 'inside' && ax.legend.location !== 'top'));
  const legendTop = ents.length > 0 && ax.legend.location === 'top';
  const legendW = legendRight ? Math.min(W * 0.4, Math.max(...ents.map((e) => approxTextWidth(e.label, tickFs))) + 40) : 0;
  const isCat = !!ax.x.categories?.length;
  const e = extents(ax);
  // Provisional y scale to measure tick label width
  const padY = (lo: number, hi: number) => {
    if (fig.style === 'prism' || ax.y.scale === 'log') return [lo, hi];
    return [lo, hi];
  };
  const [plo, phi] = padY(e.ylo === Infinity ? 0 : e.ylo, e.yhi === -Infinity ? 1 : e.yhi);
  const ysProbe = makeScale(ax.y, plo, phi, 100, 0, { forceZero: e.hasBar && ax.y.scale !== 'log', tight: (ax as any).tight });
  const yLabelW = ax.y.hidden ? 0 : Math.max(...ysProbe.labels.map((l) => approxTextWidth(l.replace(/^10\^/, '10'), tickFs)), 10);
  const catLabels = isCat ? ax.x.categories! : [];
  const perCat = (W - yLabelW - 40 - th.tickLen - (ax.y.label ? labFs * 1.7 : 0) - legendW - (ax.colorbar ? 60 : 0)) / Math.max(1, catLabels.length);
  const rotate = ax.x.rotateLabels || (isCat && catLabels.length > 0 && Math.max(...catLabels.map((l) => approxTextWidth(l, tickFs))) * 0.92 > perCat);
  const xLabelH = ax.x.hidden ? 0 : rotate ? Math.min(H * 0.35, Math.max(...catLabels.map((l) => approxTextWidth(l, tickFs))) * 0.75 + tickFs) : tickFs * 1.4;
  const mLeft = 12 + yLabelW + th.tickLen + (ax.y.label ? labFs * 1.7 : 0) + 4;
  const mRight = 14 + legendW + (ax.colorbar ? 60 : 0);
  const mTop = 10 + (ax.title ? titFs * 1.7 : 0) + (legendTop ? tickFs * 1.8 : 0);
  const mBottom = 10 + xLabelH + th.tickLen + (ax.x.label ? labFs * 1.7 : 0) + 4;
  let px0 = X0 + mLeft, px1 = X0 + W - mRight, py0 = Y0 + mTop, py1 = Y0 + H - mBottom;
  if (px1 - px0 < 30) px1 = px0 + 30;
  if (py1 - py0 < 30) py1 = py0 + 30;
  // Equal aspect ratio
  let xlo = e.xlo === Infinity ? 0 : e.xlo, xhi = e.xhi === -Infinity ? 1 : e.xhi;
  if (fig.style === 'matlab' && !isCat && ax.x.min === undefined && ax.x.max === undefined && ax.series.some((s) => s.type === 'line') && !ax.series.some((s) => s.type === 'bar' || s.type === 'scatter')) {
    // MATLAB uses tight x limits for line plots
    (ax.x as any)._tight = true;
  }
  const tightX = (ax.x as any)._tight || (ax as any).tight || ax.series.some((s) => s.type === 'heatmap');
  const tightY = (ax as any).tight || ax.series.some((s) => s.type === 'heatmap');
  let xs = makeScale(ax.x, xlo, xhi, px0, px1, { categories: isCat ? catLabels.length : undefined, tight: tightX && !isCat });
  let ys = makeScale(ax.y, plo, phi, py1, py0, { forceZero: e.hasBar && ax.y.scale !== 'log', tight: tightY });
  if (tightX && !isCat && ax.x.min === undefined && ax.x.max === undefined) {
    xs = makeScale({ ...ax.x, min: xlo, max: xhi === xlo ? xlo + 1 : xhi }, xlo, xhi, px0, px1, {});
  }
  if (tightY && ax.y.min === undefined && ax.y.max === undefined) ys = makeScale({ ...ax.y, min: plo, max: phi === plo ? plo + 1 : phi }, plo, phi, py1, py0, {});
  if (ax.equal) {
    const sx = (px1 - px0) / (xs.hi - xs.lo), sy = (py1 - py0) / (ys.hi - ys.lo);
    if (sx > sy) {
      const nw = (xs.hi - xs.lo) * sy;
      const c = (px0 + px1) / 2;
      px0 = c - nw / 2;
      px1 = c + nw / 2;
    } else {
      const nh = (ys.hi - ys.lo) * sx;
      const c = (py0 + py1) / 2;
      py0 = c - nh / 2;
      py1 = c + nh / 2;
    }
    xs = makeScale({ ...ax.x, min: xs.lo, max: xs.hi }, xs.lo, xs.hi, px0, px1, {});
    ys = makeScale({ ...ax.y, min: ys.lo, max: ys.hi }, ys.lo, ys.hi, py1, py0, {});
  }
  void xlo;
  void xhi;
  const clipId = `${idp}clip${ai}`;
  out.push(`<defs><clipPath id="${clipId}"><rect x="${f2(px0 - 1)}" y="${f2(py0 - 1)}" width="${f2(px1 - px0 + 2)}" height="${f2(py1 - py0 + 2)}"/></clipPath></defs>`);
  if (th.plotBackground !== 'none') out.push(`<rect x="${f2(px0)}" y="${f2(py0)}" width="${f2(px1 - px0)}" height="${f2(py1 - py0)}" fill="${th.plotBackground}"/>`);
  // Grid
  if (ax.x.grid && !isCat) for (const t of xs.ticks) out.push(`<line x1="${f2(xs(t))}" y1="${f2(py0)}" x2="${f2(xs(t))}" y2="${f2(py1)}" stroke="${th.gridColor}" stroke-width="0.6"/>`);
  if (ax.y.grid) for (const t of ys.ticks) out.push(`<line x1="${f2(px0)}" y1="${f2(ys(t))}" x2="${f2(px1)}" y2="${f2(ys(t))}" stroke="${th.gridColor}" stroke-width="0.6"/>`);
  // Series
  out.push(`<g clip-path="url(#${clipId})">`);
  ax.series.forEach((s, si) => {
    const g = renderSeries(s, xs, ys, px0, px1, py0, py1, fig, th);
    if (g) out.push(opts.interactive ? `<g data-series="${si}">${g}</g>` : g);
  });
  out.push('</g>');
  // brackets and text drawn without clipping
  ax.series.forEach((s) => {
    if (s.type === 'bracket') out.push(renderBracket(s, xs, ys, fig, th));
  });
  // Axes lines
  const boxOn = th.box === false ? false : th.box === true ? true : ax.box && fig.style !== 'prism';
  const aw = fig.axisWidth ?? th.axisWidth;
  if (!ax.x.hidden) {
    const yAxisPos = py1;
    out.push(`<line x1="${f2(px0 - (fig.style === 'prism' ? aw / 2 : 0))}" y1="${f2(yAxisPos)}" x2="${f2(px1)}" y2="${f2(yAxisPos)}" stroke="${th.axisColor}" stroke-width="${aw}" stroke-linecap="square"/>`);
    if (boxOn) out.push(`<line x1="${f2(px0)}" y1="${f2(py0)}" x2="${f2(px1)}" y2="${f2(py0)}" stroke="${th.axisColor}" stroke-width="${aw}"/>`);
    const tl = th.tickDir === 'out' ? th.tickLen : -th.tickLen;
    xs.ticks.forEach((t, i) => {
      const x = xs(t);
      if (!(isCat && fig.style === 'prism')) out.push(`<line x1="${f2(x)}" y1="${f2(yAxisPos)}" x2="${f2(x)}" y2="${f2(yAxisPos + tl)}" stroke="${th.axisColor}" stroke-width="${aw}"/>`);
      if (boxOn && th.tickDir === 'in') out.push(`<line x1="${f2(x)}" y1="${f2(py0)}" x2="${f2(x)}" y2="${f2(py0 + th.tickLen)}" stroke="${th.axisColor}" stroke-width="${aw}"/>`);
      const lab = xs.labels[i];
      const ly = yAxisPos + Math.max(0, tl) + tickFs * 1.05;
      if (rotate) out.push(textSvg(x, ly - tickFs * 0.4, lab, { size: tickFs, anchor: 'end', color: th.textColor, rotate: -45, family: fig.fontFamily, baseline: 'middle' }));
      else out.push(textSvg(x, ly, lab, { size: tickFs, color: th.textColor, family: fig.fontFamily }));
    });
    for (const t of xs.minor) out.push(`<line x1="${f2(xs(t))}" y1="${f2(yAxisPos)}" x2="${f2(xs(t))}" y2="${f2(yAxisPos + tl / 2)}" stroke="${th.axisColor}" stroke-width="${aw * 0.7}"/>`);
    if (ax.x.label) out.push(textSvg((px0 + px1) / 2, py1 + Math.max(0, tl) + xLabelH + labFs * 1.35, ax.x.label, { size: labFs, weight: th.labelWeight, color: th.textColor, family: fig.fontFamily }));
  }
  if (!ax.y.hidden) {
    out.push(`<line x1="${f2(px0)}" y1="${f2(py0)}" x2="${f2(px0)}" y2="${f2(py1 + (fig.style === 'prism' ? aw / 2 : 0))}" stroke="${th.axisColor}" stroke-width="${aw}" stroke-linecap="square"/>`);
    if (boxOn) out.push(`<line x1="${f2(px1)}" y1="${f2(py0)}" x2="${f2(px1)}" y2="${f2(py1)}" stroke="${th.axisColor}" stroke-width="${aw}"/>`);
    const tl = th.tickDir === 'out' ? th.tickLen : -th.tickLen;
    ys.ticks.forEach((t, i) => {
      const y = ys(t);
      out.push(`<line x1="${f2(px0)}" y1="${f2(y)}" x2="${f2(px0 - tl)}" y2="${f2(y)}" stroke="${th.axisColor}" stroke-width="${aw}"/>`);
      if (boxOn && th.tickDir === 'in') out.push(`<line x1="${f2(px1)}" y1="${f2(y)}" x2="${f2(px1 - th.tickLen)}" y2="${f2(y)}" stroke="${th.axisColor}" stroke-width="${aw}"/>`);
      out.push(textSvg(px0 - Math.max(0, tl) - 4, y, ys.labels[i], { size: tickFs, anchor: 'end', baseline: 'middle', color: th.textColor, family: fig.fontFamily }));
    });
    for (const t of ys.minor) out.push(`<line x1="${f2(px0)}" y1="${f2(ys(t))}" x2="${f2(px0 - tl / 2)}" y2="${f2(ys(t))}" stroke="${th.axisColor}" stroke-width="${aw * 0.7}"/>`);
    if (ax.y.label) out.push(textSvg(X0 + 10 + labFs * 0.7, (py0 + py1) / 2, ax.y.label, { size: labFs, weight: th.labelWeight, color: th.textColor, rotate: -90, family: fig.fontFamily, baseline: 'middle' }));
  }
  if (ax.title) out.push(textSvg((px0 + px1) / 2, Y0 + 8 + titFs, ax.title, { size: titFs, weight: th.titleWeight, color: th.textColor, family: fig.fontFamily }));
  // Colorbar
  if (ax.colorbar) {
    const cbx = px1 + 14, cbw = 14;
    const gid = `${idp}cb${ai}`;
    const stops = colormapStops(ax.colorbar.colormap);
    out.push(`<defs><linearGradient id="${gid}" x1="0" y1="1" x2="0" y2="0">${stops.map((c, i) => `<stop offset="${f2(i / (stops.length - 1))}" stop-color="${c}"/>`).join('')}</linearGradient></defs>`);
    out.push(`<rect x="${f2(cbx)}" y="${f2(py0)}" width="${cbw}" height="${f2(py1 - py0)}" fill="url(#${gid})" stroke="${th.axisColor}" stroke-width="0.5"/>`);
    const cs = makeScale({ scale: 'linear' }, ax.colorbar.min, ax.colorbar.max, py1, py0, { tight: true });
    const cs2 = makeScale({ scale: 'linear', min: ax.colorbar.min, max: ax.colorbar.max === ax.colorbar.min ? ax.colorbar.min + 1 : ax.colorbar.max }, 0, 1, py1, py0, {});
    void cs;
    cs2.ticks.forEach((t, i) => {
      out.push(`<line x1="${f2(cbx + cbw)}" y1="${f2(cs2(t))}" x2="${f2(cbx + cbw + 3)}" y2="${f2(cs2(t))}" stroke="${th.axisColor}" stroke-width="0.6"/>`);
      out.push(textSvg(cbx + cbw + 5, cs2(t), cs2.labels[i], { size: tickFs * 0.9, anchor: 'start', baseline: 'middle', color: th.textColor, family: fig.fontFamily }));
    });
  }
  // Legend
  if (ents.length) out.push(renderLegend(ents, ax, legendRight, legendTop, px0, px1, py0, py1, X0 + W - legendW, Y0 + mTop - tickFs * 1.6, fig, th, tickFs));
  return out.join('');
}

function renderLegend(ents: ReturnType<typeof legendEntries>, ax: AxesSpec, right: boolean, top: boolean, px0: number, px1: number, py0: number, py1: number, lx: number, ty: number, fig: FigureSpec, th: Theme, fs: number): string {
  const out: string[] = [];
  const rowH = fs * 1.5;
  const sw = 22;
  const maxW = Math.max(...ents.map((e) => approxTextWidth(e.label, fs)));
  const sample = (e: (typeof ents)[number], x: number, y: number) => {
    if (e.kind === 'patch') return `<rect x="${f2(x + 4)}" y="${f2(y - fs * 0.4)}" width="${f2(sw - 8)}" height="${f2(fs * 0.8)}" fill="${e.fill ?? e.color}" stroke="${e.color}" stroke-width="0.8"/>`;
    let s = '';
    if (e.kind === 'line' && e.dash !== 'none') s += `<line x1="${f2(x)}" y1="${f2(y)}" x2="${f2(x + sw)}" y2="${f2(y)}" stroke="${e.color}" stroke-width="1.5"${e.dash !== 'solid' ? ` stroke-dasharray="${dashArray(e.dash, 1.5)}"` : ''}/>`;
    if (e.marker !== 'none') s += markerSvg(e.marker, x + sw / 2, y, fs * 0.6, e.color, e.fill ?? e.color);
    return s;
  };
  if (top) {
    let x = px0;
    for (const e of ents) {
      out.push(sample(e, x, ty));
      out.push(textSvg(x + sw + 4, ty, e.label, { size: fs, anchor: 'start', baseline: 'middle', color: th.textColor, family: fig.fontFamily }));
      x += sw + 14 + approxTextWidth(e.label, fs);
    }
    return out.join('');
  }
  if (right) {
    const x = lx + 6;
    const y0 = (py0 + py1) / 2 - (ents.length * rowH) / 2 + rowH / 2;
    ents.forEach((e, i) => {
      out.push(sample(e, x, y0 + i * rowH));
      out.push(textSvg(x + sw + 5, y0 + i * rowH, e.label, { size: fs, anchor: 'start', baseline: 'middle', color: th.textColor, family: fig.fontFamily }));
    });
    return out.join('');
  }
  const bw = sw + 14 + maxW, bh = ents.length * rowH + 6;
  const loc = ax.legend.location;
  const bx = loc.includes('west') ? px0 + 8 : px1 - bw - 8;
  const by = loc.includes('south') ? py1 - bh - 8 : py0 + 8;
  out.push(`<rect x="${f2(bx)}" y="${f2(by)}" width="${f2(bw)}" height="${f2(bh)}" fill="${fig.style === 'dark' ? '#262a33' : '#ffffff'}" stroke="${fig.style === 'prism' ? 'none' : th.axisColor}" stroke-width="0.6"/>`);
  ents.forEach((e, i) => {
    const y = by + 3 + rowH / 2 + i * rowH;
    out.push(sample(e, bx + 5, y));
    out.push(textSvg(bx + sw + 9, y, e.label, { size: fs, anchor: 'start', baseline: 'middle', color: th.textColor, family: fig.fontFamily }));
  });
  return out.join('');
}

function renderSeries(s: SeriesSpec, xs: Scale, ys: Scale, px0: number, px1: number, py0: number, py1: number, fig: FigureSpec, th: Theme): string {
  const ok = (x: number, y: number) => Number.isFinite(x) && Number.isFinite(y) && !(xs.log && x <= 0) && !(ys.log && y <= 0);
  switch (s.type) {
    case 'line': {
      const segs: string[] = [];
      let cur = '';
      for (let i = 0; i < s.x.length; i++) {
        const x = s.x[i], y = s.y[i];
        if (!ok(x, y)) {
          if (cur) segs.push(cur);
          cur = '';
          continue;
        }
        const X = xs(x), Y = ys(y);
        if (!cur) cur = `M${f2(X)},${f2(Y)}`;
        else if (s.step === 'post') cur += `H${f2(X)}V${f2(Y)}`;
        else if (s.step === 'pre') cur += `V${f2(Y)}H${f2(X)}`;
        else cur += `L${f2(X)},${f2(Y)}`;
      }
      if (cur) segs.push(cur);
      let o = '';
      if (s.dash !== 'none' && segs.length) o += `<path d="${segs.join('')}" fill="none" stroke="${s.color}" stroke-width="${f2(s.width)}" stroke-linejoin="round" stroke-linecap="${s.dash === 'solid' ? 'round' : 'butt'}"${s.dash !== 'solid' ? ` stroke-dasharray="${dashArray(s.dash, s.width)}"` : ''}${s.opacity !== undefined ? ` stroke-opacity="${s.opacity}"` : ''}/>`;
      if (s.marker !== 'none') {
        const fill = s.markerFill === undefined ? (fig.style === 'matlab' ? 'none' : s.color) : s.markerFill === 'auto' ? s.color : s.markerFill;
        const stroke = s.markerEdge ?? s.color;
        for (let i = 0; i < s.x.length; i++) if (ok(s.x[i], s.y[i])) o += markerSvg(s.marker, xs(s.x[i]), ys(s.y[i]), s.markerSize, stroke, fill, fig.style === 'prism' ? 1.2 : 0.8);
      }
      return o;
    }
    case 'scatter': {
      let o = '';
      for (let i = 0; i < s.x.length; i++) {
        if (!ok(s.x[i], s.y[i])) continue;
        const c = s.colors?.[i] ?? s.color;
        const fill = s.fill === 'none' ? 'none' : s.fill === 'auto' ? c : s.fill;
        o += markerSvg(s.marker, xs(s.x[i]), ys(s.y[i]), s.sizes?.[i] ?? s.size, c, fill, s.edgeWidth ?? (fig.style === 'prism' ? 1 : 0.8), s.opacity);
      }
      return o;
    }
    case 'bar': {
      let o = '';
      const ys0 = ys.log ? ys.lo : 0;
      for (let i = 0; i < s.x.length; i++) {
        const v = s.y[i];
        if (!Number.isFinite(v)) continue;
        const base = s.base?.[i] ?? (s.horizontal ? (xs.log ? xs.lo : 0) : ys0);
        const fill = s.colors?.[i] ?? s.fill;
        const op = s.opacity !== undefined ? ` fill-opacity="${s.opacity}"` : '';
        if (s.horizontal) {
          const yA = ys(s.x[i] - s.width / 2), yB = ys(s.x[i] + s.width / 2);
          const xa = xs(base), xb = xs(v);
          o += `<rect x="${f2(Math.min(xa, xb))}" y="${f2(Math.min(yA, yB))}" width="${f2(Math.abs(xb - xa))}" height="${f2(Math.abs(yB - yA))}" fill="${fill}"${op} stroke="${s.edge}" stroke-width="${f2(s.edgeWidth)}"/>`;
        } else {
          const xa = xs(s.x[i] - s.width / 2), xb = xs(s.x[i] + s.width / 2);
          const ya = ys(Math.max(base, ys.log ? ys.lo : -Infinity)), yb = ys(v);
          o += `<rect x="${f2(Math.min(xa, xb))}" y="${f2(Math.min(ya, yb))}" width="${f2(Math.abs(xb - xa))}" height="${f2(Math.abs(yb - ya))}" fill="${fill}"${op} stroke="${s.edge}" stroke-width="${f2(s.edgeWidth)}"/>`;
        }
      }
      return o;
    }
    case 'errorbar': {
      let o = '';
      for (let i = 0; i < s.x.length; i++) {
        const lo = s.lo[i], hi = s.hi[i];
        if (!Number.isFinite(s.x[i])) continue;
        const X = xs(s.x[i]);
        const a = Number.isFinite(lo) && !(ys.log && lo <= 0) ? ys(lo) : null;
        const b = Number.isFinite(hi) && !(ys.log && hi <= 0) ? ys(hi) : null;
        const c = Number.isFinite(s.y[i]) && !(ys.log && s.y[i] <= 0) ? ys(s.y[i]) : null;
        const cap = s.cap / 2;
        if (a !== null && c !== null && Math.abs(a - c) > 0.01) o += `<path d="M${f2(X)},${f2(c)}V${f2(a)}${cap ? `M${f2(X - cap)},${f2(a)}H${f2(X + cap)}` : ''}" stroke="${s.color}" stroke-width="${f2(s.width)}" fill="none"/>`;
        if (b !== null && c !== null && Math.abs(b - c) > 0.01) o += `<path d="M${f2(X)},${f2(c)}V${f2(b)}${cap ? `M${f2(X - cap)},${f2(b)}H${f2(X + cap)}` : ''}" stroke="${s.color}" stroke-width="${f2(s.width)}" fill="none"/>`;
      }
      return o;
    }
    case 'box': {
      const xa = xs(s.x - s.width / 2), xb = xs(s.x + s.width / 2), xc = xs(s.x);
      const q1 = ys(s.q1), q3 = ys(s.q3), md = ys(s.med), lo = ys(s.lo), hi = ys(s.hi);
      const cap = (xb - xa) * 0.25;
      let o = `<path d="M${f2(xc)},${f2(q3)}V${f2(hi)}M${f2(xc - cap)},${f2(hi)}H${f2(xc + cap)}M${f2(xc)},${f2(q1)}V${f2(lo)}M${f2(xc - cap)},${f2(lo)}H${f2(xc + cap)}" stroke="${s.color}" stroke-width="${f2(s.lineWidth)}" fill="none"/>`;
      o += `<rect x="${f2(xa)}" y="${f2(Math.min(q1, q3))}" width="${f2(xb - xa)}" height="${f2(Math.abs(q1 - q3))}" fill="${s.fill}" stroke="${s.color}" stroke-width="${f2(s.lineWidth)}"/>`;
      o += `<line x1="${f2(xa)}" y1="${f2(md)}" x2="${f2(xb)}" y2="${f2(md)}" stroke="${fig.style === 'matlab' ? '#ff0000' : s.color}" stroke-width="${f2(s.lineWidth * 1.4)}"/>`;
      if (s.mean !== undefined) o += markerSvg('plus', xc, ys(s.mean), 8, s.color, s.color, s.lineWidth);
      for (const v of s.outliers) o += markerSvg(fig.style === 'matlab' ? 'plus' : 'circle', xc, ys(v), 5, fig.style === 'matlab' ? '#ff0000' : s.color, 'none', 1);
      return o;
    }
    case 'violin': {
      const maxD = Math.max(...s.density.map((d) => d.d), 1e-12);
      const half = (xs(s.x + s.width / 2) - xs(s.x - s.width / 2)) / 2;
      const xc = xs(s.x);
      const right = s.density.map((d) => `${f2(xc + (d.d / maxD) * half)},${f2(ys(d.y))}`);
      const left = [...s.density].reverse().map((d) => `${f2(xc - (d.d / maxD) * half)},${f2(ys(d.y))}`);
      let o = `<path d="M${right.join('L')}L${left.join('L')}Z" fill="${s.fill}" stroke="${s.color}" stroke-width="${f2(s.lineWidth)}"/>`;
      const widthAt = (y: number) => {
        let best = s.density[0];
        for (const d of s.density) if (Math.abs(d.y - y) < Math.abs(best.y - y)) best = d;
        return (best.d / maxD) * half;
      };
      o += `<line x1="${f2(xc - widthAt(s.med))}" y1="${f2(ys(s.med))}" x2="${f2(xc + widthAt(s.med))}" y2="${f2(ys(s.med))}" stroke="${s.color}" stroke-width="${f2(s.lineWidth * 1.5)}"/>`;
      for (const q of [s.q1, s.q3]) o += `<line x1="${f2(xc - widthAt(q))}" y1="${f2(ys(q))}" x2="${f2(xc + widthAt(q))}" y2="${f2(ys(q))}" stroke="${s.color}" stroke-width="${f2(s.lineWidth)}" stroke-dasharray="4,3"/>`;
      return o;
    }
    case 'area': {
      const pts = s.x.map((x, i) => [x, s.y[i]] as const).filter(([x, y]) => ok(x, y));
      if (!pts.length) return '';
      const base = s.y0 ?? s.x.map(() => (ys.log ? ys.lo : 0));
      let d = `M${f2(xs(pts[0][0]))},${f2(ys(pts[0][1]))}` + pts.slice(1).map(([x, y]) => `L${f2(xs(x))},${f2(ys(y))}`).join('');
      for (let i = s.x.length - 1; i >= 0; i--) if (Number.isFinite(s.x[i])) d += `L${f2(xs(s.x[i]))},${f2(ys(base[i] ?? 0))}`;
      return `<path d="${d}Z" fill="${s.color}" fill-opacity="${s.opacity}" stroke="${s.edge ?? 'none'}" stroke-width="0.6"/>`;
    }
    case 'band': {
      const idx = s.x.map((_, i) => i).filter((i) => ok(s.x[i], s.lo[i]) && ok(s.x[i], s.hi[i]));
      if (!idx.length) return '';
      const d = idx.map((i, k) => `${k ? 'L' : 'M'}${f2(xs(s.x[i]))},${f2(ys(s.hi[i]))}`).join('') + [...idx].reverse().map((i) => `L${f2(xs(s.x[i]))},${f2(ys(s.lo[i]))}`).join('');
      return `<path d="${d}Z" fill="${s.color}" fill-opacity="${s.opacity}" stroke="none"/>`;
    }
    case 'polygon': {
      const pts = s.x.map((x, i) => `${f2(xs(x))},${f2(ys(s.y[i]))}`);
      return `<path d="M${pts.join('L')}Z" fill="${s.color}" fill-opacity="${s.opacity}" stroke="${s.edge}" stroke-width="0.6"/>`;
    }
    case 'stem': {
      let o = '';
      for (let i = 0; i < s.x.length; i++) {
        if (!ok(s.x[i], s.y[i])) continue;
        const X = xs(s.x[i]);
        o += `<line x1="${f2(X)}" y1="${f2(ys(s.base))}" x2="${f2(X)}" y2="${f2(ys(s.y[i]))}" stroke="${s.color}" stroke-width="${f2(s.width)}"/>`;
        o += markerSvg(s.marker, X, ys(s.y[i]), s.markerSize, s.color, s.markerFill ?? 'none', 1);
      }
      return `<line x1="${f2(px0)}" y1="${f2(ys(s.base))}" x2="${f2(px1)}" y2="${f2(ys(s.base))}" stroke="${s.color}" stroke-width="${f2(s.width * 0.8)}"/>` + o;
    }
    case 'hline': {
      const Y = ys(s.value);
      return `<line x1="${f2(px0)}" y1="${f2(Y)}" x2="${f2(px1)}" y2="${f2(Y)}" stroke="${s.color}" stroke-width="${f2(s.width)}"${s.dash !== 'solid' ? ` stroke-dasharray="${dashArray(s.dash, s.width)}"` : ''}/>` + (s.label ? textSvg(px1 - 4, Y - 4, s.label, { size: fig.fontSize * 0.85, anchor: 'end', color: s.color, family: fig.fontFamily }) : '');
    }
    case 'vline': {
      const X = xs(s.value);
      return `<line x1="${f2(X)}" y1="${f2(py0)}" x2="${f2(X)}" y2="${f2(py1)}" stroke="${s.color}" stroke-width="${f2(s.width)}"${s.dash !== 'solid' ? ` stroke-dasharray="${dashArray(s.dash, s.width)}"` : ''}/>` + (s.label ? textSvg(X + 4, py0 + 12, s.label, { size: fig.fontSize * 0.85, anchor: 'start', color: s.color, family: fig.fontFamily }) : '');
    }
    case 'heatmap': {
      const ny = s.z.length, nx = s.z[0]?.length ?? 0;
      const vals = s.z.flat().filter(Number.isFinite);
      const cmin = s.cmin ?? Math.min(...vals), cmax = s.cmax ?? Math.max(...vals);
      const dx = nx > 1 ? (s.x1 - s.x0) / (nx - 1) : 1, dy = ny > 1 ? (s.y1 - s.y0) / (ny - 1) : 1;
      let o = '';
      for (let i = 0; i < ny; i++)
        for (let j = 0; j < nx; j++) {
          const v = s.z[i][j];
          const cx = s.x0 + j * dx, cy = s.y0 + i * dy;
          const xa = xs(cx - dx / 2), xb = xs(cx + dx / 2), ya = ys(cy - dy / 2), yb = ys(cy + dy / 2);
          const t = (v - cmin) / (cmax - cmin || 1);
          o += `<rect x="${f2(Math.min(xa, xb))}" y="${f2(Math.min(ya, yb))}" width="${f2(Math.abs(xb - xa) + 0.4)}" height="${f2(Math.abs(yb - ya) + 0.4)}" fill="${Number.isFinite(v) ? colormapColor(s.colormap, t) : '#ffffff'}"/>`;
          if (s.showValues && Number.isFinite(v) && Math.abs(yb - ya) >= fig.fontSize * 1.05 && Math.abs(xb - xa) >= fig.fontSize * 2.2) {
            const dark = t < 0.45 && s.colormap !== 'redblue';
            o += textSvg((xa + xb) / 2, (ya + yb) / 2, Math.abs(v) >= 100 || Number.isInteger(v) ? String(Math.round(v * 100) / 100) : v.toFixed(2), { size: Math.min(fig.fontSize * 0.85, Math.abs(xb - xa) / 3.2), baseline: 'middle', color: dark ? '#ffffff' : '#000000', family: fig.fontFamily });
          }
        }
      return o;
    }
    case 'text':
      return textSvg(xs(s.x), ys(s.y), s.text, { size: s.size, anchor: s.anchor, color: s.color, family: fig.fontFamily, weight: s.bold ? 'bold' : undefined, baseline: 'middle' });
    default:
      return '';
  }
}

function renderBracket(s: Extract<SeriesSpec, { type: 'bracket' }>, xs: Scale, ys: Scale, fig: FigureSpec, th: Theme): string {
  const x1 = xs(s.x1), x2 = xs(s.x2), y = ys(s.y);
  const tick = 5;
  return `<path d="M${f2(x1)},${f2(y + tick)}V${f2(y)}H${f2(x2)}V${f2(y + tick)}" fill="none" stroke="${s.color}" stroke-width="${f2(s.width)}"/>` + textSvg((x1 + x2) / 2, y - 4, s.text, { size: fig.fontSize * (s.text === 'ns' ? 0.9 : 1.05), color: th.textColor === '#e6e8ee' ? th.textColor : s.color, family: fig.fontFamily, weight: s.text === 'ns' ? 'normal' : 'bold' });
}

function renderPie(ax: AxesSpec, X0: number, Y0: number, W: number, H: number, fig: FigureSpec, th: Theme): string {
  const out: string[] = [];
  const fs = fig.fontSize;
  const s = ax.series.find((x) => x.type === 'pie') as Extract<SeriesSpec, { type: 'pie' }> | undefined;
  if (ax.title) out.push(textSvg(X0 + W / 2, Y0 + 8 + fs * 1.2, ax.title, { size: fs * th.titleFontScale, weight: th.titleWeight, color: th.textColor, family: fig.fontFamily }));
  if (!s) return out.join('');
  const top = ax.title ? fs * 2.6 : 10;
  const legendW = ax.legend.show ? Math.max(...s.labels.map((l) => approxTextWidth(l, fs))) + 40 : 0;
  const cx = X0 + (W - legendW) / 2, cy = Y0 + top + (H - top) / 2;
  const R = Math.max(10, Math.min(W - legendW, H - top) / 2 - fs * 3);
  const total = s.values.reduce((a, b) => a + (b > 0 ? b : 0), 0);
  let ang = -Math.PI / 2;
  s.values.forEach((v, i) => {
    if (!(v > 0)) return;
    const a2 = ang + (2 * Math.PI * v) / total;
    const large = a2 - ang > Math.PI ? 1 : 0;
    const x1 = cx + R * Math.cos(ang), y1 = cy + R * Math.sin(ang), x2 = cx + R * Math.cos(a2), y2 = cy + R * Math.sin(a2);
    const r0 = R * s.donut;
    let d: string;
    if (Math.abs(a2 - ang - 2 * Math.PI) < 1e-9) {
      d = `M${f2(cx - R)},${f2(cy)}a${f2(R)},${f2(R)} 0 1,0 ${f2(2 * R)},0a${f2(R)},${f2(R)} 0 1,0 ${f2(-2 * R)},0Z`;
    } else if (r0 > 0) {
      const ix1 = cx + r0 * Math.cos(a2), iy1 = cy + r0 * Math.sin(a2), ix2 = cx + r0 * Math.cos(ang), iy2 = cy + r0 * Math.sin(ang);
      d = `M${f2(x1)},${f2(y1)}A${f2(R)},${f2(R)} 0 ${large},1 ${f2(x2)},${f2(y2)}L${f2(ix1)},${f2(iy1)}A${f2(r0)},${f2(r0)} 0 ${large},0 ${f2(ix2)},${f2(iy2)}Z`;
    } else d = `M${f2(cx)},${f2(cy)}L${f2(x1)},${f2(y1)}A${f2(R)},${f2(R)} 0 ${large},1 ${f2(x2)},${f2(y2)}Z`;
    out.push(`<path d="${d}" fill="${s.colors[i]}" stroke="${fig.style === 'dark' ? '#1e2128' : '#ffffff'}" stroke-width="1.5"/>`);
    const mid = (ang + a2) / 2;
    const lr = R * (s.donut > 0 ? (1 + s.donut) / 2 : 1.18);
    const pct = `${Math.round((1000 * v) / total) / 10}%`;
    const label = ax.legend.show ? pct : s.showPercent ? pct : `${s.labels[i]}`;
    out.push(textSvg(cx + lr * Math.cos(mid), cy + lr * Math.sin(mid), label, { size: fs * 0.92, baseline: 'middle', anchor: s.donut > 0 ? 'middle' : Math.cos(mid) > 0.2 ? 'start' : Math.cos(mid) < -0.2 ? 'end' : 'middle', color: s.donut > 0 ? '#ffffff' : th.textColor, family: fig.fontFamily, weight: s.donut > 0 ? 'bold' : undefined }));
    ang = a2;
  });
  if (ax.legend.show) {
    const lx = X0 + W - legendW + 6;
    const rowH = fs * 1.5;
    const y0 = cy - (s.labels.length * rowH) / 2 + rowH / 2;
    s.labels.forEach((l, i) => {
      out.push(`<rect x="${f2(lx)}" y="${f2(y0 + i * rowH - fs * 0.4)}" width="${f2(fs * 0.8)}" height="${f2(fs * 0.8)}" fill="${s.colors[i]}"/>`);
      out.push(textSvg(lx + fs * 1.2, y0 + i * rowH, l, { size: fs, anchor: 'start', baseline: 'middle', color: th.textColor, family: fig.fontFamily }));
    });
  }
  return out.join('');
}

// ---------------- 3-D ----------------
function render3D(ax: AxesSpec, X0: number, Y0: number, W: number, H: number, fig: FigureSpec, th: Theme, ai: number): string {
  const out: string[] = [];
  const fs = fig.fontSize;
  const [az, el] = ax.view ?? [-37.5, 30];
  let xlo = Infinity, xhi = -Infinity, ylo = Infinity, yhi = -Infinity, zlo = Infinity, zhi = -Infinity;
  const upd = (x: number, y: number, z: number) => {
    if (Number.isFinite(x)) { xlo = Math.min(xlo, x); xhi = Math.max(xhi, x); }
    if (Number.isFinite(y)) { ylo = Math.min(ylo, y); yhi = Math.max(yhi, y); }
    if (Number.isFinite(z)) { zlo = Math.min(zlo, z); zhi = Math.max(zhi, z); }
  };
  for (const s of ax.series) {
    if (s.type === 'surface') s.z.forEach((row, i) => row.forEach((z, j) => upd(s.x[i][j], s.y[i][j], z)));
    if (s.type === 'line3') s.x.forEach((x, i) => upd(x, s.y[i], s.z[i]));
  }
  if (xlo === Infinity) { xlo = 0; xhi = 1; ylo = 0; yhi = 1; zlo = 0; zhi = 1; }
  const xt = makeScale({ ...ax.x, scale: 'linear' }, xlo, xhi, 0, 1, { tight: false });
  const yt = makeScale({ ...ax.y, scale: 'linear' }, ylo, yhi, 0, 1, { tight: false });
  const zt = makeScale({ ...(ax.z ?? { scale: 'linear' }), scale: 'linear' }, zlo, zhi, 0, 1, { tight: false });
  const A = (az * Math.PI) / 180, E = (el * Math.PI) / 180;
  // normalized cube coordinates in [-1, 1]
  const nx = (x: number) => ((x - xt.lo) / (xt.hi - xt.lo || 1)) * 2 - 1;
  const ny = (y: number) => ((y - yt.lo) / (yt.hi - yt.lo || 1)) * 2 - 1;
  const nz = (z: number) => ((z - zt.lo) / (zt.hi - zt.lo || 1)) * 2 - 1;
  const proj = (x: number, y: number, z: number) => {
    const X = nx(x), Y = ny(y), Z = nz(z) * 0.8;
    const px = X * Math.cos(A) + Y * Math.sin(A);
    const py = -X * Math.sin(A) * Math.sin(E) + Y * Math.cos(A) * Math.sin(E) + Z * Math.cos(E);
    const depth = -X * Math.sin(A) * Math.cos(E) + Y * Math.cos(A) * Math.cos(E) - Z * Math.sin(E);
    return { px, py, depth };
  };
  const top = ax.title ? fs * 2.4 : 10;
  const cx = X0 + W / 2 - (ax.colorbar ? 30 : 0), cy = Y0 + top + (H - top) / 2;
  const scale = Math.min(W - 120, H - top - 70) / 3.1;
  const P = (x: number, y: number, z: number) => {
    const p = proj(x, y, z);
    return { x: cx + p.px * scale, y: cy - p.py * scale, d: p.depth };
  };
  if (ax.title) out.push(textSvg(X0 + W / 2, Y0 + 8 + fs * 1.2, ax.title, { size: fs * th.titleFontScale, weight: th.titleWeight, color: th.textColor, family: fig.fontFamily }));
  // Back panes: choose the three faces facing away from viewer
  const xb = Math.sin(A) > 0 ? xt.lo : xt.hi;
  const yb = Math.cos(A) > 0 ? yt.hi : yt.lo;
  const zb = zt.lo;
  const pane = (pts: [number, number, number][]) => `<path d="${pts.map((p, i) => { const q = P(...p); return `${i ? 'L' : 'M'}${f2(q.x)},${f2(q.y)}`; }).join('')}Z" fill="${fig.style === 'dark' ? '#23272f' : '#ffffff'}" stroke="${th.axisColor}" stroke-width="0.5"/>`;
  out.push(pane([[xb, yt.lo, zt.lo], [xb, yt.hi, zt.lo], [xb, yt.hi, zt.hi], [xb, yt.lo, zt.hi]]));
  out.push(pane([[xt.lo, yb, zt.lo], [xt.hi, yb, zt.lo], [xt.hi, yb, zt.hi], [xt.lo, yb, zt.hi]]));
  out.push(pane([[xt.lo, yt.lo, zb], [xt.hi, yt.lo, zb], [xt.hi, yt.hi, zb], [xt.lo, yt.hi, zb]]));
  const grid = (a: [number, number, number], b: [number, number, number]) => {
    const p = P(...a), q = P(...b);
    return `<line x1="${f2(p.x)}" y1="${f2(p.y)}" x2="${f2(q.x)}" y2="${f2(q.y)}" stroke="${th.gridColor}" stroke-width="0.5"/>`;
  };
  for (const t of xt.ticks) out.push(grid([t, yt.lo, zb], [t, yt.hi, zb]), grid([t, yb, zt.lo], [t, yb, zt.hi]));
  for (const t of yt.ticks) out.push(grid([xt.lo, t, zb], [xt.hi, t, zb]), grid([xb, t, zt.lo], [xb, t, zt.hi]));
  for (const t of zt.ticks) out.push(grid([xb, yt.lo, t], [xb, yt.hi, t]), grid([xt.lo, yb, t], [xt.hi, yb, t]));
  // Surfaces: painter's algorithm
  const polys: { d: number; svg: string }[] = [];
  for (const s of ax.series) {
    if (s.type === 'surface') {
      const vals = s.z.flat().filter(Number.isFinite);
      const cmin = ax.clim?.[0] ?? Math.min(...vals), cmax = ax.clim?.[1] ?? Math.max(...vals);
      for (let i = 0; i < s.z.length - 1; i++)
        for (let j = 0; j < s.z[0].length - 1; j++) {
          const c = [[i, j], [i, j + 1], [i + 1, j + 1], [i + 1, j]].map(([a, b]) => ({ x: s.x[a][b], y: s.y[a][b], z: s.z[a][b] }));
          if (c.some((p) => !Number.isFinite(p.z))) continue;
          const pp = c.map((p) => P(p.x, p.y, p.z));
          const zavg = c.reduce((acc, p) => acc + p.z, 0) / 4;
          const col = colormapColor(s.colormap, (zavg - cmin) / (cmax - cmin || 1));
          const d = pp.reduce((acc, p) => acc + p.d, 0) / 4;
          const path = `M${pp.map((p) => `${f2(p.x)},${f2(p.y)}`).join('L')}Z`;
          polys.push({ d, svg: s.mesh ? `<path d="${path}" fill="${fig.style === 'dark' ? '#1e2128' : '#ffffff'}" stroke="${col}" stroke-width="0.7"/>` : `<path d="${path}" fill="${col}" stroke="${s.z.length * s.z[0].length > 2500 ? col : '#000000'}" stroke-width="${s.z.length * s.z[0].length > 2500 ? 0.3 : 0.25}" stroke-opacity="${s.z.length * s.z[0].length > 2500 ? 1 : 0.6}"/>` });
        }
    }
    if (s.type === 'line3') {
      for (let i = 0; i < s.x.length; i++) {
        const p = P(s.x[i], s.y[i], s.z[i]);
        if (s.dash !== 'none' && i > 0) {
          const q = P(s.x[i - 1], s.y[i - 1], s.z[i - 1]);
          polys.push({ d: (p.d + q.d) / 2 - 1e-3, svg: `<line x1="${f2(q.x)}" y1="${f2(q.y)}" x2="${f2(p.x)}" y2="${f2(p.y)}" stroke="${s.color}" stroke-width="${f2(s.width)}" stroke-linecap="round"/>` });
        }
        if (s.marker !== 'none') polys.push({ d: p.d - 2e-3, svg: markerSvg(s.marker, p.x, p.y, s.markerSize, s.color, s.scatter ? s.color : 'none') });
      }
    }
  }
  polys.sort((a, b) => b.d - a.d);
  for (const p of polys) out.push(p.svg);
  // Axis labels on front-bottom edges
  const xEdgeY = Math.cos(A) > 0 ? yt.lo : yt.hi;
  const yEdgeX = Math.sin(A) > 0 ? xt.hi : xt.lo;
  xt.ticks.forEach((t, i) => {
    const p = P(t, xEdgeY, zt.lo);
    out.push(textSvg(p.x, p.y + fs * 1.1, xt.labels[i], { size: fs * 0.85, color: th.textColor, family: fig.fontFamily }));
  });
  yt.ticks.forEach((t, i) => {
    const p = P(yEdgeX, t, zt.lo);
    out.push(textSvg(p.x + (Math.sin(A) > 0 ? 6 : -6), p.y + fs * 0.9, yt.labels[i], { size: fs * 0.85, anchor: Math.sin(A) > 0 ? 'start' : 'end', color: th.textColor, family: fig.fontFamily }));
  });
  const zEdgeX = Math.sin(A) > 0 ? xt.lo : xt.hi, zEdgeY = Math.cos(A) > 0 ? yt.lo : yt.hi;
  void zEdgeY;
  zt.ticks.forEach((t, i) => {
    const p = P(zEdgeX, Math.cos(A) > 0 ? yt.hi : yt.lo, t);
    const q = P(xt.lo, yt.lo, t);
    const lp = p.x < q.x ? p : q;
    out.push(textSvg(Math.min(p.x, P(xb === xt.lo ? xt.hi : xt.lo, yb === yt.lo ? yt.hi : yt.lo, t).x, lp.x) - 6, lp.y, zt.labels[i], { size: fs * 0.85, anchor: 'end', baseline: 'middle', color: th.textColor, family: fig.fontFamily }));
  });
  if (ax.x.label) {
    const p = P((xt.lo + xt.hi) / 2, xEdgeY, zt.lo);
    out.push(textSvg(p.x, p.y + fs * 2.5, ax.x.label, { size: fs, color: th.textColor, family: fig.fontFamily }));
  }
  if (ax.y.label) {
    const p = P(yEdgeX, (yt.lo + yt.hi) / 2, zt.lo);
    out.push(textSvg(p.x + (Math.sin(A) > 0 ? 30 : -30), p.y + fs * 2.2, ax.y.label, { size: fs, color: th.textColor, family: fig.fontFamily }));
  }
  if (ax.z?.label) out.push(textSvg(X0 + 18, cy, ax.z.label, { size: fs, rotate: -90, color: th.textColor, family: fig.fontFamily }));
  if (ax.colorbar) {
    const cbx = X0 + W - 70, cbw = 12, cy0 = cy - scale, cy1 = cy + scale;
    const gid = `${idp}cb3d${ai}`;
    const stops = colormapStops(ax.colorbar.colormap);
    out.push(`<defs><linearGradient id="${gid}" x1="0" y1="1" x2="0" y2="0">${stops.map((c, i) => `<stop offset="${f2(i / (stops.length - 1))}" stop-color="${c}"/>`).join('')}</linearGradient></defs>`);
    out.push(`<rect x="${f2(cbx)}" y="${f2(cy0)}" width="${cbw}" height="${f2(cy1 - cy0)}" fill="url(#${gid})" stroke="${th.axisColor}" stroke-width="0.5"/>`);
    const cs = makeScale({ scale: 'linear', min: ax.colorbar.min, max: ax.colorbar.max }, 0, 1, cy1, cy0, {});
    cs.ticks.forEach((t, i) => out.push(textSvg(cbx + cbw + 4, cs(t), cs.labels[i], { size: fs * 0.8, anchor: 'start', baseline: 'middle', color: th.textColor, family: fig.fontFamily })));
  }
  return out.join('');
}

export function svgDataUri(svg: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
