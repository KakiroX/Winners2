import type { Analysis, AnalysisKind, AnalysisOutput, DataTable, ResultTable, TableKind, FitCurve, ComparisonMark, Cell } from '../model/types';
import {
  cellStats, datasetLetter, datasetValues, emptyDataset, isSummaryFormat, rowCount, selectedDatasets, subcolCount, syntheticFromSummary, uid, xyPairs, xyPoints, cellValue, xValue,
} from '../model/table';
import { describe as describeValues, mean, sd, sortNum, clean, sum } from '../stats/descriptive';
import {
  adjustP, dagostinoPearson, kolmogorovSmirnov2, ksNormality, mannWhitney, oneSampleT, pairedT, pearson, shapiroWilk, spearman, summarize, unpairedT,
  wilcoxonSignedRank, grubbs, type Summary,
} from '../stats/tests';
import { brownForsytheAnova, friedman, kruskalWallis, oneWayAnova, postHoc, repeatedMeasuresAnova, twoWayAnova, welchAnova, type Comparison, type PostHocMethod, type AnovaRow } from '../stats/anova';
import { compareSlopes, extraSumOfSquares, inverseModel, linearBand, linearRegression, multipleRegression, NL_MODELS, nonlinearFit, pca, type NLModel } from '../stats/regression';
import { areaUnderCurve, blandAltman, chiSquare, chiSquareTrend, fisherExact, frequencyDistribution, kaplanMeier, logRank, rocCurve, twoByTwo } from '../stats/misc';
import { tInv } from '../stats/distributions';
import { ci, num, pct, pv, sig, stars } from './format';
import { compileUserEquation } from '../lang/equation';

export interface ParamDef {
  key: string;
  label: string;
  type: 'select' | 'number' | 'boolean' | 'text' | 'model' | 'dataset';
  options?: { value: string; label: string }[];
  default: any;
  help?: string;
  showIf?: (p: Record<string, any>) => boolean;
}

export interface AnalysisDef {
  kind: AnalysisKind;
  name: string;
  category: string;
  tableKinds: TableKind[];
  description: string;
  params: ParamDef[];
  minDatasets?: number;
  run: (t: DataTable, a: Analysis) => AnalysisOutput;
}

const POSTHOC_OPTIONS = [
  { value: 'tukey', label: 'Tukey (compare all pairs)' },
  { value: 'holm-sidak', label: 'Holm-Šídák' },
  { value: 'sidak', label: 'Šídák' },
  { value: 'bonferroni', label: 'Bonferroni' },
  { value: 'dunnett', label: 'Dunnett (compare to control)' },
  { value: 'fisher', label: "Fisher's LSD (no correction)" },
  { value: 'none', label: 'No multiple comparisons' },
];

function out(tables: ResultTable[], summary: string, extra: Partial<AnalysisOutput> = {}): AnalysisOutput {
  return { tables, warnings: [], summary, ...extra };
}

function names(t: DataTable, idx: number[]) {
  return idx.map((i) => t.datasets[i].title || datasetLetter(i));
}

/** Groups for column-style analyses. Summarized (mean/SD/N) data become exact synthetic samples. */
function getGroups(t: DataTable, a: Analysis) {
  const idx = selectedDatasets(t, a.datasetIds);
  const raw = idx.map((i) => {
    if (isSummaryFormat(t)) {
      const all: number[] = [];
      for (let r = 0; r < rowCount(t); r++) {
        const s = cellStats(t, i, r).summary;
        if (s) all.push(...syntheticFromSummary(s));
      }
      return all;
    }
    return datasetValues(t, i);
  });
  return { idx, names: names(t, idx), raw, summaries: raw.map((g) => summarize(g)), fromSummary: isSummaryFormat(t) };
}

/** Paired rows (subjects) for repeated measures designs. */
function getRows(t: DataTable, idx: number[]): number[][] {
  const rows: number[][] = [];
  for (let r = 0; r < rowCount(t); r++) {
    const row = idx.map((i) => cellValue(t, i, 0, r));
    if (row.every((v) => v !== null)) rows.push(row as number[]);
  }
  return rows;
}

function anovaTable(rows: AnovaRow[], withPct = false): ResultTable {
  return {
    title: 'ANOVA table',
    header: withPct ? ['ANOVA table', 'SS', 'DF', 'MS', 'F (DFn, DFd)', 'P value', '% of total variation'] : ['ANOVA table', 'SS', 'DF', 'MS', 'F (DFn, DFd)', 'P value'],
    rows: rows.map((r) => {
      const resid = rows.find((x) => x.source.startsWith('Residual'));
      const fcell = r.F !== undefined ? `F (${num(r.df)}, ${num(resid?.df ?? NaN)}) = ${num(r.F)}` : '';
      const base = [r.source, num(r.ss), num(r.df), Number.isFinite(r.ms) ? num(r.ms) : '', fcell, r.p !== undefined ? `P${r.p < 0.0001 ? '<0.0001' : '=' + pv(r.p)}` : ''];
      if (withPct) base.push(r.pctTotal !== undefined ? num(r.pctTotal) : '');
      return base;
    }),
  };
}

function comparisonTable(title: string, comps: Comparison[], showCI = true): ResultTable {
  const header = ['Comparison', 'Mean Diff.', ...(showCI ? ['95.00% CI of diff.'] : []), 'Significant?', 'Summary', 'Adjusted P Value'];
  return {
    title,
    header,
    rows: comps.map((c) => [`${c.a} vs. ${c.b}`, num(c.diff), ...(showCI ? [ci(c.ciLo, c.ciHi)] : []), sig(c.p), c.summary, pv(c.p)]),
  };
}

function marks(comps: Comparison[], localIdx?: number[], row?: number): ComparisonMark[] {
  return comps.map((c) => ({ i: localIdx ? localIdx[c.i] : c.i, j: localIdx ? localIdx[c.j] : c.j, p: c.p, summary: c.summary, row }));
}

function derived(t: DataTable, a: Analysis, kind: TableKind, name: string): DataTable {
  return {
    id: `derived:${a.id}`, type: 'table', name, kind, xTitle: 'X', x: [], rowTitles: [], yFormat: 'replicates', replicates: 1,
    datasets: [], excluded: [], notes: `Generated by analysis "${a.name}" of "${t.name}".`, derivedFrom: a.id,
  };
}

// ---------------- Analyses ----------------
const descriptive: AnalysisDef = {
  kind: 'descriptive', name: 'Descriptive statistics', category: 'Column analyses',
  tableKinds: ['column', 'xy', 'grouped', 'multi', 'parts'],
  description: 'Mean, SD, SEM, median, quartiles, confidence interval, CV, skewness, kurtosis and more for each data set.',
  params: [{ key: 'ciLevel', label: 'Confidence level', type: 'number', default: 0.95 }],
  run(t, a) {
    const g = getGroups(t, a);
    const d = g.raw.map((v) => describeValues(v, a.params.ciLevel ?? 0.95));
    const level = Math.round((a.params.ciLevel ?? 0.95) * 100);
    const rows: [string, (x: ReturnType<typeof describeValues>) => string][] = [
      ['Number of values', (x) => num(x.n)],
      ['Minimum', (x) => num(x.min)],
      ['25% Percentile', (x) => num(x.q25)],
      ['Median', (x) => num(x.median)],
      ['75% Percentile', (x) => num(x.q75)],
      ['Maximum', (x) => num(x.max)],
      ['Range', (x) => num(x.range)],
      ['10% Percentile', (x) => num(x.p10)],
      ['90% Percentile', (x) => num(x.p90)],
      ['Mean', (x) => num(x.mean)],
      ['Std. Deviation', (x) => num(x.sd)],
      ['Std. Error of Mean', (x) => num(x.sem)],
      [`Lower ${level}% CI of mean`, (x) => num(x.ciLo)],
      [`Upper ${level}% CI of mean`, (x) => num(x.ciHi)],
      ['Coefficient of variation', (x) => pct(x.cv)],
      ['Geometric mean', (x) => num(x.geoMean)],
      ['Geometric SD factor', (x) => num(x.geoSdFactor)],
      [`Lower ${level}% CI of geo. mean`, (x) => num(x.geoCiLo)],
      [`Upper ${level}% CI of geo. mean`, (x) => num(x.geoCiHi)],
      ['Harmonic mean', (x) => num(x.harmonicMean)],
      ['Quadratic mean', (x) => num(x.quadraticMean)],
      ['Skewness', (x) => num(x.skewness)],
      ['Kurtosis', (x) => num(x.kurtosis)],
      ['Sum', (x) => num(x.sum)],
    ];
    const table: ResultTable = { title: 'Descriptive statistics', header: ['', ...g.names], rows: rows.map(([label, f]) => [label, ...d.map(f)]) };
    const res = out([table], g.names.map((n, i) => `${n}: n=${d[i].n}, mean=${num(d[i].mean)}, SD=${num(d[i].sd)}, median=${num(d[i].median)}`).join('; '));
    if (g.fromSummary) res.warnings.push('Data were entered as mean/SD/N; statistics are computed from the summarized values.');
    return res;
  },
};

const normality: AnalysisDef = {
  kind: 'normality', name: 'Normality and lognormality tests', category: 'Column analyses',
  tableKinds: ['column', 'xy', 'grouped', 'multi'],
  description: 'Shapiro-Wilk, D\'Agostino-Pearson omnibus and Kolmogorov-Smirnov tests of whether data are sampled from a Gaussian distribution.',
  params: [
    { key: 'alpha', label: 'Alpha', type: 'number', default: 0.05 },
    { key: 'lognormal', label: 'Also test log-transformed values (lognormality)', type: 'boolean', default: false },
  ],
  run(t, a) {
    const g = getGroups(t, a);
    const alpha = a.params.alpha ?? 0.05;
    const build = (sets: number[][], label: string): ResultTable[] => {
      const sw = sets.map(shapiroWilk), dp = sets.map(dagostinoPearson), ks = sets.map(ksNormality);
      const passed = (p: number) => (Number.isFinite(p) ? (p > alpha ? 'Yes' : 'No') : 'N too small');
      return [
        { title: `D'Agostino & Pearson test${label}`, header: ['', ...g.names], rows: [
          ['K2', ...dp.map((r) => num(r.K2))], ['P value', ...dp.map((r) => pv(r.p))], [`Passed normality test (alpha=${alpha})?`, ...dp.map((r) => passed(r.p))], ['P value summary', ...dp.map((r) => (Number.isFinite(r.p) ? stars(r.p) : ''))],
        ] },
        { title: `Shapiro-Wilk test${label}`, header: ['', ...g.names], rows: [
          ['W', ...sw.map((r) => num(r.W))], ['P value', ...sw.map((r) => pv(r.p))], [`Passed normality test (alpha=${alpha})?`, ...sw.map((r) => passed(r.p))], ['P value summary', ...sw.map((r) => (Number.isFinite(r.p) ? stars(r.p) : ''))],
        ] },
        { title: `Kolmogorov-Smirnov test${label}`, header: ['', ...g.names], rows: [
          ['KS distance', ...ks.map((r) => num(r.D))], ['P value', ...ks.map((r) => r.pText)], [`Passed normality test (alpha=${alpha})?`, ...ks.map((r) => passed(r.p))],
        ] },
        { title: 'Number of values', header: ['', ...g.names], rows: [['Number of values', ...sets.map((s) => num(s.length))]] },
      ];
    };
    const tables = build(g.raw, '');
    if (a.params.lognormal) tables.push(...build(g.raw.map((s) => s.filter((v) => v > 0).map(Math.log10)), ' (log-transformed)'));
    const sw = g.raw.map(shapiroWilk);
    return out(tables, g.names.map((n, i) => `${n}: Shapiro-Wilk W=${num(sw[i].W)}, P=${pv(sw[i].p)}`).join('; '));
  },
};

