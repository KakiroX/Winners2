import { chi2Sf, hypergeomPmf, normInv, normSf, tInv, betaIncInv } from './distributions';
import { clean, mean, sd, sortNum, sum, percentile } from './descriptive';
import { invertM } from './linalg';
import { mannWhitney } from './tests';

// ---------------- Survival ----------------
export interface KMStep {
  time: number;
  atRisk: number;
  events: number;
  censored: number;
  survival: number;
  se: number;
  lo: number;
  hi: number;
}

export interface KMCurve {
  steps: KMStep[];
  censorTimes: { time: number; survival: number }[];
  median: number;
  n: number;
  events: number;
}

export function kaplanMeier(times: number[], events: number[], z = 1.959963984540054): KMCurve {
  const obs = times
    .map((t, i) => ({ t, e: events[i] }))
    .filter((o) => Number.isFinite(o.t) && (o.e === 0 || o.e === 1))
    .sort((a, b) => a.t - b.t || b.e - a.e);
  const n = obs.length;
  let atRisk = n;
  let S = 1;
  let greenwood = 0;
  const steps: KMStep[] = [{ time: 0, atRisk: n, events: 0, censored: 0, survival: 1, se: 0, lo: 1, hi: 1 }];
  const censorTimes: { time: number; survival: number }[] = [];
  let i = 0;
  while (i < n) {
    const t = obs[i].t;
    let d = 0, c = 0;
    while (i < n && obs[i].t === t) {
      if (obs[i].e === 1) d++;
      else c++;
      i++;
    }
    if (d > 0) {
      S *= 1 - d / atRisk;
      if (atRisk - d > 0) greenwood += d / (atRisk * (atRisk - d));
      const se = S * Math.sqrt(greenwood);
      let lo = NaN, hi = NaN;
      if (S > 0 && S < 1) {
        // log-log ("asymmetrical") confidence interval
        const sll = Math.sqrt(greenwood) / Math.abs(Math.log(S));
        lo = Math.pow(S, Math.exp(z * sll));
        hi = Math.pow(S, Math.exp(-z * sll));
      } else if (S === 0) {
        lo = 0;
        hi = 0;
      }
      steps.push({ time: t, atRisk, events: d, censored: c, survival: S, se, lo, hi });
    } else if (steps.length) {
      steps[steps.length - 1].censored += 0;
    }
    if (c > 0) censorTimes.push({ time: t, survival: S });
    atRisk -= d + c;
  }
  // Median survival: first time where survival drops to or below 50%
  let median = NaN;
  for (let k = 1; k < steps.length; k++) {
    if (steps[k].survival < 0.5 - 1e-12) {
      median = steps[k].time;
      break;
    }
    if (Math.abs(steps[k].survival - 0.5) < 1e-12) {
      const next = steps.slice(k + 1).find((s) => s.events > 0);
      median = next ? (steps[k].time + next.time) / 2 : steps[k].time;
      break;
    }
  }
  return { steps, censorTimes, median, n, events: sum(obs.map((o) => o.e)) };
}

export interface LogRankResult {
  chi2: number;
  df: number;
  p: number;
  observed: number[];
  expected: number[];
  gehan: { chi2: number; df: number; p: number };
  trend?: { chi2: number; p: number };
  hrLogrank?: { hr: number; lo: number; hi: number; inverse: number };
  hrMH?: { hr: number; lo: number; hi: number; inverse: number };
}

