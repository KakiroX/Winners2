import { chi2Sf, fCdf, fSf, normCdf, normInv, normSf, tInv, tTwoTailP } from './distributions';
import { clean, mean, rank, sd, sortNum, sum, tieGroups, variance } from './descriptive';

export interface Summary {
  n: number;
  mean: number;
  sd: number;
}

export function summarize(x: number[]): Summary {
  const v = clean(x);
  return { n: v.length, mean: mean(v), sd: sd(v) };
}

// ---------------- p-value presentation ----------------
export function pSummary(p: number, alpha = 0.05): string {
  if (!Number.isFinite(p)) return '';
  if (alpha !== 0.05) return p < alpha ? '*' : 'ns';
  if (p < 0.0001) return '****';
  if (p < 0.001) return '***';
  if (p < 0.01) return '**';
  if (p < 0.05) return '*';
  return 'ns';
}

export function formatP(p: number): string {
  if (!Number.isFinite(p)) return '—';
  if (p < 0.0001) return '<0.0001';
  if (p >= 0.9999) return '>0.9999';
  if (p < 0.001) return p.toFixed(4);
  return p.toFixed(4);
}

// ---------------- t tests ----------------
export interface TTestResult {
  test: string;
  t: number;
  df: number;
  p: number;
  meanA: number;
  meanB: number;
  diff: number;
  seDiff: number;
  ciLo: number;
  ciHi: number;
  r2: number;
  nA: number;
  nB: number;
  fTest?: { F: number; dfn: number; dfd: number; p: number };
}

export function fTestVariances(a: Summary, b: Summary) {
  const va = a.sd * a.sd, vb = b.sd * b.sd;
  let F: number, dfn: number, dfd: number;
  if (va >= vb) {
    F = va / vb; dfn = a.n - 1; dfd = b.n - 1;
  } else {
    F = vb / va; dfn = b.n - 1; dfd = a.n - 1;
  }
  const p = Math.min(1, 2 * Math.min(fSf(F, dfn, dfd), fCdf(F, dfn, dfd)));
  return { F, dfn, dfd, p };
}

export function unpairedT(a: Summary, b: Summary, welch = false, ciLevel = 0.95): TTestResult {
  const diff = b.mean - a.mean;
  let se: number, df: number;
  if (welch) {
    const va = (a.sd * a.sd) / a.n, vb = (b.sd * b.sd) / b.n;
    se = Math.sqrt(va + vb);
    df = (va + vb) ** 2 / ((va * va) / (a.n - 1) + (vb * vb) / (b.n - 1));
  } else {
    df = a.n + b.n - 2;
    const sp2 = ((a.n - 1) * a.sd * a.sd + (b.n - 1) * b.sd * b.sd) / df;
    se = Math.sqrt(sp2 * (1 / a.n + 1 / b.n));
  }
  const t = diff / se;
  const p = tTwoTailP(t, df);
  const tc = tInv(1 - (1 - ciLevel) / 2, df);
  return {
    test: welch ? "Unpaired t test with Welch's correction" : 'Unpaired t test',
    t, df, p, meanA: a.mean, meanB: b.mean, diff, seDiff: se,
    ciLo: diff - tc * se, ciHi: diff + tc * se,
    r2: (t * t) / (t * t + df), nA: a.n, nB: b.n,
    fTest: fTestVariances(a, b),
  };
}

export function pairedT(a: number[], b: number[], ciLevel = 0.95): TTestResult & { sdDiff: number; pairingR: number; pairingP: number; nPairs: number } {
  const d: number[] = [];
  const pa: number[] = [], pb: number[] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (Number.isFinite(a[i]) && Number.isFinite(b[i])) {
      d.push(b[i] - a[i]);
      pa.push(a[i]);
      pb.push(b[i]);
    }
  }
  const n = d.length;
  const md = mean(d), sdd = sd(d);
  const se = sdd / Math.sqrt(n);
  const df = n - 1;
  const t = md / se;
  const tc = tInv(1 - (1 - ciLevel) / 2, df);
  const corr = pearson(pa, pb);
  return {
    test: 'Paired t test', t, df, p: tTwoTailP(t, df), meanA: mean(pa), meanB: mean(pb), diff: md, seDiff: se,
    ciLo: md - tc * se, ciHi: md + tc * se, r2: (t * t) / (t * t + df), nA: n, nB: n, sdDiff: sdd,
    pairingR: corr.r, pairingP: corr.p, nPairs: n,
  };
}