const oneSample: AnalysisDef = {
  kind: 'oneSampleT', name: 'One sample t and Wilcoxon test', category: 'Column analyses', tableKinds: ['column', 'xy', 'grouped', 'multi'],
  description: 'Compare the mean (or median) of each column to a hypothetical value.',
  params: [
    { key: 'mu', label: 'Hypothetical value', type: 'number', default: 0 },
    { key: 'test', label: 'Test', type: 'select', default: 't', options: [{ value: 't', label: 'One sample t test' }, { value: 'wilcoxon', label: 'Wilcoxon signed-rank test' }] },
  ],
  run(t, a) {
    const g = getGroups(t, a);
    const mu = Number(a.params.mu ?? 0);
    if (a.params.test === 'wilcoxon') {
      const r = g.raw.map((v) => wilcoxonSignedRank(v.map((x) => x - mu)));
      return out([{ title: 'Wilcoxon signed rank test', header: ['', ...g.names], rows: [
        ['Theoretical median', ...r.map(() => num(mu))], ['Actual median', ...g.raw.map((v) => num(describeValues(v).median))],
        ['Number of values', ...g.raw.map((v) => num(v.length))], ['Sum of signed ranks (W)', ...r.map((x) => num(x.W))],
        ['Sum of positive ranks', ...r.map((x) => num(x.sumPositive))], ['Sum of negative ranks', ...r.map((x) => num(x.sumNegative))],
        ['P value (two tailed)', ...r.map((x) => pv(x.p))], ['Exact or estimate?', ...r.map((x) => (x.exact ? 'Exact' : 'Estimate'))],
        ['P value summary', ...r.map((x) => stars(x.p))], ['Significant (alpha=0.05)?', ...r.map((x) => sig(x.p))],
      ] }], g.names.map((n, i) => `${n}: W=${num(r[i].W)}, P=${pv(r[i].p)}`).join('; '));
    }
    const r = g.raw.map((v) => oneSampleT(v, mu));
    return out([{ title: 'One sample t test', header: ['', ...g.names], rows: [
      ['Theoretical mean', ...r.map(() => num(mu))], ['Actual mean', ...r.map((x) => num(x.mean))], ['Number of values', ...r.map((x) => num(x.n))],
      ['t, df', ...r.map((x) => `t=${num(x.t)}, df=${x.df}`)], ['P value (two tailed)', ...r.map((x) => pv(x.p))], ['P value summary', ...r.map((x) => stars(x.p))],
      ['Significant (alpha=0.05)?', ...r.map((x) => sig(x.p))], ['Discrepancy', ...r.map((x) => num(x.diff))], ['SD of discrepancy', ...r.map((x) => num(x.sd))],
      ['SEM of discrepancy', ...r.map((x) => num(x.se))], ['95% confidence interval', ...r.map((x) => ci(x.ciLo, x.ciHi))], ['R squared (partial eta squared)', ...r.map((x) => num(x.r2))],
    ] }], g.names.map((n, i) => `${n}: t(${r[i].df})=${num(r[i].t)}, P=${pv(r[i].p)}`).join('; '));
  },
};

const ttest: AnalysisDef = {
  kind: 'ttest', name: 't tests (and nonparametric tests)', category: 'Column analyses', tableKinds: ['column', 'multi', 'xy'], minDatasets: 2,
  description: 'Compare two groups: unpaired or paired t test, Welch\'s correction, Mann-Whitney, Kolmogorov-Smirnov, or Wilcoxon matched-pairs test.',
  params: [{
    key: 'test', label: 'Test', type: 'select', default: 'unpaired', options: [
      { value: 'unpaired', label: 'Unpaired t test (assume equal SDs)' },
      { value: 'welch', label: "Unpaired t test with Welch's correction" },
      { value: 'mannWhitney', label: 'Mann-Whitney test' },
      { value: 'ks', label: 'Kolmogorov-Smirnov test' },
      { value: 'paired', label: 'Paired t test' },
      { value: 'wilcoxon', label: 'Wilcoxon matched-pairs signed rank test' },
    ],
  }],
  run(t, a) {
    const g = getGroups(t, a);
    if (g.raw.length < 2) return { tables: [], warnings: ['Select two data sets to compare.'], summary: 'Needs two data sets' };
    const [A, B] = g.raw;
    const [nA, nB] = g.names;
    const test = a.params.test ?? 'unpaired';
    const res = (rows: string[][], title: string, summary: string, p: number) =>
      out([{ title, header: ['', `${nA} vs. ${nB}`], rows }], summary, { comparisons: [{ i: g.idx[0], j: g.idx[1], p, summary: stars(p) }] });
    if (test === 'unpaired' || test === 'welch') {
      const r = unpairedT(summarize(A), summarize(B), test === 'welch');
      return res([
        ['Column A', nA], ['vs.', 'vs.'], ['Column B', nB], ['', ''],
        [r.test, ''], ['P value', pv(r.p)], ['P value summary', stars(r.p)], ['Significantly different (P < 0.05)?', sig(r.p)],
        ['One- or two-tailed P value?', 'Two-tailed'], ['t, df', `t=${num(r.t)}, df=${num(r.df)}`], ['', ''],
        ['How big is the difference?', ''], [`Mean of ${nA}`, num(r.meanA)], [`Mean of ${nB}`, num(r.meanB)], ['Difference between means (B - A) ± SEM', `${num(r.diff)} ± ${num(r.seDiff)}`],
        ['95% confidence interval', ci(r.ciLo, r.ciHi)], ['R squared (eta squared)', num(r.r2)], ['', ''],
        ['F test to compare variances', ''], ['F, DFn, Dfd', `${num(r.fTest!.F)}, ${r.fTest!.dfn}, ${r.fTest!.dfd}`], ['P value', pv(r.fTest!.p)], ['Significantly different (P < 0.05)?', sig(r.fTest!.p)],
        ['', ''], ['Data analyzed', ''], [`Sample size, ${nA}`, num(r.nA)], [`Sample size, ${nB}`, num(r.nB)],
      ], r.test, `${r.test}: ${nA} vs ${nB}, t(${num(r.df)})=${num(r.t)}, P=${pv(r.p)}, diff (B-A)=${num(r.diff)} [${ci(r.ciLo, r.ciHi)}]`, r.p);
    }
    if (test === 'mannWhitney') {
      if (g.fromSummary) return { tables: [], warnings: ['Nonparametric tests require raw data, not mean/SD/N.'], summary: 'Not possible with summarized data' };
      const r = mannWhitney(A, B);
      return res([
        ['Mann Whitney test', ''], ['P value', pv(r.p)], ['Exact or approximate P value?', r.exact ? 'Exact' : 'Approximate'], ['P value summary', stars(r.p)],
        ['Significantly different (P < 0.05)?', sig(r.p)], ['One- or two-tailed P value?', 'Two-tailed'], [`Sum of ranks in column A,B`, `${num(r.sumRankA)} , ${num(r.sumRankB)}`],
        ['Mann-Whitney U', num(r.U)], ['', ''], ['Difference between medians', ''], [`Median of ${nA}, n=${r.nA}`, num(r.medianA)], [`Median of ${nB}, n=${r.nB}`, num(r.medianB)],
        ['Difference: Actual', num(r.diffMedians)], ['Difference: Hodges-Lehmann', num(r.hodgesLehmann)],
      ], 'Mann-Whitney test', `Mann-Whitney: ${nA} vs ${nB}, U=${num(r.U)}, P=${pv(r.p)}`, r.p);
    }
    if (test === 'ks') {
      const r = kolmogorovSmirnov2(A, B);
      return res([['Kolmogorov-Smirnov test', ''], ['P value', pv(r.p)], ['P value summary', stars(r.p)], ['Significantly different (P < 0.05)?', sig(r.p)], ['Kolmogorov-Smirnov D', num(r.D)], [`n (${nA}, ${nB})`, `${r.nA}, ${r.nB}`]],
        'Kolmogorov-Smirnov test', `KS test D=${num(r.D)}, P=${pv(r.p)}`, r.p);
    }
    const rowsAB = getRows(t, g.idx.slice(0, 2));
    const pa = rowsAB.map((r) => r[0]), pb = rowsAB.map((r) => r[1]);
    if (test === 'paired') {
      const r = pairedT(pa, pb);
      return res([
        ['Paired t test', ''], ['P value', pv(r.p)], ['P value summary', stars(r.p)], ['Significantly different (P < 0.05)?', sig(r.p)], ['One- or two-tailed P value?', 'Two-tailed'],
        ['t, df', `t=${num(r.t)}, df=${r.df}`], ['Number of pairs', num(r.nPairs)], ['', ''], ['How big is the difference?', ''], ['Mean of differences (B - A)', num(r.diff)],
        ['SD of differences', num(r.sdDiff)], ['SEM of differences', num(r.seDiff)], ['95% confidence interval', ci(r.ciLo, r.ciHi)], ['R squared (partial eta squared)', num(r.r2)],
        ['', ''], ['How effective was the pairing?', ''], ['Correlation coefficient (r)', num(r.pairingR)], ['P value (one tailed)', pv(r.pairingP / 2)], ['Was the pairing significantly effective?', sig(r.pairingP / 2)],
      ], 'Paired t test', `Paired t test: t(${r.df})=${num(r.t)}, P=${pv(r.p)}, mean diff=${num(r.diff)}`, r.p);
    }
    const r = wilcoxonSignedRank(pb.map((v, i) => v - pa[i]));
    return res([
      ['Wilcoxon matched-pairs signed rank test', ''], ['P value', pv(r.p)], ['Exact or estimate?', r.exact ? 'Exact' : 'Estimate'], ['P value summary', stars(r.p)],
      ['Significantly different (P < 0.05)?', sig(r.p)], ['Sum of positive, negative ranks', `${num(r.sumPositive)} , ${num(r.sumNegative)}`], ['Sum of signed ranks (W)', num(r.W)],
      ['Number of pairs', num(r.n + r.nZero)], ['Number of ties (ignored)', num(r.nZero)], ['Median of differences', num(r.medianDiff)],
    ], 'Wilcoxon test', `Wilcoxon matched pairs: W=${num(r.W)}, P=${pv(r.p)}`, r.p);
  },
};

