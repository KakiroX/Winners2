import { formatP, pSummary } from '../stats/tests';

export function num(v: number | null | undefined, sig = 4): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  if (v === Infinity) return '∞';
  if (v === -Infinity) return '-∞';
  if (Number.isInteger(v) && Math.abs(v) < 1e9) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-4)) return v.toExponential(sig - 1);
  const s = v.toPrecision(sig);
  return s.includes('e') ? Number(s).toString() : s;
}

export function intOrNum(v: number): string {
  return Number.isInteger(v) ? String(v) : num(v);
}

export function pv(p: number): string {
  return formatP(p);
}

export function stars(p: number): string {
  return pSummary(p);
}

export function sig(p: number, alpha = 0.05): string {
  return Number.isFinite(p) ? (p < alpha ? 'Yes' : 'No') : '';
}

export function ci(lo: number, hi: number): string {
  if (!Number.isFinite(lo) && !Number.isFinite(hi)) return '';
  return `${num(lo)} to ${num(hi)}`;
}

export function pct(v: number): string {
  return Number.isFinite(v) ? `${num(v)}%` : '';
}

export function apa(p: number): string {
  return p < 0.0001 ? 'P<0.0001' : `P=${formatP(p)}`;
}
