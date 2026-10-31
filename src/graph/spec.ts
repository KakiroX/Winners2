// A renderer-agnostic description of a figure. Both Prism-style graphs (compiled from data tables)
// and MATLAB-style figures (built by plotting commands) produce FigureSpec objects.

export type Marker = 'circle' | 'square' | 'triangle' | 'triangleDown' | 'diamond' | 'cross' | 'plus' | 'star' | 'point' | 'none' | 'bar' | 'pentagram' | 'hexagram' | 'triangleLeft' | 'triangleRight';
export type Dash = 'solid' | 'dash' | 'dot' | 'dashdot' | 'none';

export interface AxisSpec {
  label?: string;
  min?: number;
  max?: number;
  scale: 'linear' | 'log';
  logBase?: number;
  ticks?: number[];
  tickLabels?: string[];
  reverse?: boolean;
  grid?: boolean;
  hidden?: boolean;
  format?: 'auto' | 'decimal' | 'scientific' | 'power10' | 'percent';
  categories?: string[];
  rotateLabels?: boolean;
}

export type SeriesSpec =
  | { type: 'line'; x: number[]; y: number[]; color: string; width: number; dash: Dash; marker: Marker; markerSize: number; markerFill?: string; markerEdge?: string; label?: string; step?: 'pre' | 'post'; opacity?: number }
  | { type: 'scatter'; x: number[]; y: number[]; color: string; marker: Marker; size: number; fill: string; label?: string; sizes?: number[]; colors?: string[]; opacity?: number; edgeWidth?: number }
  | { type: 'bar'; x: number[]; y: number[]; base?: number[]; width: number; color: string; fill: string; edge: string; edgeWidth: number; label?: string; horizontal?: boolean; colors?: string[]; opacity?: number }
  | { type: 'errorbar'; x: number[]; y: number[]; lo: number[]; hi: number[]; color: string; width: number; cap: number; horizontal?: boolean }
  | { type: 'box'; x: number; width: number; q1: number; med: number; q3: number; lo: number; hi: number; outliers: number[]; color: string; fill: string; mean?: number; lineWidth: number; label?: string }
  | { type: 'violin'; x: number; width: number; density: { y: number; d: number }[]; q1: number; med: number; q3: number; color: string; fill: string; lineWidth: number; label?: string }
  | { type: 'area'; x: number[]; y: number[]; y0?: number[]; color: string; opacity: number; label?: string; edge?: string }
  | { type: 'band'; x: number[]; lo: number[]; hi: number[]; color: string; opacity: number }
  | { type: 'hline'; value: number; color: string; dash: Dash; width: number; label?: string }
  | { type: 'vline'; value: number; color: string; dash: Dash; width: number; label?: string }
  | { type: 'heatmap'; z: number[][]; x0: number; x1: number; y0: number; y1: number; colormap: string; cmin?: number; cmax?: number; showValues?: boolean; rowLabels?: string[]; colLabels?: string[] }
  | { type: 'pie'; values: number[]; labels: string[]; colors: string[]; donut: number; showPercent: boolean }
  | { type: 'text'; x: number; y: number; text: string; color: string; size: number; anchor: 'start' | 'middle' | 'end'; bold?: boolean }
  | { type: 'bracket'; x1: number; x2: number; y: number; text: string; color: string; width: number }
  | { type: 'polygon'; x: number[]; y: number[]; color: string; opacity: number; edge: string; label?: string }
  | { type: 'stem'; x: number[]; y: number[]; base: number; color: string; width: number; marker: Marker; markerSize: number; markerFill?: string; label?: string }
  | { type: 'surface'; x: number[][]; y: number[][]; z: number[][]; c?: number[][]; colormap: string; mesh: boolean; edge: string; faceAlpha: number; label?: string }
  | { type: 'line3'; x: number[]; y: number[]; z: number[]; color: string; width: number; dash: Dash; marker: Marker; markerSize: number; label?: string; scatter?: boolean };

export interface LegendSpec {
  show: boolean;
  location: 'right' | 'top' | 'inside' | 'northeast' | 'northwest' | 'southeast' | 'southwest' | 'best' | 'none';
  entries?: { label: string; color: string; marker: Marker; dash: Dash; kind: 'line' | 'patch' | 'marker'; fill?: string }[];
}

export interface AxesSpec {
  id: string;
  /** Subplot grid placement (0-based) */
  row: number;
  col: number;
  rowSpan?: number;
  colSpan?: number;
  title?: string;
  x: AxisSpec;
  y: AxisSpec;
  series: SeriesSpec[];
  legend: LegendSpec;
  box: boolean;
  equal?: boolean;
  colorbar?: { colormap: string; min: number; max: number; label?: string };
  kind?: 'cartesian' | 'pie' | '3d';
  hold?: boolean;
  z?: AxisSpec;
  view?: [number, number];
  colormap?: string;
  clim?: [number, number];
}