const anova1: AnalysisDef = {
  kind: 'anova1', name: 'One-way ANOVA (and nonparametric or mixed)', category: 'Column analyses', tableKinds: ['column', 'multi'], minDatasets: 2,
  description: 'Compare three or more groups: ordinary, Welch or Brown-Forsythe ANOVA, repeated measures, Kruskal-Wallis or Friedman, with multiple comparisons.',
  params: [
    {
      key: 'test', label: 'Test', type: 'select', default: 'ordinary', options: [
        { value: 'ordinary', label: 'Ordinary one-way ANOVA' },
        { value: 'welch', label: 'Welch ANOVA (unequal SDs) + Games-Howell' },
        { value: 'brownForsythe', label: 'Brown-Forsythe ANOVA' },
        { value: 'rm', label: 'Repeated measures one-way ANOVA' },
        { value: 'kruskal', label: "Kruskal-Wallis test + Dunn's" },
        { value: 'friedman', label: "Friedman test + Dunn's" },
      ],
    },
    { key: 'posthoc', label: 'Multiple comparisons', type: 'select', default: 'tukey', options: POSTHOC_OPTIONS, showIf: (p) => p.test === 'ordinary' || p.test === 'rm' || !p.test },
    { key: 'control', label: 'Control group (for Dunnett / Dunn vs control)', type: 'dataset', default: 0 },
    { key: 'dunnVsControl', label: "Compare to control only (Dunn's)", type: 'boolean', default: false, showIf: (p) => p.test === 'kruskal' || p.test === 'friedman' },
  ],
  run(t, a) {
    const g = getGroups(t, a);
    const test = a.params.test ?? 'ordinary';
    const method: PostHocMethod = a.params.posthoc ?? 'tukey';
    const control = Math.max(0, Math.min(g.idx.length - 1, Number(a.params.control ?? 0)));
    const nameRow = (rows: string[][]) => rows;
    if (test === 'kruskal' || test === 'friedman') {
      if (g.fromSummary) return { tables: [], warnings: ['Nonparametric tests require raw data.'], summary: 'Not possible' };
      const opts = { control: a.params.dunnVsControl ? control : undefined };
      if (test === 'kruskal') {
        const r = kruskalWallis(g.raw, g.names, opts);
        return out([
          { title: 'Kruskal-Wallis test', header: ['', ''], rows: nameRow([['P value', pv(r.p)], ['Exact or approximate P value?', 'Approximate'], ['P value summary', stars(r.p)], ['Do the medians vary signif. (P < 0.05)?', sig(r.p)], ['Number of groups', num(g.raw.length)], ['Kruskal-Wallis statistic', num(r.H)]]) },
          { title: 'Data summary', header: ['', ...g.names], rows: [['Number of values', ...r.n.map((v) => num(v))], ['Sum of ranks', ...r.rankSums.map((v) => num(v))], ['Mean rank', ...r.meanRanks.map((v) => num(v))]] },
          { title: "Dunn's multiple comparisons test", header: ['Comparison', 'Mean rank diff.', 'Significant?', 'Summary', 'Adjusted P Value'], rows: r.comparisons.map((c) => [`${c.a} vs. ${c.b}`, num(c.diff), sig(c.p), c.summary, pv(c.p)]) },
        ], `Kruskal-Wallis H=${num(r.H)}, P=${pv(r.p)}`, { comparisons: marks(r.comparisons, g.idx) });
      }
      const rows = getRows(t, g.idx);
      const r = friedman(rows, g.names, opts);
      return out([
        { title: 'Friedman test', header: ['', ''], rows: [['P value', pv(r.p)], ['Exact or approximate P value?', 'Approximate'], ['P value summary', stars(r.p)], ['Are the medians signif. different? (P < 0.05)', sig(r.p)], ['Number of groups', num(g.raw.length)], ['Friedman statistic', num(r.Q)], ['Number of subjects', num(r.n)]] },
        { title: "Dunn's multiple comparisons test", header: ['Comparison', 'Rank sum diff.', 'Significant?', 'Summary', 'Adjusted P Value'], rows: r.comparisons.map((c) => [`${c.a} vs. ${c.b}`, num(c.diff), sig(c.p), c.summary, pv(c.p)]) },
      ], `Friedman Q=${num(r.Q)}, P=${pv(r.p)}`, { comparisons: marks(r.comparisons, g.idx) });
    }
    if (test === 'rm') {
      const rows = getRows(t, g.idx);
      const r = repeatedMeasuresAnova(rows, g.names, method, { control });
      return out([
        { title: 'Repeated measures ANOVA summary', header: ['', ''], rows: [
          ['Assume sphericity?', 'No (Geisser-Greenhouse correction)'], ['F', num(r.F)], ['P value (Geisser-Greenhouse)', pv(r.pGG)], ['P value (sphericity assumed)', pv(r.p)], ['P value summary', stars(r.pGG)],
          ['Statistically significant (P < 0.05)?', sig(r.pGG)], ['Geisser-Greenhouse\'s epsilon', num(r.epsilon)], ['R squared', num(r.r2)], ['', ''], ['Was the matching effective?', ''],
          ['F (matching)', num(r.matchingF)], ['P value (matching)', pv(r.matchingP)], ['Is there significant matching (P < 0.05)?', sig(r.matchingP)],
        ] },
        anovaTable(r.table),
        ...(r.comparisons.length ? [comparisonTable(`${POSTHOC_OPTIONS.find((o) => o.value === method)?.label ?? method} multiple comparisons test`, r.comparisons, method !== 'holm-sidak')] : []),
      ], `RM one-way ANOVA: F(${r.dfn}, ${r.dfd})=${num(r.F)}, GG-corrected P=${pv(r.pGG)}, epsilon=${num(r.epsilon)}`, { comparisons: marks(r.comparisons, g.idx) });
    }
    if (test === 'welch' || test === 'brownForsythe') {
      const r = test === 'welch' ? welchAnova(g.summaries) : brownForsytheAnova(g.summaries);
      const label = test === 'welch' ? 'Welch ANOVA test' : 'Brown-Forsythe ANOVA test';
      const N = sum(g.summaries.map((s) => s.n));
      const comps = postHoc(g.summaries, g.names, 'games-howell', NaN, N - g.summaries.length);
      return out([
        { title: label, header: ['', ''], rows: [[`${test === 'welch' ? 'W' : 'F*'} (DFn, DFd)`, `${num(r.F)} (${num(r.dfn)}, ${num(r.dfd)})`], ['P value', pv(r.p)], ['P value summary', stars(r.p)], ['Significant diff. among means (P < 0.05)?', sig(r.p)]] },
        comparisonTable("Games-Howell's multiple comparisons test", comps),
      ], `${label}: F(${num(r.dfn)}, ${num(r.dfd)})=${num(r.F)}, P=${pv(r.p)}`, { comparisons: marks(comps, g.idx) });
    }
    const r = oneWayAnova(g.summaries, g.names, method, g.fromSummary ? undefined : g.raw, { control });
    const tables: ResultTable[] = [
      { title: 'ANOVA summary', header: ['', ''], rows: [
        ['F', num(r.F)], ['P value', pv(r.p)], ['P value summary', stars(r.p)], ['Significant diff. among means (P < 0.05)?', sig(r.p)], ['R squared', num(r.r2)],
        ...(r.brownForsythe ? [['', ''], ['Brown-Forsythe test', ''], ['F (DFn, DFd)', `${num(r.brownForsythe.F)} (${r.brownForsythe.dfn}, ${r.brownForsythe.dfd})`], ['P value', pv(r.brownForsythe.p)], ['Are SDs significantly different (P < 0.05)?', sig(r.brownForsythe.p)]] : []),
        ...(r.bartlett ? [['', ''], ["Bartlett's test", ''], ["Bartlett's statistic (corrected)", num(r.bartlett.stat)], ['P value', pv(r.bartlett.p)], ['Are SDs significantly different (P < 0.05)?', sig(r.bartlett.p)]] : []),
      ] },
      anovaTable(r.table),
      { title: 'Data summary', header: ['', ...g.names], rows: [['Number of values', ...g.summaries.map((s) => num(s.n))], ['Mean', ...g.summaries.map((s) => num(s.mean))], ['SD', ...g.summaries.map((s) => num(s.sd))], ['SEM', ...g.summaries.map((s) => num(s.sd / Math.sqrt(s.n)))]] },
    ];
    if (r.comparisons.length) tables.push(comparisonTable(`${POSTHOC_OPTIONS.find((o) => o.value === method)?.label ?? method} multiple comparisons test`, r.comparisons, method !== 'holm-sidak'));
    return out(tables, `Ordinary one-way ANOVA: F(${r.dfn}, ${r.dfd})=${num(r.F)}, P=${pv(r.p)}, R²=${num(r.r2)}. ` + r.comparisons.map((c) => `${c.a} vs ${c.b}: P=${pv(c.p)} ${c.summary}`).join('; '), { comparisons: marks(r.comparisons, g.idx) });
  },
};

const anova2: AnalysisDef = {
  kind: 'anova2', name: 'Two-way ANOVA', category: 'Grouped analyses', tableKinds: ['grouped'], minDatasets: 2,
  description: 'Row factor, column factor and interaction (Type III sums of squares), with multiple comparisons.',
  params: [
    { key: 'posthoc', label: 'Multiple comparisons', type: 'select', default: 'tukey', options: POSTHOC_OPTIONS.filter((o) => o.value !== 'dunnett') },
    { key: 'compare', label: 'Compare', type: 'select', default: 'withinRows', options: [{ value: 'withinRows', label: 'Compare columns within each row (simple effects)' }, { value: 'columnMeans', label: 'Compare column means (main column effect)' }, { value: 'rowMeans', label: 'Compare row means (main row effect)' }] },
  ],
  run(t, a) {
    const idx = selectedDatasets(t, a.datasetIds);
    const colNames = names(t, idx);
    const nRows = rowCount(t);
    const rowIdx: number[] = [];
    for (let r = 0; r < nRows; r++) if (idx.some((i) => cellStats(t, i, r).summary)) rowIdx.push(r);
    const rowNames = rowIdx.map((r) => t.rowTitles[r] || `Row ${r + 1}`);
    const cells = rowIdx.map((r) => idx.map((i) => {
      const cs = cellStats(t, i, r);
      return isSummaryFormat(t) ? (cs.summary ? syntheticFromSummary(cs.summary) : []) : cs.values;
    }));
    const res = twoWayAnova(cells, rowNames, colNames, a.params.posthoc ?? 'tukey', { compare: a.params.compare ?? 'withinRows' });
    const tables: ResultTable[] = [
      { title: 'Two-way ANOVA', header: ['Source of Variation', '% of total variation', 'P value', 'P value summary', 'Significant?'], rows: res.table.filter((r) => r.p !== undefined).map((r) => [r.source, num(r.pctTotal ?? NaN), pv(r.p!), stars(r.p!), sig(r.p!)]) },
      anovaTable(res.table, true),
      { title: 'Data summary', header: ['', ''], rows: [['Number of columns (Column Factor)', num(colNames.length)], ['Number of rows (Row Factor)', num(rowNames.length)], ['Number of values', num(sum(res.cellN.flat()))]] },
    ];
    const allMarks: ComparisonMark[] = [];
    for (const [ri, block] of res.comparisons.entries()) {
      tables.push(comparisonTable(`${block.row}: compare ${colNames.length > 2 ? 'columns' : colNames.join(' vs. ')}`, block.comparisons));
      allMarks.push(...marks(block.comparisons, idx, rowIdx[ri]));
    }
    if (res.columnComparisons.length) tables.push(comparisonTable('Column means (main column effect)', res.columnComparisons));
    if (res.rowComparisons.length) tables.push(comparisonTable('Row means (main row effect)', res.rowComparisons));
    const o = out(tables, 'Two-way ANOVA: ' + res.table.filter((r) => r.p !== undefined).map((r) => `${r.source} F(${r.df}, ${res.dfe})=${num(r.F!)}, P=${pv(r.p!)}`).join('; '), { comparisons: allMarks });
    o.warnings.push(...res.warnings);
    return o;
  },
};