export function oneSampleT(x: number[], mu0 = 0, ciLevel = 0.95) {
  const v = clean(x);
  const n = v.length, m = mean(v), s = sd(v), se = s / Math.sqrt(n), df = n - 1;
  const t = (m - mu0) / se;
  const tc = tInv(1 - (1 - ciLevel) / 2, df);
  return { t, df, p: tTwoTailP(t, df), mean: m, sd: s, se, n, diff: m - mu0, ciLo: m - mu0 - tc * se, ciHi: m - mu0 + tc * se, r2: (t * t) / (t * t + df) };
}

// ---------------- Nonparametric ----------------
/** Exact null distribution counts of the Mann-Whitney U statistic. counts[u] for u=0..m*n */
function mannWhitneyCounts(m: number, n: number): number[] {
  // Coefficients of the Gaussian binomial coefficient [m+n choose m]_q
  const maxU = m * n;
  let poly = new Array(maxU + 1).fill(0);
  poly[0] = 1;
  for (let k = 1; k <= m; k++) {
    // multiply by (1 - q^(n+k))
    const sh = n + k;
    const next = poly.slice();
    for (let u = maxU; u >= sh; u--) next[u] -= poly[u - sh];
    // divide by (1 - q^k): cumulative sum with stride k
    for (let u = k; u <= maxU; u++) next[u] += next[u - k];
    poly = next;
  }
  return poly;
}

export interface MannWhitneyResult {
  U: number;
  U1: number;
  U2: number;
  p: number;
  exact: boolean;
  sumRankA: number;
  sumRankB: number;
  medianA: number;
  medianB: number;
  diffMedians: number;
  nA: number;
  nB: number;
  hodgesLehmann: number;
}

export function mannWhitney(aIn: number[], bIn: number[]): MannWhitneyResult {
  const a = clean(aIn), b = clean(bIn);
  const m = a.length, n = b.length;
  const all = [...a, ...b];
  const r = rank(all);
  const ra = sum(r.slice(0, m)), rb = sum(r.slice(m));
  const U1 = ra - (m * (m + 1)) / 2;
  const U2 = m * n - U1;
  const U = Math.min(U1, U2);
  const ties = tieGroups(all);
  let p: number;
  let exact = false;
  if (ties.length === 0 && m + n <= 100 && m * n <= 5000) {
    exact = true;
    const counts = mannWhitneyCounts(m, n);
    const total = sum(counts);
    let cum = 0;
    for (let u = 0; u <= Math.floor(U); u++) cum += counts[u];
    p = Math.min(1, (2 * cum) / total);
  } else {
    const N = m + n;
    const tieTerm = sum(ties.map((t) => t * t * t - t)) / (N * (N - 1));
    const sigma = Math.sqrt(((m * n) / 12) * (N + 1 - tieTerm));
    const z = (U - (m * n) / 2) / sigma;
    p = Math.min(1, 2 * normCdf(z));
  }
  const diffs: number[] = [];
  if (m * n <= 250000) for (const x of a) for (const y of b) diffs.push(y - x);
  const sa = sortNum(a), sb = sortNum(b);
  const med = (s: number[]) => (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2);
  return {
    U, U1, U2, p, exact, sumRankA: ra, sumRankB: rb, medianA: med(sa), medianB: med(sb), diffMedians: med(sb) - med(sa), nA: m, nB: n,
    hodgesLehmann: diffs.length ? med(sortNum(diffs)) : NaN,
  };
}

export interface WilcoxonResult {
  W: number;
  sumPositive: number;
  sumNegative: number;
  p: number;
  exact: boolean;
  n: number;
  nZero: number;
  medianDiff: number;
}

