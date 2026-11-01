import { tInv } from './distributions';

export function clean(values: ArrayLike<number | null | undefined>): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v !== null && v !== undefined && Number.isFinite(v)) out.push(v as number);
  }
  return out;
}

export function sum(x: number[]): number {
  // Neumaier compensated summation for accuracy
  let s = 0, c = 0;
  for (const v of x) {
    const t = s + v;
    if (Math.abs(s) >= Math.abs(v)) c += s - t + v;
    else c += v - t + s;
    s = t;
  }
  return s + c;
}

export function mean(x: number[]): number {
  return x.length ? sum(x) / x.length : NaN;
}

export function variance(x: number[], ddof = 1): number {
  const n = x.length;
  if (n - ddof <= 0) return NaN;
  const m = mean(x);
  let ss = 0;
  for (const v of x) ss += (v - m) * (v - m);
  return ss / (n - ddof);
}

export function sd(x: number[], ddof = 1): number {
  return Math.sqrt(variance(x, ddof));
}

export function sem(x: number[]): number {
  return sd(x) / Math.sqrt(x.length);
}

export function sortNum(x: number[]): number[] {
  return [...x].sort((a, b) => a - b);
}

/**
 * Percentile using the (n+1)p definition (Hyndman & Fan type 6), which is the method GraphPad-style
 * column statistics use for quartiles. `p` is in [0, 1].
 */
export function percentile(sorted: number[], p: number): number {
  const n = sorted.length;
  if (!n) return NaN;
  const h = (n + 1) * p;
  if (h <= 1) return sorted[0];
  if (h >= n) return sorted[n - 1];
  const lo = Math.floor(h);
  return sorted[lo - 1] + (h - lo) * (sorted[lo] - sorted[lo - 1]);
}

/** Linear-interpolation percentile (Hyndman & Fan type 7, the default of MATLAB's prctile alternative / numpy). */
export function percentileLinear(sorted: number[], p: number): number {
  const n = sorted.length;
  if (!n) return NaN;
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export function median(x: number[]): number {
  const s = sortNum(x);
  const n = s.length;
  if (!n) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** Sample skewness with the adjusted Fisher-Pearson standardized moment (as in Excel SKEW). */
export function skewness(x: number[]): number {
  const n = x.length;
  if (n < 3) return NaN;
  const m = mean(x), s = sd(x);
  let acc = 0;
  for (const v of x) acc += Math.pow((v - m) / s, 3);
  return (n / ((n - 1) * (n - 2))) * acc;
}

/** Sample excess kurtosis (as in Excel KURT). */
export function kurtosis(x: number[]): number {
  const n = x.length;
  if (n < 4) return NaN;
  const m = mean(x), s = sd(x);
  let acc = 0;
  for (const v of x) acc += Math.pow((v - m) / s, 4);
  return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * acc - (3 * (n - 1) * (n - 1)) / ((n - 2) * (n - 3));
}

/** Ranks with ties given the average rank (1-based). */
export function rank(x: number[]): number[] {
  const idx = x.map((v, i) => i).sort((a, b) => x[a] - x[b]);
  const r = new Array(x.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && x[idx[j + 1]] === x[idx[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k]] = avg;
    i = j + 1;
  }
  return r;
}

/** Returns sizes of tie groups. */
export function tieGroups(x: number[]): number[] {
  const s = sortNum(x);
  const groups: number[] = [];
  let i = 0;
  while (i < s.length) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[i]) j++;
    if (j > i) groups.push(j - i + 1);
    i = j + 1;
  }
  return groups;
}

export interface Descriptives {
  n: number;
  min: number;
  q25: number;
  median: number;
  q75: number;
  max: number;
  range: number;
  p10: number;
  p90: number;
  mean: number;
  sd: number;
  sem: number;
  ciLo: number;
  ciHi: number;
  cv: number;
  geoMean: number;
  geoSdFactor: number;
  geoCiLo: number;
  geoCiHi: number;
  harmonicMean: number;
  quadraticMean: number;
  skewness: number;
  kurtosis: number;
  sum: number;
}

export function describe(values: number[], ciLevel = 0.95): Descriptives {
  const x = clean(values);
  const n = x.length;
  const s = sortNum(x);
  const m = mean(x);
  const sdev = sd(x);
  const se = sdev / Math.sqrt(n);
  const tcrit = n > 1 ? tInv(1 - (1 - ciLevel) / 2, n - 1) : NaN;
  const allPositive = n > 0 && x.every((v) => v > 0);
  let geoMean = NaN, geoSdFactor = NaN, geoCiLo = NaN, geoCiHi = NaN, harmonicMean = NaN;
  if (allPositive) {
    const logs = x.map(Math.log);
    const lm = mean(logs);
    const lsd = sd(logs);
    geoMean = Math.exp(lm);
    geoSdFactor = Math.exp(lsd);
    if (n > 1) {
      const lse = lsd / Math.sqrt(n);
      geoCiLo = Math.exp(lm - tcrit * lse);
      geoCiHi = Math.exp(lm + tcrit * lse);
    }
    harmonicMean = n / sum(x.map((v) => 1 / v));
  }
  return {
    n,
    min: s[0] ?? NaN,
    max: s[n - 1] ?? NaN,
    range: n ? s[n - 1] - s[0] : NaN,
    q25: percentile(s, 0.25),
    median: percentile(s, 0.5),
    q75: percentile(s, 0.75),
    p10: percentile(s, 0.1),
    p90: percentile(s, 0.9),
    mean: m,
    sd: sdev,
    sem: se,
    ciLo: m - tcrit * se,
    ciHi: m + tcrit * se,
    cv: (sdev / m) * 100,
    geoMean,
    geoSdFactor,
    geoCiLo,
    geoCiHi,
    harmonicMean,
    quadraticMean: n ? Math.sqrt(sum(x.map((v) => v * v)) / n) : NaN,
    skewness: skewness(x),
    kurtosis: kurtosis(x),
    sum: sum(x),
  };
}

export function covariance(x: number[], y: number[]): number {
  const n = x.length;
  const mx = mean(x), my = mean(y);
  let s = 0;
  for (let i = 0; i < n; i++) s += (x[i] - mx) * (y[i] - my);
  return s / (n - 1);
}

/** Gaussian kernel density estimate with Silverman's bandwidth (used for violin plots). */
export function kde(values: number[], points = 80, bandwidth?: number): { y: number; d: number }[] {
  const x = clean(values);
  const n = x.length;
  if (n < 2) return [];
  const s = sd(x);
  const iqr = percentileLinear(sortNum(x), 0.75) - percentileLinear(sortNum(x), 0.25);
  const sigma = Math.min(s, iqr / 1.34) || s || 1;
  const h = bandwidth ?? 0.9 * sigma * Math.pow(n, -0.2);
  const lo = Math.min(...x), hi = Math.max(...x);
  const out: { y: number; d: number }[] = [];
  for (let i = 0; i < points; i++) {
    const yv = lo + ((hi - lo) * i) / (points - 1);
    let d = 0;
    for (const v of x) {
      const u = (yv - v) / h;
      d += Math.exp(-0.5 * u * u);
    }
    out.push({ y: yv, d: d / (n * h * Math.sqrt(2 * Math.PI)) });
  }
  return out;
}