const multipleT: AnalysisDef = {
  kind: 'multipleT', name: 'Multiple t tests (one per row)', category: 'Grouped analyses', tableKinds: ['grouped'], minDatasets: 2,
  description: 'Compare two data sets at each row with a t test, correcting for multiple comparisons.',
  params: [
    { key: 'welch', label: "Welch's correction (don't assume equal SDs)", type: 'boolean', default: false },
    { key: 'correction', label: 'Multiple comparisons', type: 'select', default: 'holm-sidak', options: [{ value: 'holm-sidak', label: 'Holm-Šídák' }, { value: 'bh', label: 'False discovery rate (Benjamini-Hochberg)' }, { value: 'bonferroni', label: 'Bonferroni-Dunn' }, { value: 'none', label: 'None' }] },
  ],
  run(t, a) {
    const idx = selectedDatasets(t, a.datasetIds).slice(0, 2);
    if (idx.length < 2) return { tables: [], warnings: ['Need two data sets.'], summary: 'Needs two data sets' };
    const rows: { title: string; r: ReturnType<typeof unpairedT>; row: number }[] = [];
    for (let r = 0; r < rowCount(t); r++) {
      const A = cellStats(t, idx[0], r).summary, B = cellStats(t, idx[1], r).summary;
      if (!A || !B || !(A.n > 1) || !(B.n > 1)) continue;
      rows.push({ title: t.rowTitles[r] || `Row ${r + 1}`, r: unpairedT(A, B, !!a.params.welch), row: r });
    }
    const adj = adjustP(rows.map((x) => x.r.p), a.params.correction ?? 'holm-sidak');
    const nm = names(t, idx);
    return out([{
      title: `Multiple t tests: ${nm[0]} vs. ${nm[1]}`, header: ['Row', `Mean of ${nm[0]}`, `Mean of ${nm[1]}`, 'Difference', 'SE of difference', 't ratio', 'df', 'P value', 'Adjusted P value', 'Significant?'],
      rows: rows.map((x, i) => [x.title, num(x.r.meanA), num(x.r.meanB), num(x.r.diff), num(x.r.seDiff), num(x.r.t), num(x.r.df), pv(x.r.p), pv(adj[i]), sig(adj[i])]),
    }], rows.map((x, i) => `${x.title}: adj P=${pv(adj[i])}`).join('; '), { comparisons: rows.map((x, i) => ({ i: idx[0], j: idx[1], p: adj[i], summary: stars(adj[i]), row: x.row })) });
  },
};

const linreg: AnalysisDef = {
  kind: 'linreg', name: 'Simple linear regression', category: 'XY analyses', tableKinds: ['xy'],
  description: 'Fit a straight line; test whether the slope differs from zero and whether slopes/intercepts differ between data sets.',
  params: [
    { key: 'throughOrigin', label: 'Force line through origin (X=0, Y=0)', type: 'boolean', default: false },
    { key: 'band', label: 'Show band', type: 'select', default: 'none', options: [{ value: 'none', label: 'None' }, { value: 'ci', label: '95% confidence band' }, { value: 'prediction', label: '95% prediction band' }] },
  ],
  run(t, a) {
    const idx = selectedDatasets(t, a.datasetIds);
    const nm = names(t, idx);
    const fits = idx.map((i) => {
      const { x, y } = xyPairs(t, i);
      return { fit: linearRegression(x, y, { throughOrigin: !!a.params.throughOrigin }), x, y };
    });
    const F = fits.map((f) => f.fit);
    const tables: ResultTable[] = [{
      title: 'Simple linear regression', header: ['', ...nm], rows: [
        ['Best-fit values', ...nm.map(() => '')], ['Slope', ...F.map((f) => num(f.slope))], ['Y-intercept', ...F.map((f) => num(f.intercept))], ['X-intercept', ...F.map((f) => num(f.xIntercept))], ['1/slope', ...F.map((f) => num(1 / f.slope))],
        ['Std. Error', ...nm.map(() => '')], ['Slope', ...F.map((f) => num(f.seSlope))], ['Y-intercept', ...F.map((f) => num(f.seIntercept))],
        ['95% Confidence Intervals', ...nm.map(() => '')], ['Slope', ...F.map((f) => ci(...f.slopeCI))], ['Y-intercept', ...F.map((f) => ci(...f.interceptCI))],
        ['Goodness of Fit', ...nm.map(() => '')], ['R squared', ...F.map((f) => num(f.r2))], ['Sy.x', ...F.map((f) => num(f.syx))],
        ['Is slope significantly non-zero?', ...nm.map(() => '')], ['F', ...F.map((f) => num(f.F))], ['DFn, DFd', ...F.map((f) => `${f.dfn}, ${f.dfd}`)], ['P value', ...F.map((f) => pv(f.p))], ['Deviation from zero?', ...F.map((f) => (f.p < 0.05 ? 'Significant' : 'Not Significant'))],
        ['Runs test', ...nm.map(() => '')], ['Points above line / runs', ...F.map((f) => (f.runs ? num(f.runs.runs) : ''))], ['P value (runs test)', ...F.map((f) => (f.runs ? pv(f.runs.p) : ''))],
        ['Equation', ...F.map((f) => f.equation)], ['Data', ...nm.map(() => '')], ['Total number of values', ...F.map((f) => num(f.n))],
      ],
    }];
    if (fits.length > 1) {
      const c = compareSlopes(fits.map((f) => ({ x: f.x, y: f.y })));
      tables.push({ title: 'Are the slopes equal?', header: ['', ''], rows: [
        ['F (DFn, DFd)', `${num(c.slopes.F)} (${c.slopes.dfn}, ${c.slopes.dfd})`], ['P value', pv(c.slopes.p)], ['Conclusion', c.slopes.p < 0.05 ? 'The slopes are significantly different' : 'The slopes are not significantly different'],
        ...(c.slopes.p >= 0.05 ? [['Pooled slope', num(c.commonSlope)], ['Are the elevations or intercepts equal?', ''], ['F (DFn, DFd)', `${num(c.intercepts.F)} (${c.intercepts.dfn}, ${c.intercepts.dfd})`], ['P value', pv(c.intercepts.p)], ['Conclusion', c.intercepts.p < 0.05 ? 'The intercepts are significantly different' : 'The intercepts are not significantly different']] : []),
      ] });
    }
    const curves: FitCurve[] = fits.map((f, k) => {
      const xs = sortNum(f.x);
      const lo = xs[0], hi = xs[xs.length - 1];
      const grid = Array.from({ length: 50 }, (_, i) => lo + ((hi - lo) * i) / 49);
      const band = a.params.band && a.params.band !== 'none' ? linearBand(f.fit, grid, 0.95, a.params.band === 'prediction') : null;
      return { datasetId: t.datasets[idx[k]].id, label: `${nm[k]} fit`, x: grid, y: grid.map((x) => f.fit.intercept + f.fit.slope * x), lo: band?.map((b) => b.lo), hi: band?.map((b) => b.hi) };
    });
    return out(tables, nm.map((n, k) => `${n}: ${F[k].equation}, R²=${num(F[k].r2)}, slope P=${pv(F[k].p)}`).join('; '), { curves });
  },
};

const correlation: AnalysisDef = {
  kind: 'correlation', name: 'Correlation', category: 'XY analyses', tableKinds: ['xy', 'column', 'multi'],
  description: 'Pearson or Spearman correlation coefficient between X and each Y data set (XY tables) or between pairs of columns.',
  params: [{ key: 'method', label: 'Correlation coefficient', type: 'select', default: 'pearson', options: [{ value: 'pearson', label: 'Pearson (Gaussian)' }, { value: 'spearman', label: 'Spearman (nonparametric)' }] }],
  run(t, a) {
    const idx = selectedDatasets(t, a.datasetIds);
    const f = a.params.method === 'spearman' ? spearman : pearson;
    const label = a.params.method === 'spearman' ? 'Spearman r' : 'Pearson r';
    const pairs: { name: string; r: ReturnType<typeof pearson> }[] = [];
    if (t.kind === 'xy') {
      for (const i of idx) {
        const { x, y } = xyPairs(t, i);
        pairs.push({ name: `${t.xTitle || 'X'} vs. ${t.datasets[i].title}`, r: f(x, y) });
      }
    } else {
      for (let p = 0; p < idx.length; p++)
        for (let q = p + 1; q < idx.length; q++) {
          const x: number[] = [], y: number[] = [];
          for (let r = 0; r < rowCount(t); r++) {
            const u = cellValue(t, idx[p], 0, r), v = cellValue(t, idx[q], 0, r);
            if (u !== null && v !== null) {
              x.push(u);
              y.push(v);
            }
          }
          pairs.push({ name: `${t.datasets[idx[p]].title} vs. ${t.datasets[idx[q]].title}`, r: f(x, y) });
        }
    }
    return out([{
      title: label, header: ['', ...pairs.map((p) => p.name)], rows: [
        [label, ...pairs.map((p) => num(p.r.r))], ['95% confidence interval', ...pairs.map((p) => ci(p.r.ciLo, p.r.ciHi))], ['R squared', ...pairs.map((p) => num(p.r.r2))],
        ['P value (two-tailed)', ...pairs.map((p) => pv(p.r.p))], ['P value summary', ...pairs.map((p) => stars(p.r.p))], ['Significant? (alpha = 0.05)', ...pairs.map((p) => sig(p.r.p))], ['Number of XY Pairs', ...pairs.map((p) => num(p.r.n))],
      ],
    }], pairs.map((p) => `${p.name}: r=${num(p.r.r)}, P=${pv(p.r.p)}`).join('; '));
  },
};