/** Wilcoxon signed-rank test on a set of differences (zeros are discarded, as in Wilcoxon's original method). */
export function wilcoxonSignedRank(diffsIn: number[]): WilcoxonResult {
  const all = clean(diffsIn);
  const nonzero = all.filter((d) => d !== 0);
  const n = nonzero.length;
  const absd = nonzero.map(Math.abs);
  const r = rank(absd);
  let wp = 0, wn = 0;
  for (let i = 0; i < n; i++) {
    if (nonzero[i] > 0) wp += r[i];
    else wn += r[i];
  }
  const ties = tieGroups(absd);
  let p: number;
  let exact = false;
  if (n === 0) p = 1;
  else if (ties.length === 0 && n <= 300) {
    exact = true;
    const maxW = (n * (n + 1)) / 2;
    let counts = new Array(maxW + 1).fill(0);
    counts[0] = 1;
    for (let k = 1; k <= n; k++) {
      for (let w = maxW; w >= k; w--) counts[w] += counts[w - k];
    }
    const total = Math.pow(2, n);
    const w = Math.min(wp, wn);
    let cum = 0;
    for (let i = 0; i <= Math.floor(w); i++) cum += counts[i];
    p = Math.min(1, (2 * cum) / total);
    counts = [];
  } else {
    const mu = (n * (n + 1)) / 4;
    const varW = (n * (n + 1) * (2 * n + 1)) / 24 - sum(ties.map((t) => t * t * t - t)) / 48;
    const z = (Math.min(wp, wn) - mu) / Math.sqrt(varW);
    p = Math.min(1, 2 * normCdf(z));
  }
  const s = sortNum(all);
  const medianDiff = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return { W: wp - wn, sumPositive: wp, sumNegative: -wn, p, exact, n, nZero: all.length - n, medianDiff };
}

export function kolmogorovSmirnov2(aIn: number[], bIn: number[]) {
  const a = sortNum(clean(aIn)), b = sortNum(clean(bIn));
  const m = a.length, n = b.length;
  let i = 0, j = 0, D = 0;
  while (i < m && j < n) {
    const x = Math.min(a[i], b[j]);
    while (i < m && a[i] <= x) i++;
    while (j < n && b[j] <= x) j++;
    D = Math.max(D, Math.abs(i / m - j / n));
  }
  const en = Math.sqrt((m * n) / (m + n));
  const lambda = (en + 0.12 + 0.11 / en) * D;
  return { D, p: kolmogorovQ(lambda), nA: m, nB: n };
}

export function kolmogorovQ(lambda: number): number {
  if (lambda < 0.2) return 1;
  let s = 0;
  for (let k = 1; k <= 200; k++) {
    const term = 2 * Math.pow(-1, k - 1) * Math.exp(-2 * k * k * lambda * lambda);
    s += term;
    if (Math.abs(term) < 1e-16) break;
  }
  return Math.max(0, Math.min(1, s));
}

// ---------------- Normality ----------------
function poly(c: number[], x: number): number {
  let r = c[c.length - 1];
  for (let i = c.length - 2; i >= 0; i--) r = r * x + c[i];
  return r;
}

