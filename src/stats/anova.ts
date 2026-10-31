import { chi2Sf, dunnettCdf, dunnettCritical, fSf, normSf, ptukey, qtukey, tInv, tTwoTailP } from './distributions';
import { mean, rank, sum, tieGroups } from './descriptive';
import { ols, olsSSE, type Mat } from './linalg';
import { adjustP, bartlett, brownForsythe, pSummary, type Summary } from './tests';

export type PostHocMethod = 'tukey' | 'bonferroni' | 'sidak' | 'holm-sidak' | 'dunnett' | 'fisher' | 'games-howell' | 'none';

export interface Comparison {
  a: string;
  b: string;
  i: number;
  j: number;
  diff: number;
  ciLo: number;
  ciHi: number;
  statistic: number;
  statName: string;
  df: number;
  p: number;
  pRaw?: number;
  significant: boolean;
  summary: string;
}

export interface AnovaRow {
  source: string;
  ss: number;
  df: number;
  ms: number;
  F?: number;
  p?: number;
  pctTotal?: number;
}

/** Pairwise comparisons from group summaries using a pooled error term. */
export function postHoc(
  groups: Summary[],
  names: string[],
  method: PostHocMethod,
  mse: number,
  dfe: number,
  opts: { control?: number; alpha?: number; pairs?: [number, number][] } = {},
): Comparison[] {
  const alpha = opts.alpha ?? 0.05;
  const k = groups.length;
  if (method === 'none' || k < 2) return [];
  let pairs: [number, number][] = [];
  if (opts.pairs) pairs = opts.pairs;
  else if (method === 'dunnett') {
    const c = opts.control ?? 0;
    for (let j = 0; j < k; j++) if (j !== c) pairs.push([c, j]);
  } else for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) pairs.push([i, j]);
  const m = pairs.length;
  const out: Comparison[] = [];

  if (method === 'games-howell') {
    for (const [i, j] of pairs) {
      const gi = groups[i], gj = groups[j];
      const vi = (gi.sd * gi.sd) / gi.n, vj = (gj.sd * gj.sd) / gj.n;
      const se = Math.sqrt((vi + vj) / 2);
      const df = (vi + vj) ** 2 / ((vi * vi) / (gi.n - 1) + (vj * vj) / (gj.n - 1));
      const diff = gi.mean - gj.mean;
      const q = Math.abs(diff) / se;
      const p = Math.max(0, 1 - ptukey(q, k, df));
      const qc = qtukey(1 - alpha, k, df);
      out.push(mk(i, j, diff, diff - qc * se, diff + qc * se, q, 'q', df, p));
    }
    return out;
  }

  const lambdas = method === 'dunnett' ? pairs.map(([c, j]) => Math.sqrt(groups[j].n / (groups[j].n + groups[c].n))) : [];
  const dCrit = method === 'dunnett' ? dunnettCritical(alpha, lambdas, dfe) : 0;
  const qCrit = method === 'tukey' ? qtukey(1 - alpha, k, dfe) : 0;
  const rawPs: number[] = [];
  for (const [i, j] of pairs) {
    const gi = groups[i], gj = groups[j];
    const diff = gi.mean - gj.mean;
    const se = Math.sqrt(mse * (1 / gi.n + 1 / gj.n));
    const t = diff / se;
    const pRaw = tTwoTailP(t, dfe);
    rawPs.push(pRaw);
    let p = pRaw, lo = NaN, hi = NaN, stat = t, statName = 't';
    switch (method) {
      case 'tukey': {
        const q = Math.abs(diff) / (se / Math.SQRT2);
        stat = q;
        statName = 'q';
        p = Math.max(0, 1 - ptukey(q, k, dfe));
        lo = diff - (qCrit * se) / Math.SQRT2;
        hi = diff + (qCrit * se) / Math.SQRT2;
        break;
      }
      case 'bonferroni': {
        p = Math.min(1, pRaw * m);
        const tc = tInv(1 - alpha / (2 * m), dfe);
        lo = diff - tc * se;
        hi = diff + tc * se;
        break;
      }
      case 'sidak': {
        p = 1 - Math.pow(1 - pRaw, m);
        const a1 = 1 - Math.pow(1 - alpha, 1 / m);
        const tc = tInv(1 - a1 / 2, dfe);
        lo = diff - tc * se;
        hi = diff + tc * se;
        break;
      }
      case 'fisher': {
        const tc = tInv(1 - alpha / 2, dfe);
        lo = diff - tc * se;
        hi = diff + tc * se;
        break;
      }
      case 'dunnett': {
        const idx = rawPs.length - 1;
        p = Math.max(0, 1 - dunnettCdf(Math.abs(t), lambdas, dfe));
        lo = diff - dCrit * se;
        hi = diff + dCrit * se;
        void idx;
        break;
      }
      case 'holm-sidak':
        break;
    }
    const c = mk(i, j, diff, lo, hi, Math.abs(stat), statName, dfe, p);
    c.pRaw = pRaw;
    out.push(c);
  }
  if (method === 'holm-sidak') {
    const adj = adjustP(rawPs, 'holm-sidak');
    out.forEach((c, idx) => {
      c.p = adj[idx];
      c.significant = c.p < alpha;
      c.summary = pSummary(c.p);
    });
  }
  return out;

  function mk(i: number, j: number, diff: number, lo: number, hi: number, stat: number, statName: string, df: number, p: number): Comparison {
    return { a: names[i], b: names[j], i, j, diff, ciLo: lo, ciHi: hi, statistic: stat, statName, df, p, significant: p < alpha, summary: pSummary(p) };
  }
}