const corrMatrix: AnalysisDef = {
  kind: 'corrMatrix', name: 'Correlation matrix', category: 'Multiple variable analyses', tableKinds: ['multi', 'column'],
  description: 'Correlation coefficients and P values between every pair of variables.',
  params: [{ key: 'method', label: 'Correlation coefficient', type: 'select', default: 'pearson', options: [{ value: 'pearson', label: 'Pearson' }, { value: 'spearman', label: 'Spearman' }] }],
  run(t, a) {
    const idx = selectedDatasets(t, a.datasetIds);
    const nm = names(t, idx);
    const f = a.params.method === 'spearman' ? spearman : pearson;
    const R = idx.map((i) => idx.map((j) => {
      if (i === j) return { r: 1, p: 0 };
      const x: number[] = [], y: number[] = [];
      for (let r = 0; r < rowCount(t); r++) {
        const u = cellValue(t, i, 0, r), v = cellValue(t, j, 0, r);
        if (u !== null && v !== null) {
          x.push(u);
          y.push(v);
        }
      }
      return f(x, y);
    }));
    const d = derived(t, a, 'multi', `Correlation matrix of ${t.name}`);
    d.rowTitles = nm;
    d.datasets = nm.map((n, j) => ({ id: `${d.id}:${j}`, title: n, cols: [R.map((row) => row[j].r)] }));
    return out([
      { title: a.params.method === 'spearman' ? 'Spearman r' : 'Pearson r', header: ['', ...nm], rows: nm.map((n, i) => [n, ...R[i].map((c) => num(c.r))]) },
      { title: 'P value (two-tailed)', header: ['', ...nm], rows: nm.map((n, i) => [n, ...R[i].map((c, j) => (i === j ? '' : pv(c.p)))]) },
    ], 'Correlation matrix computed for ' + nm.join(', '), { derivedTable: d });
  },
};

// ---------------- Nonlinear regression ----------------
export function getModel(a: Analysis): NLModel | null {
  if (a.params.model === 'custom') {
    try {
      const c = compileUserEquation(String(a.params.custom ?? ''));
      return { id: 'custom', name: 'User-defined equation', group: 'User-defined', equation: String(a.params.custom), params: c.params, f: c.f, guess: () => c.params.map((p) => Number(a.params.initial?.[p] ?? 1)) };
    } catch {
      return null;
    }
  }
  return NL_MODELS.find((m) => m.id === (a.params.model ?? 'logAgonist4')) ?? null;
}

const nonlin: AnalysisDef = {
  kind: 'nonlin', name: 'Nonlinear regression (curve fit)', category: 'XY analyses', tableKinds: ['xy'],
  description: 'Fit dose-response, exponential, binding, Michaelis-Menten, Gaussian, polynomial or your own equation; interpolate unknowns from a standard curve.',
  params: [
    { key: 'model', label: 'Equation', type: 'model', default: 'logAgonist4' },
    { key: 'custom', label: 'Custom equation (e.g. Y = A*exp(-k*X) + C)', type: 'text', default: 'Y = A*exp(-k*X) + C', showIf: (p) => p.model === 'custom' },
    { key: 'weights', label: 'Weighting', type: 'select', default: 'none', options: [{ value: 'none', label: 'No weighting' }, { value: '1/Y^2', label: 'Weight by 1/Y² (relative)' }, { value: '1/Y', label: 'Weight by 1/|Y|' }] },
    { key: 'compare', label: 'Test whether one curve fits all data sets (extra sum-of-squares F test)', type: 'boolean', default: false },
    { key: 'interpolate', label: 'Interpolate unknowns from standard curve', type: 'boolean', default: true },
    { key: 'band', label: 'Plot 95% confidence band', type: 'boolean', default: false },
  ],
  run(t, a) {
    const model = getModel(a);
    if (!model) return { tables: [], warnings: ['Could not parse the equation. Use a form like: Y = Bottom + (Top-Bottom)/(1+exp(-(X-X50)/S))'], summary: 'Invalid equation' };
    const idx = selectedDatasets(t, a.datasetIds);
    const nm = names(t, idx);
    const weights = a.params.weights ?? 'none';
    const fixed = model.params.map((p) => a.params.fixed?.[p] !== undefined && a.params.fixed?.[p] !== '' && a.params.fixed?.[p] !== null);
    const fits = idx.map((i) => {
      const { x, y } = xyPairs(t, i);
      let p0 = model.guess(x, y);
      if (a.params.initial) p0 = p0.map((v, k) => (a.params.initial[model.params[k]] !== undefined && a.params.initial[model.params[k]] !== '' ? Number(a.params.initial[model.params[k]]) : v));
      p0 = p0.map((v, k) => (fixed[k] ? Number(a.params.fixed[model.params[k]]) : v));
      return { x, y, fit: nonlinearFit(model.f, x, y, p0, { weights, fixed }) };
    });
    const F = fits.map((f) => f.fit);
    const derivedNames = model.derived ? model.derived(F[0]?.params ?? model.params.map(() => 1)).map((d) => d.name) : [];
    const rows: string[][] = [
      [model.name, ...nm.map(() => '')],
      ['Best-fit values', ...nm.map(() => '')],
      ...model.params.map((p, k) => [p, ...F.map((f) => (fixed[k] ? `= ${num(f.params[k])}` : num(f.params[k])))]),
      ...derivedNames.map((d, k) => [d, ...F.map((f) => num(model.derived!(f.params)[k].value))]),
      ['Std. Error', ...nm.map(() => '')],
      ...model.params.map((p, k) => [p, ...F.map((f) => (fixed[k] ? '' : num(f.se[k])))]),
      ['95% CI (asymptotic)', ...nm.map(() => '')],
      ...model.params.map((p, k) => [p, ...F.map((f) => (fixed[k] ? '' : ci(f.ci[k][0], f.ci[k][1])))]),
      ['Goodness of Fit', ...nm.map(() => '')],
      ['Degrees of Freedom', ...F.map((f) => num(f.df))],
      ['R squared', ...F.map((f) => num(f.r2))],
      [weights === 'none' ? 'Sum of Squares' : 'Weighted Sum of Squares', ...F.map((f) => num(f.sse))],
      ['Sy.x', ...F.map((f) => num(f.syx))],
      ['Number of points', ...nm.map(() => '')],
      ['# of X values', ...fits.map((f) => num(new Set(f.x).size))],
      ['# Y values analyzed', ...F.map((f) => num(f.n))],
      ['Convergence', ...F.map((f) => `${f.message} (${f.iterations} iterations)`)],
      ['Equation', ...nm.map(() => model.equation)],
    ];
    const tables: ResultTable[] = [{ title: 'Nonlinear fit', header: ['', ...nm], rows }];
    const warnings: string[] = [];
    F.forEach((f, k) => {
      if (f.ambiguous) warnings.push(`${nm[k]}: the fit is ambiguous (parameters are not well determined by the data).`);
      if (!f.converged) warnings.push(`${nm[k]}: ${f.message}`);
    });
    if (a.params.compare && fits.length > 1) {
      const allX = fits.flatMap((f) => f.x), allY = fits.flatMap((f) => f.y);
      const shared = nonlinearFit(model.f, allX, allY, F[0].params, { weights, fixed });
      const ssSep = sum(F.map((f) => f.sse)), dfSep = sum(F.map((f) => f.df));
      const e = extraSumOfSquares(shared.sse, shared.df, ssSep, dfSep);
      tables.push({ title: 'Comparison of Fits', header: ['', ''], rows: [
        ['Null hypothesis', 'One curve for all data sets'], ['Alternative hypothesis', 'Different curve for each data set'], ['P value', pv(e.p)],
        ['Conclusion (alpha = 0.05)', e.p < 0.05 ? 'Reject null hypothesis' : 'Do not reject null hypothesis'], ['Preferred model', e.p < 0.05 ? 'Different curve for each data set' : 'One curve for all data sets'],
        ['F (DFn, DFd)', `${num(e.F)} (${e.dfn}, ${e.dfd})`],
      ] });
    }
    if (a.params.interpolate !== false) {
      const interpRows: string[][] = [];
      idx.forEach((i, k) => {
        const f = F[k];
        const xs = fits[k].x;
        if (!xs.length) return;
        const xmin = Math.min(...xs), xmax = Math.max(...xs);
        for (let r = 0; r < rowCount(t); r++) {
          const xv = xValue(t, r);
          const cs = cellStats(t, i, r);
          if (xv === null && cs.summary) {
            const xi = inverseModel(model.f, f.params, cs.summary.mean, xmin, xmax);
            interpRows.push([t.rowTitles[r] || `Row ${r + 1}`, nm[k], num(cs.summary.mean), num(xi), 'X from Y']);
          } else if (xv !== null && !cs.summary && t.datasets[i].cols.every((c) => c[r] === null || c[r] === undefined)) {
            if (rowHasOtherData(t, r)) interpRows.push([t.rowTitles[r] || `Row ${r + 1}`, nm[k], num(model.f(xv, f.params)), num(xv), 'Y from X']);
          }
        }
      });
      if (interpRows.length) tables.push({ title: 'Interpolated values', header: ['Row', 'Data set', 'Y', 'X', 'Direction'], rows: interpRows });
    }
    const curves: FitCurve[] = fits.map((f, k) => {
      if (!f.x.length) return { datasetId: t.datasets[idx[k]].id, label: nm[k], x: [], y: [] };
      const lo = Math.min(...f.x), hi = Math.max(...f.x);
      const grid = Array.from({ length: 150 }, (_, i) => lo + ((hi - lo) * i) / 149);
      const y = grid.map((x) => model.f(x, F[k].params));
      let lob: number[] | undefined, hib: number[] | undefined;
      if (a.params.band && F[k].cov) {
        const free = model.params.map((_, j) => j).filter((j) => !fixed[j]);
        const tc = tInv(0.975, F[k].df);
        lob = [];
        hib = [];
        grid.forEach((x, gi) => {
          const g = free.map((j) => {
            const h = 1e-6 * Math.max(Math.abs(F[k].params[j]), 1e-4);
            const p2 = [...F[k].params];
            p2[j] += h;
            return (model.f(x, p2) - y[gi]) / h;
          });
          let v = 0;
          for (let p = 0; p < g.length; p++) for (let q = 0; q < g.length; q++) v += g[p] * F[k].cov![p][q] * g[q];
          const half = tc * Math.sqrt(Math.max(0, v));
          lob!.push(y[gi] - half);
          hib!.push(y[gi] + half);
        });
      }
      return { datasetId: t.datasets[idx[k]].id, label: `${nm[k]} fit`, x: grid, y, lo: lob, hi: hib };
    });
    const summary = `${model.name}. ` + nm.map((n, k) => `${n}: ` + model.params.map((p, j) => `${p}=${num(F[k].params[j])}±${num(F[k].se[j])}`).join(', ') + `, R²=${num(F[k].r2)}`).join('; ');
    return { tables, warnings, curves, summary };
  },
};

function rowHasOtherData(t: DataTable, r: number) {
  return t.datasets.some((ds) => ds.cols.some((c) => c[r] !== null && c[r] !== undefined));
}