export function shapiroWilk(xIn: number[]): { W: number; p: number } {
  const x = sortNum(clean(xIn));
  const n = x.length;
  if (n < 3) return { W: NaN, p: NaN };
  const nn2 = Math.floor(n / 2);
  const a = new Array(nn2 + 1).fill(0); // 1-based
  const small = 1e-19;
  if (n === 3) {
    a[1] = Math.SQRT1_2;
  } else {
    const an25 = n + 0.25;
    let summ2 = 0;
    const mvals = new Array(nn2 + 1).fill(0);
    for (let i = 1; i <= nn2; i++) {
      mvals[i] = normInv((i - 0.375) / an25);
      summ2 += mvals[i] * mvals[i];
    }
    summ2 *= 2;
    const ssumm2 = Math.sqrt(summ2);
    const rsn = 1 / Math.sqrt(n);
    const c1 = [0, 0.221157, -0.147981, -2.07119, 4.434685, -2.706056];
    const c2 = [0, 0.042981, -0.293762, -1.752461, 5.682633, -3.582633];
    const a1 = poly(c1, rsn) - mvals[1] / ssumm2;
    let i1: number, fac: number;
    if (n > 5) {
      i1 = 3;
      const a2 = -mvals[2] / ssumm2 + poly(c2, rsn);
      fac = Math.sqrt((summ2 - 2 * mvals[1] * mvals[1] - 2 * mvals[2] * mvals[2]) / (1 - 2 * a1 * a1 - 2 * a2 * a2));
      a[2] = a2;
    } else {
      i1 = 2;
      fac = Math.sqrt((summ2 - 2 * mvals[1] * mvals[1]) / (1 - 2 * a1 * a1));
    }
    a[1] = a1;
    for (let i = i1; i <= nn2; i++) a[i] = -mvals[i] / fac;
  }
  const range = x[n - 1] - x[0];
  if (range < small) return { W: NaN, p: NaN };
  // W = (sum a_i (x_(n+1-i) - x_(i)))^2 / SS
  const m = mean(x);
  let ss = 0;
  for (const v of x) ss += ((v - m) / range) ** 2;
  let num = 0;
  for (let i = 1; i <= nn2; i++) num += a[i] * (x[n - i] - x[i - 1]) / range;
  let W = (num * num) / ss;
  if (W > 1) W = 1;
  const w1 = 1 - W;
  if (n === 3) {
    const pi6 = 1.90985931710274, stqr = 1.0471975511966;
    return { W, p: Math.max(0, pi6 * (Math.asin(Math.sqrt(W)) - stqr)) };
  }
  let y = Math.log(w1);
  const xx = Math.log(n);
  let mu: number, s: number;
  if (n <= 11) {
    const gamma = poly([-2.273, 0.459], n);
    if (y >= gamma) return { W, p: 1e-99 };
    y = -Math.log(gamma - y);
    mu = poly([0.544, -0.39978, 0.025054, -6.714e-4], n);
    s = Math.exp(poly([1.3822, -0.77857, 0.062767, -0.0020322], n));
  } else {
    mu = poly([-1.5861, -0.31082, -0.083751, 0.0038915], xx);
    s = Math.exp(poly([-0.4803, -0.082676, 0.0030302], xx));
  }
  return { W, p: normSf((y - mu) / s) };
}

export function dagostinoPearson(xIn: number[]): { K2: number; p: number; skewZ: number; kurtZ: number; skew: number; kurt: number } {
  const x = clean(xIn);
  const n = x.length;
  if (n < 8) return { K2: NaN, p: NaN, skewZ: NaN, kurtZ: NaN, skew: NaN, kurt: NaN };
  const m = mean(x);
  let m2 = 0, m3 = 0, m4 = 0;
  for (const v of x) {
    const d = v - m;
    m2 += d * d; m3 += d * d * d; m4 += d * d * d * d;
  }
  m2 /= n; m3 /= n; m4 /= n;
  const b1 = m3 / Math.pow(m2, 1.5);
  const b2 = m4 / (m2 * m2);
  // Skewness test
  let y = b1 * Math.sqrt(((n + 1) * (n + 3)) / (6 * (n - 2)));
  const beta2 = (3 * (n * n + 27 * n - 70) * (n + 1) * (n + 3)) / ((n - 2) * (n + 5) * (n + 7) * (n + 9));
  const W2 = -1 + Math.sqrt(2 * (beta2 - 1));
  const delta = 1 / Math.sqrt(0.5 * Math.log(W2));
  const alpha = Math.sqrt(2 / (W2 - 1));
  if (y === 0) y = 1;
  const Zs = delta * Math.log(y / alpha + Math.sqrt((y / alpha) ** 2 + 1));
  // Kurtosis test
  const E = (3 * (n - 1)) / (n + 1);
  const varb2 = (24 * n * (n - 2) * (n - 3)) / ((n + 1) * (n + 1) * (n + 3) * (n + 5));
  const xk = (b2 - E) / Math.sqrt(varb2);
  const sqrtbeta1 = ((6 * (n * n - 5 * n + 2)) / ((n + 7) * (n + 9))) * Math.sqrt((6 * (n + 3) * (n + 5)) / (n * (n - 2) * (n - 3)));
  const A = 6 + (8 / sqrtbeta1) * (2 / sqrtbeta1 + Math.sqrt(1 + 4 / (sqrtbeta1 * sqrtbeta1)));
  const term1 = 1 - 2 / (9 * A);
  const denom = 1 + xk * Math.sqrt(2 / (A - 4));
  const term2 = Math.sign(denom) * Math.cbrt((1 - 2 / A) / Math.abs(denom));
  const Zk = (term1 - term2) / Math.sqrt(2 / (9 * A));
  const K2 = Zs * Zs + Zk * Zk;
  return { K2, p: chi2Sf(K2, 2), skewZ: Zs, kurtZ: Zk, skew: b1, kurt: b2 - 3 };
}