export interface OneWayResult {
  table: AnovaRow[];
  F: number;
  p: number;
  r2: number;
  dfn: number;
  dfd: number;
  mse: number;
  bartlett?: { stat: number; df: number; p: number };
  brownForsythe?: { F: number; dfn: number; dfd: number; p: number };
  comparisons: Comparison[];
  groups: Summary[];
}

export function oneWayAnova(
  groups: Summary[],
  names: string[],
  method: PostHocMethod = 'tukey',
  raw?: number[][],
  opts: { control?: number; alpha?: number } = {},
): OneWayResult {
  const k = groups.length;
  const N = sum(groups.map((g) => g.n));
  const gm = sum(groups.map((g) => g.n * g.mean)) / N;
  const ssb = sum(groups.map((g) => g.n * (g.mean - gm) ** 2));
  const ssw = sum(groups.map((g) => (g.n - 1) * g.sd * g.sd));
  const dfb = k - 1, dfw = N - k;
  const msb = ssb / dfb, msw = ssw / dfw;
  const F = msb / msw;
  const p = fSf(F, dfb, dfw);
  const table: AnovaRow[] = [
    { source: 'Treatment (between columns)', ss: ssb, df: dfb, ms: msb, F, p },
    { source: 'Residual (within columns)', ss: ssw, df: dfw, ms: msw },
    { source: 'Total', ss: ssb + ssw, df: N - 1, ms: NaN },
  ];
  const res: OneWayResult = {
    table, F, p, r2: ssb / (ssb + ssw), dfn: dfb, dfd: dfw, mse: msw, groups,
    comparisons: postHoc(groups, names, method, msw, dfw, opts),
  };
  if (groups.every((g) => g.n > 1 && g.sd > 0)) res.bartlett = bartlett(groups);
  if (raw && raw.every((g) => g.length > 1)) res.brownForsythe = brownForsythe(raw);
  return res;
}