const auc: AnalysisDef = {
  kind: 'auc', name: 'Area under curve', category: 'XY analyses', tableKinds: ['xy'],
  description: 'Trapezoid-rule area under each curve, above a baseline, with peaks.',
  params: [{ key: 'baseline', label: 'Baseline (Y =)', type: 'number', default: 0 }],
  run(t, a) {
    const idx = selectedDatasets(t, a.datasetIds);
    const nm = names(t, idx);
    const r = idx.map((i) => {
      const pts = xyPoints(t, i);
      return areaUnderCurve(pts.map((p) => p.x), pts.map((p) => p.summary!.mean), Number(a.params.baseline ?? 0));
    });
    return out([{ title: 'Area under curve', header: ['', ...nm], rows: [
      ['Baseline', ...r.map(() => num(Number(a.params.baseline ?? 0)))], ['Total Area', ...r.map((x) => num(x.total))], ['Total Peak Area (positive)', ...r.map((x) => num(x.positive))],
      ['Negative area', ...r.map((x) => num(x.negative))], ['Number of Peaks', ...r.map((x) => num(x.peaks))], ['Peak X', ...r.map((x) => num(x.peakX))], ['Peak Y', ...r.map((x) => num(x.peakY))], ['Number of points', ...r.map((x) => num(x.n))],
    ] }], nm.map((n, k) => `${n}: AUC=${num(r[k].total)}`).join('; '));
  },
};

export function survivalGroups(t: DataTable, ids?: string[]) {
  const idx = selectedDatasets(t, ids);
  return idx.map((i) => {
    const times: number[] = [], events: number[] = [];
    for (let r = 0; r < rowCount(t); r++) {
      const x = xValue(t, r), e = cellValue(t, i, 0, r);
      if (x !== null && e !== null) {
        times.push(x);
        events.push(e > 0 ? 1 : 0);
      }
    }
    return { idx: i, name: t.datasets[i].title, times, events };
  });
}

const survival: AnalysisDef = {
  kind: 'survival', name: 'Survival analysis (Kaplan-Meier)', category: 'Survival analyses', tableKinds: ['survival'],
  description: 'Kaplan-Meier survival curves, median survival, log-rank (Mantel-Cox) and Gehan-Breslow-Wilcoxon tests, hazard ratios.',
  params: [],
  run(t, a) {
    const groups = survivalGroups(t, a.datasetIds);
    const km = groups.map((g) => kaplanMeier(g.times, g.events));
    const nm = groups.map((g) => g.name);
    const tables: ResultTable[] = [];
    if (groups.length > 1) {
      const lr = logRank(groups);
      tables.push({ title: 'Comparison of Survival Curves', header: ['', ''], rows: [
        ['Log-rank (Mantel-Cox) test', ''], ['Chi square', num(lr.chi2)], ['df', num(lr.df)], ['P value', pv(lr.p)], ['P value summary', stars(lr.p)], ['Are the survival curves sig different?', sig(lr.p)],
        ...(lr.trend ? [['', ''], ['Logrank test for trend', ''], ['Chi square', num(lr.trend.chi2)], ['df', '1'], ['P value', pv(lr.trend.p)]] : []),
        ['', ''], ['Gehan-Breslow-Wilcoxon test', ''], ['Chi square', num(lr.gehan.chi2)], ['df', num(lr.gehan.df)], ['P value', pv(lr.gehan.p)], ['P value summary', stars(lr.gehan.p)], ['Are the survival curves sig different?', sig(lr.gehan.p)],
        ...(lr.hrMH ? [['', ''], ['Hazard Ratio (Mantel-Haenszel)', `${nm[0]}/${nm[1]}`], ['Ratio (and its reciprocal)', `${num(lr.hrMH.hr)} (${num(lr.hrMH.inverse)})`], ['95% CI of ratio', ci(lr.hrMH.lo, lr.hrMH.hi)]] : []),
        ...(lr.hrLogrank ? [['', ''], ['Hazard Ratio (logrank)', `${nm[0]}/${nm[1]}`], ['Ratio (and its reciprocal)', `${num(lr.hrLogrank.hr)} (${num(lr.hrLogrank.inverse)})`], ['95% CI of ratio', ci(lr.hrLogrank.lo, lr.hrLogrank.hi)]] : []),
      ] });
      tables.push({ title: 'Observed vs expected events', header: ['', ...nm], rows: [['Observed', ...lr.observed.map((v) => num(v))], ['Expected', ...lr.expected.map((v) => num(v))]] });
    }
    tables.push({ title: 'Median survival', header: ['', ...nm], rows: [['Median survival', ...km.map((k) => (Number.isFinite(k.median) ? num(k.median) : 'Undefined'))], ['Number of subjects', ...km.map((k) => num(k.n))], ['Number of events', ...km.map((k) => num(k.events))]] });
    km.forEach((k, gi) => tables.push({
      title: `Survival proportions: ${nm[gi]}`, header: ['Time', 'At risk', 'Events', 'Survival %', 'SE', 'Lower 95% CI', 'Upper 95% CI'],
      rows: k.steps.map((s) => [num(s.time), num(s.atRisk), num(s.events), num(100 * s.survival), num(100 * s.se), num(100 * s.lo), num(100 * s.hi)]),
    }));
    const lr = groups.length > 1 ? logRank(groups) : null;
    return out(tables, `Kaplan-Meier: ${nm.map((n, i) => `${n} median=${Number.isFinite(km[i].median) ? num(km[i].median) : 'undefined'}`).join(', ')}${lr ? `; log-rank chi2=${num(lr.chi2)}, P=${pv(lr.p)}` : ''}`,
      { comparisons: lr && groups.length === 2 ? [{ i: groups[0].idx, j: groups[1].idx, p: lr.p, summary: stars(lr.p) }] : [] });
  },
};

const contingency: AnalysisDef = {
  kind: 'contingency', name: 'Chi-square (and Fisher\'s exact) test', category: 'Contingency analyses', tableKinds: ['contingency'],
  description: 'Test association between rows and columns; relative risk, odds ratio and diagnostic statistics for 2×2 tables.',
  params: [
    { key: 'test', label: 'Test', type: 'select', default: 'auto', options: [{ value: 'auto', label: "Fisher's exact for 2×2, chi-square otherwise" }, { value: 'chi2', label: 'Chi-square' }, { value: 'fisher', label: "Fisher's exact (2×2 only)" }, { value: 'trend', label: 'Chi-square test for trend' }] },
    { key: 'yates', label: "Yates' continuity correction (2×2 chi-square)", type: 'boolean', default: false },
  ],
  run(t, a) {
    const idx = selectedDatasets(t, a.datasetIds);
    const rowsIdx: number[] = [];
    for (let r = 0; r < rowCount(t); r++) if (idx.some((i) => cellValue(t, i, 0, r) !== null)) rowsIdx.push(r);
    const tab = rowsIdx.map((r) => idx.map((i) => cellValue(t, i, 0, r) ?? 0));
    const rn = rowsIdx.map((r) => t.rowTitles[r] || `Row ${r + 1}`), cn = names(t, idx);
    if (tab.length < 2 || idx.length < 2) return { tables: [], warnings: ['Need at least 2 rows and 2 columns.'], summary: 'Too small' };
    const is22 = tab.length === 2 && idx.length === 2;
    const test = a.params.test ?? 'auto';
    const tables: ResultTable[] = [];
    const cs = chiSquare(tab, !!a.params.yates);
    let mainP = cs.p;
    if (is22 && (test === 'auto' || test === 'fisher')) {
      const f = fisherExact(tab);
      mainP = f.p;
      tables.push({ title: "Fisher's exact test", header: ['', ''], rows: [['P value', pv(f.p)], ['P value summary', stars(f.p)], ['One- or two-sided', 'Two-sided'], ['Statistically significant (P < 0.05)?', sig(f.p)]] });
    }
    if (test === 'trend' && idx.length === 2) {
      const tr = chiSquareTrend(tab);
      tables.push({ title: 'Chi-square test for trend', header: ['', ''], rows: [['Chi-square', num(tr.chi2)], ['df', '1'], ['P value', pv(tr.p)], ['P value summary', stars(tr.p)]] });
      mainP = tr.p;
    }
    if (!is22 || test === 'chi2' || test === 'auto') {
      tables.push({ title: is22 && a.params.yates ? 'Chi-square with Yates correction' : 'Chi-square test', header: ['', ''], rows: [['Chi-square, df', `${num(cs.chi2)}, ${cs.df}`], ['z', is22 ? num(Math.sqrt(cs.chi2)) : ''], ['P value', pv(cs.p)], ['P value summary', stars(cs.p)], ['Statistically significant (P < 0.05)?', sig(cs.p)]] });
      if (!is22 || test === 'chi2') mainP = cs.p;
    }
    if (cs.minExpected < 5) tables.push({ title: 'Note', header: ['', ''], rows: [['Smallest expected count', num(cs.minExpected)], ['', 'Chi-square may be inaccurate when expected counts are < 5.']] });
    if (is22) {
      const s = twoByTwo(tab);
      tables.push({ title: 'Effect size', header: ['', 'Value', '95% CI'], rows: [
        ['Relative Risk', num(s.relativeRisk.value), ci(s.relativeRisk.lo, s.relativeRisk.hi)], ['Attributable risk (difference)', num(s.attributableRisk.value), ci(s.attributableRisk.lo, s.attributableRisk.hi)],
        ['Odds ratio', num(s.oddsRatio.value), ci(s.oddsRatio.lo, s.oddsRatio.hi)], ['Number needed to treat', num(s.nnt), ''],
      ] });
      tables.push({ title: 'Diagnostic accuracy (rows = test result, columns = disease)', header: ['', 'Value'], rows: [['Sensitivity', num(s.sensitivity)], ['Specificity', num(s.specificity)], ['Positive Predictive Value', num(s.ppv)], ['Negative Predictive Value', num(s.npv)], ['Likelihood Ratio', num(s.lrPositive)]] });
    }
    tables.push({ title: 'Data analyzed', header: ['', ...cn, 'Total'], rows: [...tab.map((r, i) => [rn[i], ...r.map((v) => num(v)), num(cs.rowTotals[i])]), ['Total', ...cs.colTotals.map((v) => num(v)), num(cs.N)]] });
    return out(tables, `Contingency ${rn.length}x${cn.length}: chi2=${num(cs.chi2)}, df=${cs.df}, P=${pv(mainP)}`);
  },
};

const fraction: AnalysisDef = {
  kind: 'fraction', name: 'Fraction of total', category: 'Parts of whole', tableKinds: ['parts', 'column', 'contingency'],
  description: 'Each value as a fraction and percentage of its column total.',
  params: [],
  run(t, a) {
    const idx = selectedDatasets(t, a.datasetIds);
    const n = rowCount(t);
    const tables = idx.map((i) => {
      const vals = Array.from({ length: n }, (_, r) => cellValue(t, i, 0, r));
      const total = sum(vals.filter((v): v is number => v !== null));
      return {
        title: t.datasets[i].title, header: ['Row', 'Value', 'Fraction', 'Percentage'],
        rows: [...vals.map((v, r) => (v === null ? null : [t.rowTitles[r] || `Row ${r + 1}`, num(v), num(v / total), `${num((100 * v) / total)}%`])).filter((x): x is string[] => !!x), ['Total', num(total), '1', '100%']],
      } as ResultTable;
    });
    return out(tables, 'Fraction of total computed.');
  },
};

