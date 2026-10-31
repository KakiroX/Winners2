import { CellArray, MError, StructArray, Tensor, bool, cellOf, isStringLike, num, str, toNumber, toStringValue, toTensor, zeros, colVec, rowVec, type Value } from '../value';
import type { Interpreter } from '../interp';
import { argNum, argT, def, mapReal, minArgs, nameValues, rng, dimsArgs } from './helpers';
import * as D from '../../stats/distributions';
import { mannWhitney, oneSampleT, pairedT, summarize, unpairedT, wilcoxonSignedRank, shapiroWilk, pearson, spearman } from '../../stats/tests';
import { kruskalWallis, oneWayAnova } from '../../stats/anova';
import { multipleRegression, linearRegression } from '../../stats/regression';
import { mldivide } from '../ops';

function map2(a: Value[], f: (x: number, p: number[]) => number, nparams: number, defaults: number[] = []) {
  const x = argT(a, 0);
  const params = Array.from({ length: nparams }, (_, i) => (i + 1 < a.length ? toTensor(a[i + 1]) : num(defaults[i] ?? NaN)));
  const n = Math.max(x.numel, ...params.map((p) => p.numel));
  const shape = [x, ...params].find((t) => t.numel === n)!;
  const out = zeros(shape.rows, shape.cols);
  for (let i = 0; i < n; i++) out.re[i] = f(x.re[x.numel === 1 ? 0 : i], params.map((p) => p.re[p.numel === 1 ? 0 : i]));
  return out;
}

function rand(a: Value[], start: number, gen: () => number): Tensor {
  const d = dimsArgs(a.slice(start));
  const out = zeros(d.r, d.c);
  for (let i = 0; i < out.numel; i++) out.re[i] = gen();
  return out;
}