export function welchAnova(groups: Summary[]): { F: number; dfn: number; dfd: number; p: number } {
  const k = groups.length;
  const w = groups.map((g) => g.n / (g.sd * g.sd));
  const W = sum(w);
  const mw = sum(groups.map((g, i) => w[i] * g.mean)) / W;
  const A = sum(groups.map((g, i) => w[i] * (g.mean - mw) ** 2)) / (k - 1);
  const lam = sum(groups.map((g, i) => (1 - w[i] / W) ** 2 / (g.n - 1)));
  const B = 1 + ((2 * (k - 2)) / (k * k - 1)) * lam;
  const F = A / B;
  const dfd = (k * k - 1) / (3 * lam);
  return { F, dfn: k - 1, dfd, p: fSf(F, k - 1, dfd) };
}

export function brownForsytheAnova(groups: Summary[]): { F: number; dfn: number; dfd: number; p: number } {
  const k = groups.length;
  const N = sum(groups.map((g) => g.n));
  const gm = sum(groups.map((g) => g.n * g.mean)) / N;
  const num = sum(groups.map((g) => g.n * (g.mean - gm) ** 2));
  const denTerms = groups.map((g) => (1 - g.n / N) * g.sd * g.sd);
  const den = sum(denTerms);
  const F = num / den;
  const c = denTerms.map((t) => t / den);
  const dfd = 1 / sum(c.map((ci, i) => (ci * ci) / (groups[i].n - 1)));
  return { F, dfn: k - 1, dfd, p: fSf(F, k - 1, dfd) };
}

export interface RMResult {
  table: AnovaRow[];
  F: number;
  p: number;
  pGG: number;
  epsilon: number;
  dfn: number;
  dfd: number;
  mse: number;
  r2: number;
  matchingF: number;
  matchingP: number;
  comparisons: Comparison[];
  n: number;
}

/** Repeated-measures one-way ANOVA. `data[subject][treatment]`, complete rows only. */
export function repeatedMeasuresAnova(data: number[][], names: string[], method: PostHocMethod = 'tukey', opts: { control?: number; alpha?: number } = {}): RMResult {
  const rows = data.filter((r) => r.every((v) => Number.isFinite(v)));
  const n = rows.length, k = names.length;
  const all = rows.flat();
  const gm = mean(all);
  const colMeans = names.map((_, j) => mean(rows.map((r) => r[j])));
  const rowMeans = rows.map((r) => mean(r));
  const sst = sum(all.map((v) => (v - gm) ** 2));
  const sstr = n * sum(colMeans.map((m) => (m - gm) ** 2));
  const sss = k * sum(rowMeans.map((m) => (m - gm) ** 2));
  const ssr = sst - sstr - sss;
  const dft = k - 1, dfs = n - 1, dfr = (n - 1) * (k - 1);
  const mst = sstr / dft, mss = sss / dfs, msr = ssr / dfr;
  const F = mst / msr;
  const p = fSf(F, dft, dfr);
  // Greenhouse-Geisser epsilon from the double-centred covariance matrix
  const cov: Mat = names.map(() => new Array(k).fill(0));
  for (let a = 0; a < k; a++)
    for (let b = 0; b < k; b++) {
      let s = 0;
      for (const r of rows) s += (r[a] - colMeans[a]) * (r[b] - colMeans[b]);
      cov[a][b] = s / (n - 1);
    }
  const rowAvg = cov.map((r) => mean(r));
  const totAvg = mean(rowAvg);
  let trace = 0, sumsq = 0;
  for (let a = 0; a < k; a++)
    for (let b = 0; b < k; b++) {
      const v = cov[a][b] - rowAvg[a] - rowAvg[b] + totAvg;
      if (a === b) trace += v;
      sumsq += v * v;
    }
  let epsilon = (trace * trace) / ((k - 1) * sumsq);
  epsilon = Math.max(1 / (k - 1), Math.min(1, epsilon));
  const pGG = fSf(F, dft * epsilon, dfr * epsilon);
  const groups: Summary[] = colMeans.map((m, j) => ({ n, mean: m, sd: Math.sqrt(sum(rows.map((r) => (r[j] - m) ** 2)) / (n - 1)) }));
  return {
    table: [
      { source: 'Treatment (between columns)', ss: sstr, df: dft, ms: mst, F, p },
      { source: 'Individual (between rows)', ss: sss, df: dfs, ms: mss, F: mss / msr, p: fSf(mss / msr, dfs, dfr) },
      { source: 'Residual (random)', ss: ssr, df: dfr, ms: msr },
      { source: 'Total', ss: sst, df: n * k - 1, ms: NaN },
    ],
    F, p, pGG, epsilon, dfn: dft, dfd: dfr, mse: msr, r2: sstr / (sstr + ssr),
    matchingF: mss / msr, matchingP: fSf(mss / msr, dfs, dfr),
    comparisons: postHoc(groups, names, method, msr, dfr, opts), n,
  };
}