const freqDist: AnalysisDef = {
  kind: 'freqDist', name: 'Frequency distribution (histogram)', category: 'Column analyses', tableKinds: ['column', 'multi', 'xy'],
  description: 'Bin values to make a histogram, optionally cumulative or as relative frequencies. Creates a graphable results table.',
  params: [
    { key: 'binWidth', label: 'Bin width (0 = automatic)', type: 'number', default: 0 },
    { key: 'cumulative', label: 'Cumulative', type: 'boolean', default: false },
    { key: 'relative', label: 'Tabulate', type: 'select', default: 'counts', options: [{ value: 'counts', label: 'Number of values' }, { value: 'fraction', label: 'Relative frequency (fractions)' }, { value: 'percent', label: 'Relative frequency (percentages)' }] },
  ],
  run(t, a) {
    const g = getGroups(t, a);
    const all = g.raw.flat();
    let width = Number(a.params.binWidth) || 0;
    const fd0 = frequencyDistribution(all, { binWidth: width || undefined });
    width = fd0.binWidth;
    const start = Math.floor(Math.min(...all) / width) * width;
    const fds = g.raw.map((v) => frequencyDistribution(v, { binWidth: width, binStart: start, cumulative: !!a.params.cumulative, relative: a.params.relative }));
    const nb = Math.max(...fds.map((f) => f.centers.length));
    const centers = Array.from({ length: nb }, (_, i) => start + width * (i + 0.5));
    const d = derived(t, a, 'xy', `Frequency distribution of ${t.name}`);
    d.xTitle = 'Bin center';
    d.x = centers;
    d.datasets = g.names.map((nm, k) => ({ id: `${d.id}:${k}`, title: nm, cols: [centers.map((_, b) => fds[k].values[b] ?? 0)] }));
    return out([{ title: 'Frequency distribution', header: ['Bin center', ...g.names], rows: centers.map((c, b) => [num(c), ...fds.map((f) => num(f.values[b] ?? 0))]) }],
      `Histogram with bin width ${num(width)}, ${nb} bins.`, { derivedTable: d });
  },
};

const outliers: AnalysisDef = {
  kind: 'outliers', name: 'Identify outliers (Grubbs)', category: 'Column analyses', tableKinds: ['column', 'multi', 'xy', 'grouped'],
  description: "Iterative Grubbs' test to flag outliers in each column.",
  params: [{ key: 'alpha', label: 'Alpha', type: 'number', default: 0.05 }],
  run(t, a) {
    const g = getGroups(t, a);
    const r = g.raw.map((v) => grubbs(v, Number(a.params.alpha ?? 0.05)));
    const d = derived(t, a, 'column', `Cleaned data from ${t.name}`);
    d.datasets = g.names.map((nm, k) => ({ id: `${d.id}:${k}`, title: nm, cols: [g.raw[k].filter((_, i) => !r[k].outliers.includes(i))] }));
    return out([{ title: "Grubbs' outlier test", header: ['', ...g.names], rows: [
      ['Number of values', ...g.raw.map((v) => num(v.length))], ['Outliers found', ...r.map((x) => num(x.outliers.length))], ['Outlier values', ...r.map((x, k) => x.outliers.map((i) => num(g.raw[k][i])).join(', '))], ['Values kept', ...r.map((x, k) => num(g.raw[k].length - x.outliers.length))],
    ] }], g.names.map((n, k) => `${n}: ${r[k].outliers.length} outlier(s)`).join('; '), { derivedTable: d });
  },
};

const roc: AnalysisDef = {
  kind: 'roc', name: 'ROC curve', category: 'Column analyses', tableKinds: ['column'], minDatasets: 2,
  description: 'Receiver-operator characteristic curve comparing controls (first column) to patients (second column); area under the curve.',
  params: [{ key: 'higher', label: 'Test values are higher in patients', type: 'boolean', default: true }],
  run(t, a) {
    const g = getGroups(t, a);
    if (g.raw.length < 2) return { tables: [], warnings: ['Need controls and patients columns.'], summary: 'Needs two data sets' };
    const r = rocCurve(g.raw[0], g.raw[1], a.params.higher !== false);
    const d = derived(t, a, 'xy', `ROC curve of ${t.name}`);
    d.xTitle = '100% - Specificity%';
    const pts = [...r.points].sort((p, q) => 100 - p.specificity - (100 - q.specificity) || p.sensitivity - q.sensitivity);
    d.x = pts.map((p) => 100 - p.specificity);
    d.datasets = [{ id: `${d.id}:0`, title: 'Sensitivity%', cols: [pts.map((p) => p.sensitivity)] }];
    return out([
      { title: 'Area under the ROC curve', header: ['', ''], rows: [['Area', num(r.auc)], ['Std. Error', num(r.se)], ['95% confidence interval', ci(r.ciLo, r.ciHi)], ['P value', pv(r.p)], [`Controls (${g.names[0]})`, num(r.nControls)], [`Patients (${g.names[1]})`, num(r.nPatients)]] },
      { title: 'Sensitivity and specificity', header: ['Cutoff', 'Sensitivity%', '95% CI', 'Specificity%', '95% CI', 'Likelihood ratio'], rows: r.points.map((p) => [`${a.params.higher !== false ? '>' : '<'} ${num(p.cutoff)}`, num(p.sensitivity), ci(p.sensLo, p.sensHi), num(p.specificity), ci(p.specLo, p.specHi), num(p.lr)]) },
    ], `ROC AUC=${num(r.auc)} (95% CI ${ci(r.ciLo, r.ciHi)}), P=${pv(r.p)}`, { derivedTable: d });
  },
};

const bland: AnalysisDef = {
  kind: 'blandAltman', name: 'Bland-Altman method comparison', category: 'Column analyses', tableKinds: ['column', 'multi'], minDatasets: 2,
  description: 'Bias and 95% limits of agreement between two methods measured on the same subjects.',
  params: [{ key: 'mode', label: 'Plot', type: 'select', default: 'difference', options: [{ value: 'difference', label: 'Difference (A - B) vs. average' }, { value: 'ratio', label: 'Ratio (A/B) vs. average' }, { value: 'percent', label: '% difference vs. average' }] }],
  run(t, a) {
    const idx = selectedDatasets(t, a.datasetIds).slice(0, 2);
    const rows = getRows(t, idx);
    const r = blandAltman(rows.map((x) => x[0]), rows.map((x) => x[1]), a.params.mode);
    const d = derived(t, a, 'xy', `Bland-Altman of ${t.name}`);
    d.xTitle = 'Average';
    d.x = r.pairs.map((p) => p.avg);
    d.datasets = [{ id: `${d.id}:0`, title: a.params.mode === 'ratio' ? 'Ratio' : a.params.mode === 'percent' ? '% Difference' : 'Difference', cols: [r.pairs.map((p) => p.diff)] }];
    return out([{ title: 'Bland-Altman', header: ['', ''], rows: [['Bias', num(r.bias)], ['SD of bias', num(r.sd)], ['95% Limits of Agreement', ci(r.loaLo, r.loaHi)], ['Number of pairs', num(r.n)]] }],
      `Bias=${num(r.bias)}, 95% LoA ${ci(r.loaLo, r.loaHi)}`, { derivedTable: d });
  },
};

const multiReg: AnalysisDef = {
  kind: 'multiReg', name: 'Multiple linear regression', category: 'Multiple variable analyses', tableKinds: ['multi'], minDatasets: 2,
  description: 'Predict one variable from several others (least squares), with coefficients, P values, R² and multicollinearity (VIF).',
  params: [{ key: 'dependent', label: 'Dependent (Y) variable', type: 'dataset', default: -1 }],
  run(t, a) {
    const idx = selectedDatasets(t, a.datasetIds);
    let dep = Number(a.params.dependent ?? -1);
    if (dep < 0 || dep >= idx.length) dep = idx.length - 1;
    const yIdx = idx[dep];
    const xIdx = idx.filter((_, k) => k !== dep);
    const n = rowCount(t);
    const X: number[][] = [], y: number[] = [];
    for (let r = 0; r < n; r++) {
      const yv = cellValue(t, yIdx, 0, r);
      const xv = xIdx.map((i) => cellValue(t, i, 0, r));
      if (yv !== null && xv.every((v) => v !== null)) {
        X.push(xv as number[]);
        y.push(yv);
      }
    }
    const xn = names(t, xIdx);
    const r = multipleRegression(X, y, xn);
    return out([
      { title: `Multiple linear regression: ${t.datasets[yIdx].title}`, header: ['Parameter', 'Estimate', 'Std. Error', '95% CI', '|t|', 'P value', 'VIF'], rows: r.coefs.map((c) => [c.name, num(c.estimate), num(c.se), ci(c.ciLo, c.ciHi), num(Math.abs(c.t)), pv(c.p), Number.isFinite(c.vif) ? num(c.vif) : '']) },
      { title: 'Goodness of fit', header: ['', ''], rows: [['R squared', num(r.r2)], ['Adjusted R squared', num(r.adjR2)], ['Sy.x', num(r.syx)], ['F (DFn, DFd)', `${num(r.F)} (${r.dfn}, ${r.dfd})`], ['P value', pv(r.pF)], ['Number of observations', num(r.n)]] },
    ], `Multiple regression of ${t.datasets[yIdx].title}: R²=${num(r.r2)}, F P=${pv(r.pF)}; ` + r.coefs.map((c) => `${c.name}=${num(c.estimate)} (P=${pv(c.p)})`).join(', '));
  },
};

const pcaDef: AnalysisDef = {
  kind: 'pca', name: 'Principal component analysis (PCA)', category: 'Multiple variable analyses', tableKinds: ['multi'], minDatasets: 2,
  description: 'Eigenvalues, explained variance, loadings and PC scores. Scores can be graphed.',
  params: [{ key: 'standardize', label: 'Standardize variables (use correlation matrix)', type: 'boolean', default: true }],
  run(t, a) {
    const idx = selectedDatasets(t, a.datasetIds);
    const nm = names(t, idx);
    const data: number[][] = [];
    for (let r = 0; r < rowCount(t); r++) {
      const row = idx.map((i) => cellValue(t, i, 0, r));
      if (row.every((v) => v !== null)) data.push(row as number[]);
    }
    const r = pca(data, nm, a.params.standardize !== false);
    const pcs = r.variance.map((_, i) => `PC${i + 1}`);
    const d = derived(t, a, 'xy', `PC scores of ${t.name}`);
    d.xTitle = 'PC1';
    d.x = r.scores.map((s) => s[0]);
    d.datasets = pcs.slice(1).map((pc, k) => ({ id: `${d.id}:${k}`, title: pc, cols: [r.scores.map((s) => s[k + 1])] }));
    return out([
      { title: 'Eigenvalues', header: ['', ...pcs], rows: [['Eigenvalue', ...r.variance.map((v) => num(v.eigenvalue))], ['Proportion of variance', ...r.variance.map((v) => `${num(v.proportion)}%`)], ['Cumulative proportion', ...r.variance.map((v) => `${num(v.cumulative)}%`)], ['Kaiser rule (eigenvalue > 1)', ...r.variance.map((v) => (v.eigenvalue > 1 ? 'Retain' : ''))]] },
      { title: 'Loadings', header: ['Variable', ...pcs], rows: nm.map((n, i) => [n, ...r.loadings[i].map((v) => num(v))]) },
      { title: 'Eigenvectors', header: ['Variable', ...pcs], rows: nm.map((n, i) => [n, ...r.eigenvectors[i].map((v) => num(v))]) },
    ], `PCA on ${nm.length} variables, n=${r.n}: ` + r.variance.map((v, i) => `PC${i + 1} ${num(v.proportion)}%`).join(', '), { derivedTable: d });
  },
};