export interface FigureSpec {
  width: number;
  height: number;
  title?: string;
  rows: number;
  cols: number;
  axes: AxesSpec[];
  style: 'prism' | 'matlab' | 'minimal' | 'dark';
  fontFamily: string;
  fontSize: number;
  background: string;
  axisWidth?: number;
}

export function emptyAxes(id: string, row = 0, col = 0): AxesSpec {
  return { id, row, col, x: { scale: 'linear' }, y: { scale: 'linear' }, series: [], legend: { show: false, location: 'northeast' }, box: true };
}

export function emptyFigure(style: FigureSpec['style'] = 'matlab'): FigureSpec {
  return { width: 560, height: 420, rows: 1, cols: 1, axes: [], style, fontFamily: style === 'matlab' ? 'Helvetica, Arial, sans-serif' : 'Arial, Helvetica, sans-serif', fontSize: style === 'matlab' ? 11 : 12, background: '#ffffff' };
}

// ---------------- Palettes ----------------
export const PALETTES: Record<string, { name: string; colors: string[] }> = {
  prism: { name: 'Classic', colors: ['#000000', '#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00', '#a65628', '#f781bf'] },
  colorblind: { name: 'Colorblind safe', colors: ['#0072B2', '#E69F00', '#009E73', '#D55E00', '#CC79A7', '#56B4E9', '#F0E442', '#000000'] },
  vivid: { name: 'Vivid', colors: ['#2A6EBB', '#F0AB00', '#C50084', '#7D5CC6', '#E37222', '#69BE28', '#00B2A9', '#CD202C'] },
  pastel: { name: 'Pastel', colors: ['#8DD3C7', '#FDB462', '#BEBADA', '#FB8072', '#80B1D3', '#B3DE69', '#FCCDE5', '#BC80BD'] },
  nature: { name: 'Journal', colors: ['#3C5488', '#E64B35', '#4DBBD5', '#00A087', '#F39B7F', '#8491B4', '#91D1C2', '#7E6148'] },
  grayscale: { name: 'Grayscale', colors: ['#000000', '#555555', '#888888', '#aaaaaa', '#cccccc', '#333333', '#777777', '#bbbbbb'] },
  matlab: { name: 'MATLAB lines', colors: ['#0072BD', '#D95319', '#EDB120', '#7E2F8E', '#77AC30', '#4DBEEE', '#A2142F'] },
  ocean: { name: 'Ocean', colors: ['#03045E', '#0077B6', '#00B4D8', '#48CAE4', '#90E0EF', '#023E8A', '#0096C7', '#ADE8F4'] },
};

export function paletteColor(palette: string, i: number): string {
  const p = PALETTES[palette] ?? PALETTES.prism;
  return p.colors[i % p.colors.length];
}

export const COLORMAPS = ['parula', 'viridis', 'jet', 'hot', 'gray', 'cool', 'turbo', 'redblue', 'magma'] as const;

const CMAP_STOPS: Record<string, string[]> = {
  parula: ['#352a87', '#0f5cdd', '#1481d6', '#06a4ca', '#2eb7a4', '#87bf77', '#d1bb59', '#fec832', '#f9fb0e'],
  viridis: ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'],
  jet: ['#00007f', '#0000ff', '#007fff', '#00ffff', '#7fff7f', '#ffff00', '#ff7f00', '#ff0000', '#7f0000'],
  hot: ['#0b0000', '#4d0000', '#8f0000', '#d10000', '#ff1500', '#ff5700', '#ff9900', '#ffdb00', '#ffff3d', '#ffffff'],
  gray: ['#000000', '#ffffff'],
  cool: ['#00ffff', '#ff00ff'],
  turbo: ['#30123b', '#4662d7', '#36aaf9', '#1ae4b6', '#72fe5e', '#c8ef34', '#faba39', '#f66b19', '#ca2a04', '#7a0403'],
  redblue: ['#2166ac', '#67a9cf', '#d1e5f0', '#f7f7f7', '#fddbc7', '#ef8a62', '#b2182b'],
  magma: ['#000004', '#2c115f', '#721f81', '#b73779', '#f1605d', '#feb078', '#fcfdbf'],
};

function hexToRgb(h: string): [number, number, number] {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function colormapColor(name: string, t: number): string {
  const stops = CMAP_STOPS[name] ?? CMAP_STOPS.parula;
  if (!Number.isFinite(t)) return '#ffffff';
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = hexToRgb(stops[i]), b = hexToRgb(stops[i + 1]);
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function colormapStops(name: string): string[] {
  return CMAP_STOPS[name] ?? CMAP_STOPS.parula;
}
