import { describe, expect, it } from 'vitest';
import ref from './fixtures/scipy-ref.json';
import { chi2Inv, chi2Sf, fSf, normInv, ptukey, qtukey, tCdf, tInv } from '../src/stats/distributions';
import { mannWhitney, oneSampleT, pairedT, pearson, shapiroWilk, spearman, summarize, unpairedT, wilcoxonSignedRank, dagostinoPearson } from '../src/stats/tests';
import { friedman, kruskalWallis, oneWayAnova, postHoc, twoWayAnova } from '../src/stats/anova';
import { chiSquare, fisherExact, kaplanMeier, logRank } from '../src/stats/misc';
import { linearRegression, nonlinearFit, NL_MODELS } from '../src/stats/regression';
import { describe as describeStats } from '../src/stats/descriptive';

const R: any = ref;
const close = (a: number, b: number, rel = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(b)));
const { a, b, c } = R.data as { a: number[]; b: number[]; c: number[] };

describe('distributions', () => {
  it('t, F, chi2, normal', () => {
    [[1.5, 3], [-2.2, 10], [0.3, 1], [4.0, 50]].forEach(([x, df], i) => close(tCdf(x, df), R.dist.tcdf[i], 1e-9));
    [[0.975, 3], [0.995, 10], [0.9, 1], [0.975, 120]].forEach(([p, df], i) => close(tInv(p, df), R.dist.tinv[i], 1e-8));
    [[3.2, 2, 20], [1.1, 5, 7], [10, 1, 3]].forEach(([x, d1, d2], i) => close(fSf(x, d1, d2), R.dist.fsf[i], 1e-9));
    [[3.84, 1], [10, 4], [0.5, 3]].forEach(([x, k], i) => close(chi2Sf(x, k), R.dist.chi2sf[i], 1e-9));
    [[0.95, 1], [0.5, 4], [0.999, 10]].forEach(([p, k], i) => close(chi2Inv(p, k), R.dist.chi2inv[i], 1e-8));
    [0.001, 0.025, 0.4, 0.975, 0.999999].forEach((p, i) => close(normInv(p), R.dist.norminv[i], 1e-9));
  });
  it('studentized range', () => {
    [[3.5, 3, 12], [2.0, 4, 20], [4.5, 5, 30], [3.0, 2, 8]].forEach(([q, k, df], i) => close(ptukey(q, k, df), R.dist.ptukey[i], 1e-6));
    [[3, 12], [4, 20], [6, 40]].forEach(([k, df], i) => close(qtukey(0.95, k, df), R.dist.qtukey[i], 1e-5));
  });
});

describe('tests', () => {
  it('t tests', () => {
    const s = unpairedT(summarize(a), summarize(b));
    close(Math.abs(s.t), Math.abs(R.ttest.student[0]));
    close(s.p, R.ttest.student[1]);
    const w = unpairedT(summarize(a), summarize(b), true);
    close(w.p, R.ttest.welch[1]);
    const p = pairedT(a.slice(0, 7), b);
    close(p.p, R.ttest.paired[1]);
    const o = oneSampleT(a, 30);
    close(o.p, R.ttest.one[1]);
  });
  it('nonparametric', () => {
    close(mannWhitney(a, b).p, R.mw, 1e-9);
    close(wilcoxonSignedRank(b.map((v, i) => v - a[i])).p, R.wilcoxon, 1e-9);
  });
  it('normality and correlation', () => {
    const sw = shapiroWilk([...a, ...c]);
    close(sw.W, R.shapiro[0], 1e-4);
    close(sw.p, R.shapiro[1], 2e-3);
    const dp = dagostinoPearson([...a, ...c, ...b]);
    close(dp.K2, R.dagostino[0], 1e-6);
    close(pearson(a.slice(0, 7), b).r, R.pearson[0]);
    close(pearson(a.slice(0, 7), b).p, R.pearson[1]);
    close(spearman(a.slice(0, 7), b).r, R.spearman[0]);
  });
});

describe('anova', () => {
  it('one-way + Tukey + Dunnett', () => {
    const g = [a, b, c].map(summarize);
    const r = oneWayAnova(g, ['a', 'b', 'c'], 'tukey');
    close(r.F, R.anova[0]);
    close(r.p, R.anova[1]);
    r.comparisons.forEach((cmp, i) => close(cmp.p, R.tukey[i], 2e-4));
    const d = postHoc(g, ['a', 'b', 'c'], 'dunnett', r.mse, r.dfd, { control: 0 });
    d.forEach((cmp, i) => close(cmp.p, R.dunnett[i], 3e-3));
  });
  it('Kruskal-Wallis and Friedman', () => {
    const kw = kruskalWallis([a, b, c], ['a', 'b', 'c']);
    close(kw.H, R.kruskal[0]);
    const rows = b.map((_, i) => [a[i], b[i], c[i]]);
    const fr = friedman(rows, ['a', 'b', 'c']);
    close(fr.Q, R.friedman[0]);
  });
  it('two-way type III', () => {
    const cells = [0, 1, 2].map((i) => [0, 1].map((j) => R.twoway.cells[`${i},${j}`] as number[]));
    const r = twoWayAnova(cells, ['R1', 'R2', 'R3'], ['A', 'B']);
    const get = (s: string) => r.table.find((t) => t.source === s)!;
    close(get('Interaction').F!, R.twoway.F_int, 1e-6);
    close(get('Row Factor').F!, R.twoway.F_row, 1e-6);
    close(get('Column Factor').F!, R.twoway.F_col, 1e-6);
    close(get('Residual').ss, R.twoway.ss_res, 1e-8);
  });
});

describe('other analyses', () => {
  it('contingency', () => {
    close(fisherExact([[3, 12], [9, 4]]).p, R.fisher, 1e-9);
    const cs = chiSquare([[20, 15, 8], [10, 22, 18]]);
    close(cs.chi2, R.chi2[0]);
    close(cs.p, R.chi2[1]);
  });
  it('linear regression', () => {
    const f = linearRegression(a.slice(0, 7), b);
    close(f.slope, R.linreg[0]);
    close(f.intercept, R.linreg[1]);
    close(f.r2, R.linreg[2]);
    close(f.p, R.linreg[3]);
    close(f.seSlope, R.linreg[4]);
  });
  it('4PL nonlinear fit', () => {
    const m = NL_MODELS.find((x) => x.id === 'logAgonist4')!;
    const { x, y, p, se } = R.fit4pl;
    const fit = nonlinearFit(m.f, x, y, m.guess(x, y));
    fit.params.forEach((v, i) => close(v, p[i], 1e-4));
    fit.se.forEach((v, i) => close(v, se[i], 1e-3));
  });
  it('survival logrank', () => {
    const lr = R.logrank;
    const res = logRank([{ times: lr.t1, events: lr.e1 }, { times: lr.t2, events: lr.e2 }]);
    close(res.chi2, lr.chi2, 1e-8);
    close(res.p, lr.p, 1e-8);
    const km = kaplanMeier(lr.t1, lr.e1);
    expect(km.steps.length).toBeGreaterThan(3);
  });
  it('descriptive', () => {
    const d = describeStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(d.q25).toBeCloseTo(2.75, 10);
    expect(d.median).toBeCloseTo(5.5, 10);
    expect(d.q75).toBeCloseTo(8.25, 10);
  });
});