const TRANSFORMS: Record<string, { label: string; f: (y: number, K: number) => number }> = {
  log10: { label: 'Y = log10(Y)', f: (y) => Math.log10(y) },
  ln: { label: 'Y = ln(Y)', f: (y) => Math.log(y) },
  log2: { label: 'Y = log2(Y)', f: (y) => Math.log2(y) },
  exp10: { label: 'Y = 10^Y', f: (y) => Math.pow(10, y) },
  exp: { label: 'Y = e^Y', f: (y) => Math.exp(y) },
  recip: { label: 'Y = 1/Y', f: (y) => 1 / y },
  sqrt: { label: 'Y = sqrt(Y)', f: (y) => Math.sqrt(y) },
  square: { label: 'Y = Y²', f: (y) => y * y },
  abs: { label: 'Y = |Y|', f: (y) => Math.abs(y) },
  times: { label: 'Y = Y * K', f: (y, K) => y * K },
  plus: { label: 'Y = Y + K', f: (y, K) => y + K },
  minus: { label: 'Y = Y - K', f: (y, K) => y - K },
  divide: { label: 'Y = Y / K', f: (y, K) => y / K },
  power: { label: 'Y = Y^K', f: (y, K) => Math.pow(y, K) },
  logit: { label: 'Y = ln(Y/(1-Y))', f: (y) => Math.log(y / (1 - y)) },
  zscore: { label: 'Z score (per data set)', f: (y) => y },
};

const transform: AnalysisDef = {
  kind: 'transform', name: 'Transform', category: 'Data processing', tableKinds: ['xy', 'column', 'grouped', 'multi'],
  description: 'Apply a function to every Y (or X) value. Creates a new linked results table.',
  params: [
    { key: 'fn', label: 'Function', type: 'select', default: 'log10', options: Object.entries(TRANSFORMS).map(([value, v]) => ({ value, label: v.label })) },
    { key: 'K', label: 'K', type: 'number', default: 1 },
    { key: 'target', label: 'Apply to', type: 'select', default: 'y', options: [{ value: 'y', label: 'Y values' }, { value: 'x', label: 'X values (XY tables)' }] },
  ],
  run(t, a) {
    const tr = TRANSFORMS[a.params.fn ?? 'log10'] ?? TRANSFORMS.log10;
    const K = Number(a.params.K ?? 1);
    const d: DataTable = { ...structuredClone(t), id: `derived:${a.id}`, name: `Transform of ${t.name}`, derivedFrom: a.id, excluded: [], notes: `${tr.label}` };
    const fx = (v: Cell) => (v === null || v === undefined ? null : finiteOrNull(tr.f(v, K)));
    if (a.params.target === 'x' && t.kind === 'xy') d.x = t.x.map(fx);
    else {
      const summary = isSummaryFormat(t);
      d.datasets = t.datasets.map((ds, di) => {
        if (a.params.fn === 'zscore') {
          const vals = datasetValues(t, di);
          const m = mean(vals), s = sd(vals);
          return { ...ds, cols: ds.cols.map((c) => c.map((v, r) => (v === null || isExcludedCell(t, ds.id, 0, r) ? null : (v - m) / s))) };
        }
        return { ...ds, cols: ds.cols.map((c, s) => (summary && s > 0 ? c : c.map(fx))) };
      });
      if (summary && a.params.fn !== 'times' && a.params.fn !== 'plus' && a.params.fn !== 'minus') d.yFormat = 'replicates';
    }
    return out([{ title: 'Transform', header: ['', ''], rows: [['Function', tr.label], ['K', num(K)], ['Result', 'See the linked results table (graphable).']] }], `Applied ${tr.label}`, { derivedTable: d });
  },
};

function finiteOrNull(v: number) {
  return Number.isFinite(v) ? v : null;
}
function isExcludedCell(t: DataTable, id: string, s: number, r: number) {
  return t.excluded.includes(`${id}:${s}:${r}`);
}

const normalize: AnalysisDef = {
  kind: 'normalize', name: 'Normalize', category: 'Data processing', tableKinds: ['xy', 'column', 'grouped'],
  description: 'Rescale each data set so the smallest value is 0% and the largest is 100% (or use custom definitions).',
  params: [
    { key: 'zero', label: '0% is', type: 'select', default: 'min', options: [{ value: 'min', label: 'Smallest value in each data set' }, { value: 'first', label: 'First value in each data set' }, { value: 'value', label: 'A fixed value' }] },
    { key: 'zeroValue', label: '0% value', type: 'number', default: 0, showIf: (p) => p.zero === 'value' },
    { key: 'hundred', label: '100% is', type: 'select', default: 'max', options: [{ value: 'max', label: 'Largest value in each data set' }, { value: 'last', label: 'Last value in each data set' }, { value: 'value', label: 'A fixed value' }] },
    { key: 'hundredValue', label: '100% value', type: 'number', default: 100, showIf: (p) => p.hundred === 'value' },
    { key: 'output', label: 'Present results as', type: 'select', default: 'percent', options: [{ value: 'percent', label: 'Percentages' }, { value: 'fraction', label: 'Fractions' }] },
  ],
  run(t, a) {
    const d: DataTable = { ...structuredClone(t), id: `derived:${a.id}`, name: `Normalized ${t.name}`, derivedFrom: a.id, excluded: [] };
    const summary = isSummaryFormat(t);
    const lines: string[][] = [];
    d.datasets = t.datasets.map((ds, di) => {
      const vals = summary ? Array.from({ length: rowCount(t) }, (_, r) => cellValue(t, di, 0, r)).filter((v): v is number => v !== null) : datasetValues(t, di);
      if (!vals.length) return ds;
      const z = a.params.zero === 'first' ? vals[0] : a.params.zero === 'value' ? Number(a.params.zeroValue) : Math.min(...vals);
      const h = a.params.hundred === 'last' ? vals[vals.length - 1] : a.params.hundred === 'value' ? Number(a.params.hundredValue) : Math.max(...vals);
      const scale = (a.params.output === 'fraction' ? 1 : 100) / (h - z);
      lines.push([ds.title, num(z), num(h)]);
      return { ...ds, cols: ds.cols.map((c, s) => c.map((v) => (v === null || v === undefined ? null : summary && s > 0 ? (s === 2 ? v : v * Math.abs(scale)) : (v - z) * scale))) };
    });
    return out([{ title: 'Normalization', header: ['Data set', '0% value', '100% value'], rows: lines }], 'Normalized data sets', { derivedTable: d });
  },
};

const rowStats: AnalysisDef = {
  kind: 'rowStats', name: 'Row means with SD or SEM', category: 'Data processing', tableKinds: ['xy', 'grouped'],
  description: 'Mean, SD/SEM and N of the replicates in each row, as a new table.',
  params: [{ key: 'error', label: 'Error', type: 'select', default: 'sd', options: [{ value: 'sd', label: 'SD' }, { value: 'sem', label: 'SEM' }] }],
  run(t, a) {
    const idx = selectedDatasets(t, a.datasetIds);
    const d: DataTable = { ...structuredClone(t), id: `derived:${a.id}`, name: `Row statistics of ${t.name}`, derivedFrom: a.id, excluded: [], yFormat: a.params.error === 'sem' ? 'meanSEMN' : 'meanSDN', replicates: 1 };
    const n = rowCount(t);
    d.datasets = idx.map((i) => {
      const mcol: Cell[] = [], ecol: Cell[] = [], ncol: Cell[] = [];
      for (let r = 0; r < n; r++) {
        const s = cellStats(t, i, r).summary;
        mcol.push(s ? s.mean : null);
        ecol.push(s && Number.isFinite(s.sd) ? (a.params.error === 'sem' ? s.sd / Math.sqrt(s.n) : s.sd) : null);
        ncol.push(s ? s.n : null);
      }
      return { id: `${d.id}:${i}`, title: t.datasets[i].title, cols: [mcol, ecol, ncol] };
    });
    return out([{ title: 'Row statistics', header: ['Row', ...d.datasets.flatMap((ds) => [`${ds.title} Mean`, a.params.error === 'sem' ? 'SEM' : 'SD', 'N'])], rows: Array.from({ length: n }, (_, r) => [t.rowTitles[r] || (t.kind === 'xy' ? `X=${t.x[r] ?? ''}` : `Row ${r + 1}`), ...d.datasets.flatMap((ds) => ds.cols.map((c) => num(c[r] ?? NaN)))]) }], 'Row means computed', { derivedTable: d });
  },
};

export const ANALYSES: AnalysisDef[] = [
  descriptive, normality, oneSample, ttest, anova1, outliers, freqDist, roc, bland,
  linreg, nonlin, correlation, auc,
  anova2, multipleT,
  contingency, survival, fraction,
  corrMatrix, multiReg, pcaDef,
  transform, normalize, rowStats,
];

export function analysisDef(kind: AnalysisKind): AnalysisDef {
  const d = ANALYSES.find((x) => x.kind === kind);
  if (!d) throw new Error(`Unknown analysis ${kind}`);
  return d;
}

export function defaultParams(kind: AnalysisKind): Record<string, any> {
  const p: Record<string, any> = {};
  for (const d of analysisDef(kind).params) p[d.key] = d.default;
  return p;
}

const cache = new WeakMap<object, WeakMap<object, AnalysisOutput>>();

export function runAnalysis(t: DataTable, a: Analysis): AnalysisOutput {
  let inner = cache.get(t);
  if (!inner) {
    inner = new WeakMap();
    cache.set(t, inner);
  }
  const hit = inner.get(a);
  if (hit) return hit;
  let res: AnalysisOutput;
  try {
    const def = analysisDef(a.kind);
    if (!def.tableKinds.includes(t.kind)) res = { tables: [], warnings: [`${def.name} is not available for ${t.kind} tables.`], summary: 'Not applicable' };
    else res = def.run(t, a);
  } catch (e: any) {
    res = { tables: [], warnings: [`Analysis failed: ${e?.message ?? e}`], summary: `Error: ${e?.message ?? e}` };
  }
  inner.set(a, res);
  return res;
}

export function resultsToText(res: AnalysisOutput, maxRows = 60): string {
  const parts: string[] = [];
  if (res.warnings.length) parts.push('Warnings: ' + res.warnings.join(' | '));
  for (const tb of res.tables) {
    parts.push(`## ${tb.title}`);
    parts.push(tb.header.join('\t'));
    for (const r of tb.rows.slice(0, maxRows)) parts.push(r.join('\t'));
    if (tb.rows.length > maxRows) parts.push(`... ${tb.rows.length - maxRows} more rows`);
  }
  return parts.join('\n');
}

export { uid, emptyDataset, subcolCount };