export interface RankComparison extends Comparison {
  meanRankDiff: number;
}

export function kruskalWallis(groupsIn: number[][], names: string[], opts: { dunn?: boolean; alpha?: number; control?: number } = {}) {
  const alpha = opts.alpha ?? 0.05;
  const groups = groupsIn.map((g) => g.filter(Number.isFinite));
  const all = groups.flat();
  const N = all.length;
  const r = rank(all);
  let idx = 0;
  const rankSums: number[] = [];
  const meanRanks: number[] = [];
  for (const g of groups) {
    const rs = sum(r.slice(idx, idx + g.length));
    idx += g.length;
    rankSums.push(rs);
    meanRanks.push(rs / g.length);
  }
  let H = (12 / (N * (N + 1))) * sum(groups.map((g, i) => (rankSums[i] * rankSums[i]) / g.length)) - 3 * (N + 1);
  const ties = tieGroups(all);
  const tieCorr = 1 - sum(ties.map((t) => t ** 3 - t)) / (N ** 3 - N);
  H /= tieCorr;
  const df = groups.length - 1;
  const p = chi2Sf(H, df);
  const comparisons: RankComparison[] = [];
  if (opts.dunn !== false) {
    const tieTerm = sum(ties.map((t) => t ** 3 - t)) / (12 * (N - 1));
    const pairs: [number, number][] = [];
    if (opts.control !== undefined) {
      for (let j = 0; j < groups.length; j++) if (j !== opts.control) pairs.push([opts.control, j]);
    } else for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) pairs.push([i, j]);
    for (const [i, j] of pairs) {
      const se = Math.sqrt(((N * (N + 1)) / 12 - tieTerm) * (1 / groups[i].length + 1 / groups[j].length));
      const d = meanRanks[i] - meanRanks[j];
      const z = Math.abs(d) / se;
      const pRaw = 2 * normSf(z);
      const pAdj = Math.min(1, pRaw * pairs.length);
      comparisons.push({ a: names[i], b: names[j], i, j, diff: d, meanRankDiff: d, ciLo: NaN, ciHi: NaN, statistic: z, statName: 'Z', df: NaN, p: pAdj, pRaw, significant: pAdj < alpha, summary: pSummary(pAdj) });
    }
  }
  return { H, df, p, N, rankSums, meanRanks, comparisons, n: groups.map((g) => g.length) };
}