export function registerStatsFns(I: Interpreter) {
  def(I, 'normpdf', (a) => map2(a, (x, [m, s]) => D.normPdf(x, m, s), 2, [0, 1]));
  def(I, 'normcdf', (a) => map2(a, (x, [m, s]) => D.normCdf(x, m, s), 2, [0, 1]));
  def(I, 'norminv', (a) => map2(a, (p, [m, s]) => D.normInv(p, m, s), 2, [0, 1]));
  def(I, 'tpdf', (a) => map2(a, (x, [v]) => D.tPdf(x, v), 1));
  def(I, 'tcdf', (a) => {
    const upper = a.some((x) => isStringLike(x) && toStringValue(x) === 'upper');
    return map2(a.filter((x) => !isStringLike(x)), (x, [v]) => (upper ? 1 - D.tCdf(x, v) : D.tCdf(x, v)), 1);
  });
  def(I, 'tinv', (a) => map2(a, (p, [v]) => D.tInv(p, v), 1));
  def(I, 'fcdf', (a) => {
    const upper = a.some((x) => isStringLike(x) && toStringValue(x) === 'upper');
    return map2(a.filter((x) => !isStringLike(x)), (x, [d1, d2]) => (upper ? D.fSf(x, d1, d2) : D.fCdf(x, d1, d2)), 2);
  });
  def(I, 'finv', (a) => map2(a, (p, [d1, d2]) => D.fInv(p, d1, d2), 2));
  def(I, 'fpdf', (a) => map2(a, (x, [d1, d2]) => (x < 0 ? 0 : Math.exp(0.5 * (d1 * Math.log(d1 * x) + d2 * Math.log(d2) - (d1 + d2) * Math.log(d1 * x + d2)) - Math.log(x) - D.lbeta(d1 / 2, d2 / 2))), 2));
  def(I, 'chi2cdf', (a) => {
    const upper = a.some((x) => isStringLike(x) && toStringValue(x) === 'upper');
    return map2(a.filter((x) => !isStringLike(x)), (x, [k]) => (upper ? D.chi2Sf(x, k) : D.chi2Cdf(x, k)), 1);
  });
  def(I, 'chi2inv', (a) => map2(a, (p, [k]) => D.chi2Inv(p, k), 1));
  def(I, 'chi2pdf', (a) => map2(a, (x, [k]) => (x < 0 ? 0 : Math.exp((k / 2 - 1) * Math.log(x) - x / 2 - (k / 2) * Math.LN2 - D.lgamma(k / 2))), 1));
  def(I, 'betapdf', (a) => map2(a, (x, [p, q]) => D.betaPdf(x, p, q), 2));
  def(I, 'betacdf', (a) => map2(a, (x, [p, q]) => D.betaInc(x, p, q), 2));
  def(I, 'betainv', (a) => map2(a, (x, [p, q]) => D.betaIncInv(x, p, q), 2));
  def(I, 'gampdf', (a) => map2(a, (x, [k, th]) => (x < 0 ? 0 : Math.exp((k - 1) * Math.log(x) - x / th - D.lgamma(k) - k * Math.log(th))), 2, [1, 1]));
  def(I, 'gamcdf', (a) => map2(a, (x, [k, th]) => D.gammaP(k, x / th), 2, [1, 1]));
  def(I, 'exppdf', (a) => map2(a, (x, [mu]) => (x < 0 ? 0 : Math.exp(-x / mu) / mu), 1, [1]));
  def(I, 'expcdf', (a) => map2(a, (x, [mu]) => (x < 0 ? 0 : 1 - Math.exp(-x / mu)), 1, [1]));
  def(I, 'expinv', (a) => map2(a, (p, [mu]) => -mu * Math.log(1 - p), 1, [1]));
  def(I, 'unifpdf', (a) => map2(a, (x, [lo, hi]) => (x >= lo && x <= hi ? 1 / (hi - lo) : 0), 2, [0, 1]));
  def(I, 'unifcdf', (a) => map2(a, (x, [lo, hi]) => Math.min(1, Math.max(0, (x - lo) / (hi - lo))), 2, [0, 1]));
  def(I, 'binopdf', (a) => map2(a, (k, [n, p]) => D.binomPmf(k, n, p), 2));
  def(I, 'binocdf', (a) => map2(a, (k, [n, p]) => D.binomCdf(Math.floor(k), n, p), 2));
  def(I, 'poisspdf', (a) => map2(a, (k, [l]) => (k < 0 || !Number.isInteger(k) ? 0 : Math.exp(k * Math.log(l) - l - D.lgamma(k + 1))), 1));
  def(I, 'poisscdf', (a) => map2(a, (k, [l]) => D.poissonCdf(Math.floor(k), l), 1));
  def(I, 'lognpdf', (a) => map2(a, (x, [m, s]) => (x <= 0 ? 0 : D.normPdf(Math.log(x), m, s) / x), 2, [0, 1]));
  def(I, 'logncdf', (a) => map2(a, (x, [m, s]) => (x <= 0 ? 0 : D.normCdf(Math.log(x), m, s)), 2, [0, 1]));
  def(I, 'wblcdf', (a) => map2(a, (x, [l, k]) => (x < 0 ? 0 : 1 - Math.exp(-Math.pow(x / l, k))), 2, [1, 1]));
  def(I, 'normrnd', (a) => {
    const m = argNum(a, 0), s = argNum(a, 1);
    return rand(a, 2, () => m + s * rng.normal());
  });
  def(I, 'unifrnd', (a) => {
    const lo = argNum(a, 0), hi = argNum(a, 1);
    return rand(a, 2, () => lo + (hi - lo) * rng.next());
  });
  def(I, 'exprnd', (a) => {
    const mu = argNum(a, 0);
    return rand(a, 1, () => -mu * Math.log(1 - rng.next()));
  });
  def(I, 'poissrnd', (a) => {
    const l = argNum(a, 0);
    return rand(a, 1, () => {
      let k = 0, p = 1;
      const L = Math.exp(-l);
      do {
        k++;
        p *= rng.next();
      } while (p > L);
      return k - 1;
    });
  });
  def(I, 'binornd', (a) => {
    const n = argNum(a, 0), p = argNum(a, 1);
    return rand(a, 2, () => {
      let s = 0;
      for (let i = 0; i < n; i++) if (rng.next() < p) s++;
      return s;
    });
  });
  def(I, 'random', (a) => {
    const dist = toStringValue(a[0]).toLowerCase();
    if (dist === 'normal' || dist === 'norm') {
      const m = argNum(a, 1), s = argNum(a, 2);
      return rand(a, 3, () => m + s * rng.normal());
    }
    if (dist === 'uniform') {
      const lo = argNum(a, 1), hi = argNum(a, 2);
      return rand(a, 3, () => lo + (hi - lo) * rng.next());
    }
    if (dist === 'exponential' || dist === 'exp') {
      const mu = argNum(a, 1);
      return rand(a, 2, () => -mu * Math.log(1 - rng.next()));
    }
    throw new MError(`Distribution '${dist}' is not supported by random().`);
  });

  // ---------- hypothesis tests (MATLAB Statistics Toolbox style) ----------
  def(I, 'ttest', (a, nargout) => {
    const x = Array.from(argT(a, 0).re);
    let r;
    let mu = 0;
    if (a.length > 1 && !isStringLike(a[1]) && a[1].numel > 1) {
      const y = Array.from(argT(a, 1).re);
      r = pairedT(y, x);
      const df = r.df;
      const stats = StructArray.scalar([['tstat', num(-r.t)], ['df', num(df)], ['sd', num(r.sdDiff)]]);
      return [num(r.p < 0.05 ? 1 : 0), num(r.p), colVec([-r.ciHi, -r.ciLo]), stats].slice(0, Math.max(1, nargout));
    }
    if (a.length > 1 && !isStringLike(a[1])) mu = toNumber(a[1]);
    const o = oneSampleT(x, mu);
    const stats = StructArray.scalar([['tstat', num(o.t)], ['df', num(o.df)], ['sd', num(o.sd)]]);
    return [num(o.p < 0.05 ? 1 : 0), num(o.p), colVec([o.ciLo + mu, o.ciHi + mu]), stats].slice(0, Math.max(1, nargout));
  });
  def(I, 'ttest2', (a, nargout) => {
    const x = Array.from(argT(a, 0).re).filter(Number.isFinite), y = Array.from(argT(a, 1).re).filter(Number.isFinite);
    const nv = nameValues(a, 2);
    const welch = nv.has('vartype') && toStringValue(nv.get('vartype')!).toLowerCase() === 'unequal';
    const r = unpairedT(summarize(y), summarize(x), welch);
    const stats = StructArray.scalar([['tstat', num(r.t)], ['df', num(r.df)], ['sd', welch ? rowVec([summarize(x).sd, summarize(y).sd]) : num(Math.sqrt(((x.length - 1) * summarize(x).sd ** 2 + (y.length - 1) * summarize(y).sd ** 2) / (x.length + y.length - 2)))]]);
    return [num(r.p < 0.05 ? 1 : 0), num(r.p), colVec([-r.ciHi, -r.ciLo]), stats].slice(0, Math.max(1, nargout));
  });
  def(I, 'ranksum', (a, nargout) => {
    const r = mannWhitney(Array.from(argT(a, 0).re), Array.from(argT(a, 1).re));
    return [num(r.p), num(r.p < 0.05 ? 1 : 0), StructArray.scalar([['ranksum', num(r.sumRankA)], ['U', num(r.U1)]])].slice(0, Math.max(1, nargout));
  });
  def(I, 'signrank', (a, nargout) => {
    const x = Array.from(argT(a, 0).re);
    let d = x;
    if (a.length > 1 && !isStringLike(a[1])) {
      const y = argT(a, 1);
      d = y.numel === 1 ? x.map((v) => v - y.re[0]) : x.map((v, i) => v - y.re[i]);
    }
    const r = wilcoxonSignedRank(d);
    return [num(r.p), num(r.p < 0.05 ? 1 : 0), StructArray.scalar([['signedrank', num(r.sumPositive)]])].slice(0, Math.max(1, nargout));
  });
  def(I, 'swtest', (a, nargout) => {
    const r = shapiroWilk(Array.from(argT(a, 0).re));
    return [num(r.p < 0.05 ? 1 : 0), num(r.p), num(r.W)].slice(0, Math.max(1, nargout));
  });
  def(I, 'anova1', (a, nargout, ctx) => {
    const t = argT(a, 0);
    let groups: number[][];
    let names: string[];
    if (a.length > 1 && a[1].numel > 0 && !(isStringLike(a[1]) && toStringValue(a[1]) === 'off')) {
      const labels = a[1].kind === 'cell' ? a[1].data.map((v) => (isStringLike(v) ? toStringValue(v) : String(toNumber(v)))) : Array.from(toTensor(a[1]).re, String);
      names = [...new Set(labels)];
      groups = names.map((n) => Array.from(t.re).filter((_, i) => labels[i] === n));
    } else {
      groups = Array.from({ length: t.cols }, (_, j) => Array.from(t.re.subarray(j * t.rows, (j + 1) * t.rows)).filter(Number.isFinite));
      names = groups.map((_, j) => String(j + 1));
    }
    const r = oneWayAnova(groups.map(summarize), names, 'none');
    const showTable = !(a.length > 2 && isStringLike(a[2]) && toStringValue(a[2]) === 'off');
    if (showTable && nargout === 0) {
      ctx.interp.print(`\nSource    SS          df    MS          F         Prob>F\n${r.table.map((row) => `${row.source.split(' ')[0].padEnd(10)}${row.ss.toPrecision(6).padEnd(12)}${String(row.df).padEnd(6)}${Number.isFinite(row.ms) ? row.ms.toPrecision(6).padEnd(12) : ''.padEnd(12)}${row.F !== undefined ? row.F.toPrecision(5).padEnd(10) : ''}${row.p !== undefined ? row.p.toPrecision(4) : ''}`).join('\n')}\n\n`);
    }
    const tbl = new CellArray(4, 6, [
      str('Source'), str('Groups'), str('Error'), str('Total'),
      str('SS'), num(r.table[0].ss), num(r.table[1].ss), num(r.table[2].ss),
      str('df'), num(r.table[0].df), num(r.table[1].df), num(r.table[2].df),
      str('MS'), num(r.table[0].ms), num(r.table[1].ms), str(''),
      str('F'), num(r.F), str(''), str(''),
      str('Prob>F'), num(r.p), str(''), str(''),
    ]);
    const stats = StructArray.scalar([['gnames', cellOf(names.map((n) => str(n)), names.length, 1)], ['n', rowVec(groups.map((g) => g.length))], ['means', rowVec(groups.map((g) => r.groups[groups.indexOf(g)].mean))], ['df', num(r.dfd)], ['s', num(Math.sqrt(r.mse))]]);
    return [num(r.p), tbl, stats].slice(0, Math.max(1, nargout));
  });
  def(I, 'kruskalwallis', (a, nargout) => {
    const t = argT(a, 0);
    const groups = Array.from({ length: t.cols }, (_, j) => Array.from(t.re.subarray(j * t.rows, (j + 1) * t.rows)).filter(Number.isFinite));
    const r = kruskalWallis(groups, groups.map((_, j) => String(j + 1)), { dunn: false });
    return [num(r.p), num(r.H)].slice(0, Math.max(1, nargout));
  });
  def(I, 'corr_p', (a) => {
    const x = Array.from(argT(a, 0).re), y = Array.from(argT(a, 1).re);
    const sp = a.length > 2 && toStringValue(a[3] ?? a[2]).toLowerCase().includes('spearman');
    const r = sp ? spearman(x, y) : pearson(x, y);
    return [num(r.r), num(r.p)];
  });
  def(I, 'regress', (a, nargout) => {
    const y = argT(a, 0), X = argT(a, 1);
    const b = mldivide(X, y.cols === 1 ? y : colVec(Array.from(y.re)));
    const yhat: number[] = [];
    for (let i = 0; i < X.rows; i++) {
      let s = 0;
      for (let j = 0; j < X.cols; j++) s += X.re[j * X.rows + i] * b.re[j];
      yhat.push(s);
    }
    const r = Array.from(y.re).map((v, i) => v - yhat[i]);
    const n = X.rows, p = X.cols;
    const sse = r.reduce((s, v) => s + v * v, 0);
    const ym = Array.from(y.re).reduce((s, v) => s + v, 0) / n;
    const sst = Array.from(y.re).reduce((s, v) => s + (v - ym) ** 2, 0);
    const r2 = 1 - sse / sst;
    const F = ((sst - sse) / (p - 1)) / (sse / (n - p));
    const stats = rowVec([r2, F, D.fSf(F, p - 1, n - p), sse / (n - p)]);
    return [b, zeros(p, 2), colVec(r), zeros(n, 2), stats].slice(0, Math.max(1, nargout));
  });
  def(I, ['fitlm', 'fitlm_simple'], (a, _n, ctx) => {
    const X = argT(a, 0), y = argT(a, 1);
    const cols = Array.from({ length: X.cols }, (_, j) => `x${j + 1}`);
    const rows = Array.from({ length: X.rows }, (_, i) => Array.from({ length: X.cols }, (_, j) => X.re[j * X.rows + i]));
    const r = multipleRegression(rows, Array.from(y.re), cols);
    const coef = StructArray.scalar([
      ['Name', cellOf(r.coefs.map((c) => str(c.name)), r.coefs.length, 1)],
      ['Estimate', colVec(r.coefs.map((c) => c.estimate))],
      ['SE', colVec(r.coefs.map((c) => c.se))],
      ['tStat', colVec(r.coefs.map((c) => c.t))],
      ['pValue', colVec(r.coefs.map((c) => c.p))],
    ]);
    const lines = ['Linear regression model:', `    y ~ 1 + ${cols.join(' + ')}`, '', 'Estimated Coefficients:', '                   Estimate        SE         tStat       pValue', ...r.coefs.map((c) => `    ${c.name.padEnd(12)}${c.estimate.toPrecision(5).padStart(12)}${c.se.toPrecision(5).padStart(12)}${c.t.toPrecision(5).padStart(12)}${c.p.toExponential(3).padStart(12)}`), '', `Number of observations: ${r.n}, Error degrees of freedom: ${r.dfd}`, `Root Mean Squared Error: ${r.syx.toPrecision(4)}`, `R-squared: ${r.r2.toPrecision(3)},  Adjusted R-Squared: ${r.adjR2.toPrecision(3)}`, `F-statistic vs. constant model: ${r.F.toPrecision(4)}, p-value = ${r.pF.toExponential(3)}`];
    ctx.interp.print(lines.join('\n') + '\n');
    return StructArray.scalar([['Coefficients', coef], ['Rsquared', StructArray.scalar([['Ordinary', num(r.r2)], ['Adjusted', num(r.adjR2)]])], ['RMSE', num(r.syx)], ['NumObservations', num(r.n)], ['Residuals', colVec(r.residuals)], ['Fitted', colVec(r.fitted)]]);
  });
  def(I, 'linreg_q', (a) => {
    const f = linearRegression(Array.from(argT(a, 0).re), Array.from(argT(a, 1).re));
    return rowVec([f.slope, f.intercept, f.r2, f.p]);
  });
  def(I, 'ecdf', (a) => {
    const x = Array.from(argT(a, 0).re).filter(Number.isFinite).sort((p, q) => p - q);
    const xs = [x[0], ...x], fs = [0, ...x.map((_, i) => (i + 1) / x.length)];
    return [colVec(fs), colVec(xs)];
  });
  def(I, 'histc', (a) => {
    const x = Array.from(argT(a, 0).re), e = Array.from(argT(a, 1).re);
    const c = new Array(e.length).fill(0);
    for (const v of x) {
      for (let k = e.length - 1; k >= 0; k--) if (v >= e[k] && (k === e.length - 1 ? v === e[k] : true)) {
        if (k === e.length - 1 && v !== e[k]) continue;
        c[k]++;
        break;
      }
    }
    return argT(a, 0).cols === 1 ? colVec(c) : rowVec(c);
  });
  def(I, 'tabulate', (a, _n, ctx) => {
    const x = Array.from(argT(a, 0).re);
    const vals = [...new Set(x)].sort((p, q) => p - q);
    const lines = ['  Value    Count   Percent', ...vals.map((v) => `${String(v).padStart(7)}${String(x.filter((y) => y === v).length).padStart(9)}${((100 * x.filter((y) => y === v).length) / x.length).toFixed(2).padStart(9)}%`)];
    ctx.interp.print(lines.join('\n') + '\n');
  });
  def(I, 'grpstats', (a) => {
    const x = Array.from(argT(a, 0).re);
    const g = a[1].kind === 'cell' ? a[1].data.map((v) => toStringValue(v)) : Array.from(toTensor(a[1]).re, String);
    const keys = [...new Set(g)];
    return colVec(keys.map((k) => {
      const v = x.filter((_, i) => g[i] === k);
      return v.reduce((s, y) => s + y, 0) / v.length;
    }));
  });
  void minArgs;
  void mapReal;
  void bool;
  void Tensor;
}