/** Kolmogorov-Smirnov normality test with the Dallal-Wilkinson-Lilliefors P value. */
export function ksNormality(xIn: number[]): { D: number; p: number; pText: string } {
  const x = sortNum(clean(xIn));
  const n = x.length;
  if (n < 5) return { D: NaN, p: NaN, pText: 'n too small' };
  const m = mean(x), s = sd(x);
  let D = 0;
  for (let i = 0; i < n; i++) {
    const F = normCdf((x[i] - m) / s);
    D = Math.max(D, (i + 1) / n - F, F - i / n);
  }
  let nn = n, DD = D;
  if (n > 100) {
    DD = D * Math.pow(n / 100, 0.49);
    nn = 100;
  }
  let p = Math.exp(-7.01256 * DD * DD * (nn + 2.78019) + 2.99587 * DD * Math.sqrt(nn + 2.78019) - 0.122119 + 0.974598 / Math.sqrt(nn) + 1.67997 / nn);
  let pText = formatP(p);
  if (p > 0.1) {
    p = Math.min(1, p);
    pText = '>0.1000';
  }
  return { D, p, pText };
}

// ---------------- Correlation ----------------
export interface CorrelationResult {
  r: number;
  r2: number;
  p: number;
  n: number;
  ciLo: number;
  ciHi: number;
  t: number;
}

export function pearson(xIn: number[], yIn: number[], ciLevel = 0.95): CorrelationResult {
  const x: number[] = [], y: number[] = [];
  for (let i = 0; i < Math.min(xIn.length, yIn.length); i++) {
    if (Number.isFinite(xIn[i]) && Number.isFinite(yIn[i])) {
      x.push(xIn[i]);
      y.push(yIn[i]);
    }
  }
  const n = x.length;
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  const r = Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
  const df = n - 2;
  const t = (r * Math.sqrt(df)) / Math.sqrt(Math.max(1e-300, 1 - r * r));
  const p = Math.abs(r) === 1 ? 0 : tTwoTailP(t, df);
  const z = Math.atanh(r);
  const zc = normInv(1 - (1 - ciLevel) / 2) / Math.sqrt(n - 3);
  return { r, r2: r * r, p, n, ciLo: Math.tanh(z - zc), ciHi: Math.tanh(z + zc), t };
}

export function spearman(xIn: number[], yIn: number[], ciLevel = 0.95): CorrelationResult {
  const x: number[] = [], y: number[] = [];
  for (let i = 0; i < Math.min(xIn.length, yIn.length); i++) {
    if (Number.isFinite(xIn[i]) && Number.isFinite(yIn[i])) {
      x.push(xIn[i]);
      y.push(yIn[i]);
    }
  }
  const res = pearson(rank(x), rank(y));
  const n = res.n;
  // CI using Fisher z with Bonett-Wright standard error
  const z = Math.atanh(res.r);
  const se = Math.sqrt((1 + (res.r * res.r) / 2) / (n - 3));
  const zc = normInv(1 - (1 - ciLevel) / 2);
  return { ...res, ciLo: Math.tanh(z - zc * se), ciHi: Math.tanh(z + zc * se) };
}