export function logRank(groups: { times: number[]; events: number[] }[]): LogRankResult {
  const k = groups.length;
  const all: { t: number; e: number; g: number }[] = [];
  groups.forEach((g, gi) => g.times.forEach((t, i) => {
    if (Number.isFinite(t) && (g.events[i] === 0 || g.events[i] === 1)) all.push({ t, e: g.events[i], g: gi });
  }));
  all.sort((a, b) => a.t - b.t);
  const atRisk = groups.map((_, gi) => all.filter((o) => o.g === gi).length);
  const O = new Array(k).fill(0), E = new Array(k).fill(0);
  const V = Array.from({ length: k }, () => new Array(k).fill(0));
  const Ow = new Array(k).fill(0), Ew = new Array(k).fill(0);
  const Vw = Array.from({ length: k }, () => new Array(k).fill(0));
  let i = 0;
  while (i < all.length) {
    const t = all[i].t;
    const d = new Array(k).fill(0), c = new Array(k).fill(0);
    while (i < all.length && all[i].t === t) {
      if (all[i].e) d[all[i].g]++;
      else c[all[i].g]++;
      i++;
    }
    const D = sum(d), N = sum(atRisk);
    if (D > 0 && N > 0) {
      for (let a = 0; a < k; a++) {
        const ea = (D * atRisk[a]) / N;
        O[a] += d[a];
        E[a] += ea;
        Ow[a] += N * d[a];
        Ew[a] += N * ea;
        if (N > 1) {
          for (let b = 0; b < k; b++) {
            const v = ((D * (N - D)) / (N - 1)) * (atRisk[a] / N) * ((a === b ? 1 : 0) - atRisk[b] / N);
            V[a][b] += v;
            Vw[a][b] += N * N * v;
          }
        }
      }
    }
    for (let a = 0; a < k; a++) atRisk[a] -= d[a] + c[a];
  }
  const quad = (o: number[], e: number[], v: number[][]) => {
    const diff = o.slice(0, k - 1).map((x, a) => x - e[a]);
    const vm = v.slice(0, k - 1).map((r) => r.slice(0, k - 1));
    const inv = invertM(vm);
    if (!inv) return NaN;
    let s = 0;
    for (let a = 0; a < k - 1; a++) for (let b = 0; b < k - 1; b++) s += diff[a] * inv[a][b] * diff[b];
    return s;
  };
  const chi2 = quad(O, E, V);
  const gchi2 = quad(Ow, Ew, Vw);
  const res: LogRankResult = {
    chi2, df: k - 1, p: chi2Sf(chi2, k - 1), observed: O, expected: E,
    gehan: { chi2: gchi2, df: k - 1, p: chi2Sf(gchi2, k - 1) },
  };
  if (k > 2) {
    // Logrank test for trend with scores 1..k
    const scores = groups.map((_, a) => a + 1);
    const U = sum(scores.map((s, a) => s * (O[a] - E[a])));
    let varU = 0;
    for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) varU += scores[a] * scores[b] * V[a][b];
    const ct = (U * U) / varU;
    res.trend = { chi2: ct, p: chi2Sf(ct, 1) };
  }
  if (k === 2) {
    const z = 1.959963984540054;
    const hr = O[0] / E[0] / (O[1] / E[1]);
    const seL = Math.sqrt(1 / E[0] + 1 / E[1]);
    res.hrLogrank = { hr, lo: Math.exp(Math.log(hr) - z * seL), hi: Math.exp(Math.log(hr) + z * seL), inverse: 1 / hr };
    const v = V[0][0];
    const lhr = (O[0] - E[0]) / v;
    res.hrMH = { hr: Math.exp(lhr), lo: Math.exp(lhr - z / Math.sqrt(v)), hi: Math.exp(lhr + z / Math.sqrt(v)), inverse: Math.exp(-lhr) };
  }
  return res;
}

// ---------------- Contingency ----------------
export function chiSquare(table: number[][], yates = false) {
  const r = table.length, c = table[0]?.length ?? 0;
  const rowT = table.map((row) => sum(row));
  const colT = Array.from({ length: c }, (_, j) => sum(table.map((row) => row[j])));
  const N = sum(rowT);
  let x2 = 0;
  let minExpected = Infinity;
  for (let i = 0; i < r; i++)
    for (let j = 0; j < c; j++) {
      const e = (rowT[i] * colT[j]) / N;
      minExpected = Math.min(minExpected, e);
      const d = Math.abs(table[i][j] - e) - (yates && r === 2 && c === 2 ? 0.5 : 0);
      x2 += (Math.max(0, d) ** 2) / e;
    }
  const df = (r - 1) * (c - 1);
  return { chi2: x2, df, p: chi2Sf(x2, df), N, minExpected, rowTotals: rowT, colTotals: colT };
}

export function chiSquareTrend(table: number[][]) {
  // Cochran-Armitage test for trend (rows = ordered groups, 2 outcome columns)
  const r = table.length;
  const n = table.map((row) => row[0] + row[1]);
  const N = sum(n);
  const R = sum(table.map((row) => row[0]));
  const p = R / N;
  const s = table.map((_, i) => i + 1);
  const T = sum(table.map((row, i) => s[i] * (row[0] - n[i] * p)));
  const varT = p * (1 - p) * (sum(n.map((ni, i) => ni * s[i] * s[i])) - sum(n.map((ni, i) => ni * s[i])) ** 2 / N);
  const chi2 = (T * T) / varT;
  void r;
  return { chi2, p: chi2Sf(chi2, 1) };
}