export function friedman(data: number[][], names: string[], opts: { dunn?: boolean; alpha?: number; control?: number } = {}) {
  const alpha = opts.alpha ?? 0.05;
  const rows = data.filter((r) => r.every((v) => Number.isFinite(v)));
  const n = rows.length, k = names.length;
  const rankSums = new Array(k).fill(0);
  let tieSum = 0;
  for (const r of rows) {
    const rr = rank(r);
    rr.forEach((v, j) => (rankSums[j] += v));
    tieSum += sum(tieGroups(r).map((t) => t ** 3 - t));
  }
  let Q = (12 / (n * k * (k + 1))) * sum(rankSums.map((R) => R * R)) - 3 * n * (k + 1);
  const corr = 1 - tieSum / (n * (k ** 3 - k));
  if (corr > 0) Q /= corr;
  const df = k - 1;
  const p = chi2Sf(Q, df);
  const comparisons: RankComparison[] = [];
  if (opts.dunn !== false) {
    const pairs: [number, number][] = [];
    if (opts.control !== undefined) {
      for (let j = 0; j < k; j++) if (j !== opts.control) pairs.push([opts.control, j]);
    } else for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) pairs.push([i, j]);
    const se = Math.sqrt((n * k * (k + 1)) / 6);
    for (const [i, j] of pairs) {
      const d = rankSums[i] - rankSums[j];
      const z = Math.abs(d) / se;
      const pRaw = 2 * normSf(z);
      const pAdj = Math.min(1, pRaw * pairs.length);
      comparisons.push({ a: names[i], b: names[j], i, j, diff: d, meanRankDiff: d / n, ciLo: NaN, ciHi: NaN, statistic: z, statName: 'Z', df: NaN, p: pAdj, pRaw, significant: pAdj < alpha, summary: pSummary(pAdj) });
    }
  }
  return { Q, df, p, n, rankSums, comparisons };
}

// ---------------- Two-way ANOVA ----------------
export interface TwoWayResult {
  table: AnovaRow[];
  interaction: boolean;
  mse: number;
  dfe: number;
  cellMeans: number[][];
  cellN: number[][];
  comparisons: { row: string; comparisons: Comparison[] }[];
  columnComparisons: Comparison[];
  rowComparisons: Comparison[];
  warnings: string[];
}

function effectCode(level: number, L: number): number[] {
  const v = new Array(L - 1).fill(0);
  if (level === L - 1) v.fill(-1);
  else v[level] = 1;
  return v;
}

/**
 * Ordinary two-way ANOVA with Type III sums of squares (effect coding, regression approach).
 * cells[row][col] = replicate values. Row factor = rows of a grouped table, column factor = data sets.
 */