// ---------------- Outliers ----------------
export function grubbsCritical(n: number, alpha: number): number {
  const t = tInv(1 - alpha / (2 * n), n - 2);
  return ((n - 1) / Math.sqrt(n)) * Math.sqrt((t * t) / (n - 2 + t * t));
}

/** Iterative Grubbs test. Returns the indices (into the original array) of outliers. */
export function grubbs(values: number[], alpha = 0.05): { outliers: number[]; G: number[] } {
  const idx = values.map((v, i) => i).filter((i) => Number.isFinite(values[i]));
  const outliers: number[] = [];
  const Gs: number[] = [];
  while (idx.length > 2) {
    const v = idx.map((i) => values[i]);
    const m = mean(v), s = sd(v);
    if (!(s > 0)) break;
    let best = 0, bestG = -1;
    for (let k = 0; k < v.length; k++) {
      const g = Math.abs(v[k] - m) / s;
      if (g > bestG) {
        bestG = g;
        best = k;
      }
    }
    if (bestG > grubbsCritical(v.length, alpha)) {
      outliers.push(idx[best]);
      Gs.push(bestG);
      idx.splice(best, 1);
    } else break;
  }
  return { outliers, G: Gs };
}

// ---------------- Multiple comparisons adjustments ----------------
export type PAdjustMethod = 'none' | 'bonferroni' | 'sidak' | 'holm' | 'holm-sidak' | 'bh';

export function adjustP(p: number[], method: PAdjustMethod): number[] {
  const k = p.length;
  if (method === 'none') return [...p];
  if (method === 'bonferroni') return p.map((v) => Math.min(1, v * k));
  if (method === 'sidak') return p.map((v) => 1 - Math.pow(1 - v, k));
  const order = p.map((v, i) => i).sort((a, b) => p[a] - p[b]);
  const adj = new Array(k).fill(0);
  if (method === 'holm' || method === 'holm-sidak') {
    let running = 0;
    order.forEach((i, rankIdx) => {
      const m = k - rankIdx;
      const v = method === 'holm' ? Math.min(1, p[i] * m) : 1 - Math.pow(1 - p[i], m);
      running = Math.max(running, v);
      adj[i] = Math.min(1, running);
    });
    return adj;
  }
  // Benjamini-Hochberg
  let running = 1;
  for (let r = k - 1; r >= 0; r--) {
    const i = order[r];
    running = Math.min(running, (p[i] * k) / (r + 1));
    adj[i] = Math.min(1, running);
  }
  return adj;
}

export function bartlett(groups: Summary[]): { stat: number; df: number; p: number } {
  const k = groups.length;
  const N = sum(groups.map((g) => g.n));
  const sp2 = sum(groups.map((g) => (g.n - 1) * g.sd * g.sd)) / (N - k);
  const num = (N - k) * Math.log(sp2) - sum(groups.map((g) => (g.n - 1) * Math.log(g.sd * g.sd)));
  const den = 1 + (1 / (3 * (k - 1))) * (sum(groups.map((g) => 1 / (g.n - 1))) - 1 / (N - k));
  const stat = num / den;
  return { stat, df: k - 1, p: chi2Sf(stat, k - 1) };
}

/** Brown-Forsythe test for equal variances (Levene on absolute deviations from the median). */
export function brownForsythe(groups: number[][]): { F: number; dfn: number; dfd: number; p: number } {
  const devs = groups.map((g) => {
    const s = sortNum(g);
    const med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    return g.map((v) => Math.abs(v - med));
  });
  const all = devs.flat();
  const gm = mean(all);
  const k = groups.length, N = all.length;
  let ssb = 0, ssw = 0;
  for (const d of devs) {
    const m = mean(d);
    ssb += d.length * (m - gm) ** 2;
    for (const v of d) ssw += (v - m) ** 2;
  }
  const F = ssb / (k - 1) / (ssw / (N - k));
  return { F, dfn: k - 1, dfd: N - k, p: fSf(F, k - 1, N - k) };
}

export { variance };