/** Two-sided Fisher's exact test for a 2x2 table. */
export function fisherExact(t: number[][]) {
  const [[a, b], [c, d]] = t;
  const r1 = a + b, c1 = a + c, N = a + b + c + d;
  const lo = Math.max(0, c1 - (N - r1)), hi = Math.min(r1, c1);
  const pObs = hypergeomPmf(a, N, c1, r1);
  let p = 0;
  for (let k = lo; k <= hi; k++) {
    const pk = hypergeomPmf(k, N, c1, r1);
    if (pk <= pObs * (1 + 1e-7)) p += pk;
  }
  let pLess = 0, pGreater = 0;
  for (let k = lo; k <= a; k++) pLess += hypergeomPmf(k, N, c1, r1);
  for (let k = a; k <= hi; k++) pGreater += hypergeomPmf(k, N, c1, r1);
  return { p: Math.min(1, p), pLess: Math.min(1, pLess), pGreater: Math.min(1, pGreater) };
}

export function twoByTwo(t: number[][], z = 1.959963984540054) {
  const [[a, b], [c, d]] = t.map((r) => r.map(Number));
  const p1 = a / (a + b), p2 = c / (c + d);
  const rr = p1 / p2;
  const seLogRR = Math.sqrt(1 / a - 1 / (a + b) + 1 / c - 1 / (c + d));
  const or = (a * d) / (b * c);
  const seLogOR = Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d);
  const diff = p1 - p2;
  const seDiff = Math.sqrt((p1 * (1 - p1)) / (a + b) + (p2 * (1 - p2)) / (c + d));
  return {
    relativeRisk: { value: rr, lo: Math.exp(Math.log(rr) - z * seLogRR), hi: Math.exp(Math.log(rr) + z * seLogRR) },
    oddsRatio: { value: or, lo: Math.exp(Math.log(or) - z * seLogOR), hi: Math.exp(Math.log(or) + z * seLogOR) },
    attributableRisk: { value: diff, lo: diff - z * seDiff, hi: diff + z * seDiff },
    nnt: 1 / Math.abs(diff),
    sensitivity: a / (a + c),
    specificity: d / (b + d),
    ppv: a / (a + b),
    npv: d / (c + d),
    lrPositive: a / (a + c) / (1 - d / (b + d)),
    p1, p2,
  };
}

/** Exact (Clopper-Pearson) binomial confidence interval. */
export function clopperPearson(k: number, n: number, level = 0.95) {
  const alpha = 1 - level;
  const lo = k === 0 ? 0 : betaIncInv(alpha / 2, k, n - k + 1);
  const hi = k === n ? 1 : betaIncInv(1 - alpha / 2, k + 1, n - k);
  return [lo, hi] as [number, number];
}

// ---------------- ROC ----------------
export function rocCurve(controlsIn: number[], patientsIn: number[], higherInPatients = true) {
  const controls = clean(controlsIn), patients = clean(patientsIn);
  const vals = sortNum([...new Set([...controls, ...patients])]);
  const cut: number[] = [];
  cut.push(vals[0] - 1);
  for (let i = 0; i < vals.length - 1; i++) cut.push((vals[i] + vals[i + 1]) / 2);
  cut.push(vals[vals.length - 1] + 1);
  const points = cut.map((c) => {
    const tp = patients.filter((v) => (higherInPatients ? v > c : v < c)).length;
    const tn = controls.filter((v) => (higherInPatients ? v < c : v > c)).length;
    const sens = tp / patients.length, spec = tn / controls.length;
    const sci = clopperPearson(tp, patients.length), spci = clopperPearson(tn, controls.length);
    return { cutoff: c, sensitivity: 100 * sens, specificity: 100 * spec, sensLo: 100 * sci[0], sensHi: 100 * sci[1], specLo: 100 * spci[0], specHi: 100 * spci[1], lr: sens / (1 - spec) };
  });
  const mw = mannWhitney(controls, patients);
  let auc = mw.U1 / (controls.length * patients.length);
  if (!higherInPatients) auc = 1 - auc;
  const np = patients.length, nc = controls.length;
  const q1 = auc / (2 - auc), q2 = (2 * auc * auc) / (1 + auc);
  const se = Math.sqrt((auc * (1 - auc) + (np - 1) * (q1 - auc * auc) + (nc - 1) * (q2 - auc * auc)) / (np * nc));
  const z = (auc - 0.5) / se;
  return { points, auc, se, ciLo: Math.max(0, auc - 1.96 * se), ciHi: Math.min(1, auc + 1.96 * se), p: 2 * normSf(Math.abs(z)), nControls: nc, nPatients: np };
}

// ---------------- Bland-Altman ----------------
export function blandAltman(a: number[], b: number[], mode: 'difference' | 'ratio' | 'percent' = 'difference') {
  const pairs: { avg: number; diff: number }[] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) continue;
    const avg = (a[i] + b[i]) / 2;
    const diff = mode === 'ratio' ? a[i] / b[i] : mode === 'percent' ? (100 * (a[i] - b[i])) / avg : a[i] - b[i];
    pairs.push({ avg, diff });
  }
  const diffs = pairs.map((p) => p.diff);
  const bias = mean(diffs), s = sd(diffs);
  return { pairs, bias, sd: s, loaLo: bias - 1.96 * s, loaHi: bias + 1.96 * s, n: pairs.length };
}