export function twoWayAnova(
  cells: number[][][],
  rowNames: string[],
  colNames: string[],
  method: PostHocMethod = 'tukey',
  opts: { alpha?: number; compare?: 'withinRows' | 'columnMeans' | 'rowMeans' | 'all' } = {},
): TwoWayResult {
  const a = rowNames.length, b = colNames.length;
  const warnings: string[] = [];
  const y: number[] = [];
  const rowsA: number[] = [];
  const colsB: number[] = [];
  const cellN = rowNames.map(() => new Array(b).fill(0));
  const cellSum = rowNames.map(() => new Array(b).fill(0));
  for (let i = 0; i < a; i++)
    for (let j = 0; j < b; j++)
      for (const v of cells[i]?.[j] ?? []) {
        if (!Number.isFinite(v)) continue;
        y.push(v);
        rowsA.push(i);
        colsB.push(j);
        cellN[i][j]++;
        cellSum[i][j] += v;
      }
  const N = y.length;
  const cellMeans = cellSum.map((r, i) => r.map((s, j) => (cellN[i][j] ? s / cellN[i][j] : NaN)));
  const emptyCells = cellN.flat().filter((c) => c === 0).length;
  const maxRep = Math.max(...cellN.flat());
  const interaction = maxRep > 1 && emptyCells === 0;
  if (emptyCells) warnings.push('Some cells are empty, so the interaction cannot be estimated; fitted main effects only.');
  if (maxRep <= 1) warnings.push('Only one value per cell: the interaction is used as the residual (additive model).');

  const build = (useA: boolean, useB: boolean, useAB: boolean): Mat =>
    y.map((_, n) => {
      const row = [1];
      const ea = effectCode(rowsA[n], a), eb = effectCode(colsB[n], b);
      if (useA) row.push(...ea);
      if (useB) row.push(...eb);
      if (useAB) for (const u of ea) for (const v of eb) row.push(u * v);
      return row;
    });
  const sseFull = olsSSE(build(true, true, interaction), y);
  const dfe = N - (1 + (a - 1) + (b - 1) + (interaction ? (a - 1) * (b - 1) : 0));
  const mse = sseFull / dfe;
  const gm = mean(y);
  const sst = sum(y.map((v) => (v - gm) ** 2));
  const ssA = olsSSE(build(false, true, interaction), y) - sseFull;
  const ssB = olsSSE(build(true, false, interaction), y) - sseFull;
  const table: AnovaRow[] = [];
  if (interaction) {
    const ssAB = olsSSE(build(true, true, false), y) - sseFull;
    const dfAB = (a - 1) * (b - 1);
    table.push({ source: 'Interaction', ss: ssAB, df: dfAB, ms: ssAB / dfAB, F: ssAB / dfAB / mse, p: fSf(ssAB / dfAB / mse, dfAB, dfe), pctTotal: (100 * ssAB) / sst });
  }
  table.push({ source: 'Row Factor', ss: ssA, df: a - 1, ms: ssA / (a - 1), F: ssA / (a - 1) / mse, p: fSf(ssA / (a - 1) / mse, a - 1, dfe), pctTotal: (100 * ssA) / sst });
  table.push({ source: 'Column Factor', ss: ssB, df: b - 1, ms: ssB / (b - 1), F: ssB / (b - 1) / mse, p: fSf(ssB / (b - 1) / mse, b - 1, dfe), pctTotal: (100 * ssB) / sst });
  table.push({ source: 'Residual', ss: sseFull, df: dfe, ms: mse });
  table.push({ source: 'Total', ss: sst, df: N - 1, ms: NaN });

  const comparisons: { row: string; comparisons: Comparison[] }[] = [];
  const compare = opts.compare ?? 'withinRows';
  const m = method === 'dunnett' || method === 'games-howell' ? method : method;
  if ((compare === 'withinRows' || compare === 'all') && b > 1) {
    for (let i = 0; i < a; i++) {
      const groups: Summary[] = colNames.map((_, j) => ({ n: cellN[i][j], mean: cellMeans[i][j], sd: NaN }));
      if (groups.some((g) => g.n === 0)) continue;
      const mm: PostHocMethod = m === 'tukey' && b === 2 ? 'sidak' : m;
      comparisons.push({ row: rowNames[i], comparisons: postHoc(groups, colNames, mm, mse, dfe, { alpha: opts.alpha }) });
    }
  }
  // Main effect comparisons use marginal (unweighted) means
  const colGroups: Summary[] = colNames.map((_, j) => {
    const ms = rowNames.map((_, i) => cellMeans[i][j]).filter(Number.isFinite);
    const ns = rowNames.map((_, i) => cellN[i][j]);
    const harmonic = ms.length / sum(ns.filter((v) => v > 0).map((v) => 1 / v));
    return { n: harmonic * ms.length, mean: mean(ms), sd: NaN };
  });
  const rowGroups: Summary[] = rowNames.map((_, i) => {
    const ms = colNames.map((_, j) => cellMeans[i][j]).filter(Number.isFinite);
    const ns = colNames.map((_, j) => cellN[i][j]);
    const harmonic = ms.length / sum(ns.filter((v) => v > 0).map((v) => 1 / v));
    return { n: harmonic * ms.length, mean: mean(ms), sd: NaN };
  });
  const columnComparisons = compare === 'columnMeans' || compare === 'all' ? postHoc(colGroups, colNames, method, mse, dfe, { alpha: opts.alpha }) : [];
  const rowComparisons = compare === 'rowMeans' || compare === 'all' ? postHoc(rowGroups, rowNames, method, mse, dfe, { alpha: opts.alpha }) : [];
  return { table, interaction, mse, dfe, cellMeans, cellN, comparisons, columnComparisons, rowComparisons, warnings };
}

export { ols };