// ---------------- Frequency distribution ----------------
export function niceBinWidth(values: number[]): number {
  const x = sortNum(clean(values));
  const n = x.length;
  if (n < 2) return 1;
  const iqr = percentile(x, 0.75) - percentile(x, 0.25);
  let h = (2 * iqr) / Math.cbrt(n);
  if (!(h > 0)) h = (x[n - 1] - x[0]) / Math.max(1, Math.ceil(Math.log2(n) + 1));
  if (!(h > 0)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(h)));
  const r = h / mag;
  const nice = r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10;
  return nice * mag;
}

export function frequencyDistribution(values: number[], opts: { binWidth?: number; binStart?: number; cumulative?: boolean; relative?: 'counts' | 'fraction' | 'percent' } = {}) {
  const x = clean(values);
  const w = opts.binWidth && opts.binWidth > 0 ? opts.binWidth : niceBinWidth(x);
  const min = Math.min(...x), max = Math.max(...x);
  const start = opts.binStart ?? Math.floor(min / w) * w;
  const nb = Math.max(1, Math.floor((max - start) / w) + 1);
  const counts = new Array(nb).fill(0);
  for (const v of x) {
    const b = Math.min(nb - 1, Math.floor((v - start) / w + 1e-12));
    counts[b]++;
  }
  let vals = counts.map((c) => c);
  if (opts.cumulative) {
    let s = 0;
    vals = vals.map((c) => (s += c));
  }
  if (opts.relative === 'fraction') vals = vals.map((c) => c / x.length);
  if (opts.relative === 'percent') vals = vals.map((c) => (100 * c) / x.length);
  return { centers: counts.map((_, i) => start + w * (i + 0.5)), lower: counts.map((_, i) => start + w * i), values: vals, binWidth: w, n: x.length };
}

// ---------------- Area under curve ----------------
export function areaUnderCurve(x: number[], y: number[], baseline = 0) {
  const pts = x.map((xv, i) => ({ x: xv, y: y[i] })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).sort((a, b) => a.x - b.x);
  let total = 0, pos = 0, neg = 0;
  let peaks = 0;
  for (let i = 1; i < pts.length; i++) {
    const x0 = pts[i - 1].x, x1 = pts[i].x;
    const y0 = pts[i - 1].y - baseline, y1 = pts[i].y - baseline;
    const area = ((y0 + y1) / 2) * (x1 - x0);
    total += area;
    if (y0 >= 0 && y1 >= 0) pos += area;
    else if (y0 <= 0 && y1 <= 0) neg += area;
    else {
      const xc = x0 + ((x1 - x0) * Math.abs(y0)) / (Math.abs(y0) + Math.abs(y1));
      const a1 = (y0 / 2) * (xc - x0), a2 = (y1 / 2) * (x1 - xc);
      if (a1 > 0) pos += a1;
      else neg += a1;
      if (a2 > 0) pos += a2;
      else neg += a2;
    }
  }
  let peakX = NaN, peakY = -Infinity;
  for (const p of pts) if (p.y > peakY) {
    peakY = p.y;
    peakX = p.x;
  }
  for (let i = 1; i < pts.length - 1; i++) if (pts[i].y > pts[i - 1].y && pts[i].y > pts[i + 1].y && pts[i].y > baseline) peaks++;
  return { total, positive: pos, negative: neg, peakX, peakY, peaks, n: pts.length };
}

export function binomialTest(k: number, n: number, p0 = 0.5) {
  // two-sided exact binomial test (method of small P values)
  const pmf = (i: number) => Math.exp(lgammaLocal(n + 1) - lgammaLocal(i + 1) - lgammaLocal(n - i + 1) + i * Math.log(p0) + (n - i) * Math.log(1 - p0));
  const pobs = pmf(k);
  let p = 0;
  for (let i = 0; i <= n; i++) {
    const pi = pmf(i);
    if (pi <= pobs * (1 + 1e-7)) p += pi;
  }
  return Math.min(1, p);
}

function lgammaLocal(x: number) {
  let s = 0;
  for (let i = 2; i < x; i++) s += Math.log(i);
  return s;
}

export function zCritical(level = 0.95) {
  return normInv(1 - (1 - level) / 2);
}

export function tCritical(df: number, level = 0.95) {
  return tInv(1 - (1 - level) / 2, df);
}
