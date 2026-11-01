import { fSf, tInv, tTwoTailP, brent } from './distributions';
import { mean, sum, sortNum, sd } from './descriptive';
import { eigSym, invertM, ols, type Mat } from './linalg';

// ---------------- Simple linear regression ----------------
export interface LinearFit {
  slope: number;
  intercept: number;
  seSlope: number;
  seIntercept: number;
  slopeCI: [number, number];
  interceptCI: [number, number];
  xIntercept: number;
  r2: number;
  syx: number;
  F: number;
  dfn: number;
  dfd: number;
  p: number;
  n: number;
  sse: number;
  meanX: number;
  sxx: number;
  equation: string;
  runs?: { runs: number; p: number };
}

export function linearRegression(xIn: number[], yIn: number[], opts: { throughOrigin?: boolean; ciLevel?: number } = {}): LinearFit {
  const x: number[] = [], y: number[] = [];
  for (let i = 0; i < Math.min(xIn.length, yIn.length); i++)
    if (Number.isFinite(xIn[i]) && Number.isFinite(yIn[i])) {
      x.push(xIn[i]);
      y.push(yIn[i]);
    }
  const n = x.length;
  const ciLevel = opts.ciLevel ?? 0.95;
  const mx = mean(x), my = mean(y);
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - mx) ** 2;
    sxy += (x[i] - mx) * (y[i] - my);
    syy += (y[i] - my) ** 2;
  }
  let slope: number, intercept: number, df: number, sse: number, seSlope: number, seIntercept: number;
  if (opts.throughOrigin) {
    const sxx0 = sum(x.map((v) => v * v));
    slope = sum(x.map((v, i) => v * y[i])) / sxx0;
    intercept = 0;
    df = n - 1;
    sse = sum(y.map((v, i) => (v - slope * x[i]) ** 2));
    seSlope = Math.sqrt(sse / df / sxx0);
    seIntercept = 0;
  } else {
    slope = sxy / sxx;
    intercept = my - slope * mx;
    df = n - 2;
    sse = sum(y.map((v, i) => (v - intercept - slope * x[i]) ** 2));
    const s2 = sse / df;
    seSlope = Math.sqrt(s2 / sxx);
    seIntercept = Math.sqrt(s2 * (1 / n + (mx * mx) / sxx));
  }
  const tc = tInv(1 - (1 - ciLevel) / 2, df);
  const r2 = opts.throughOrigin ? 1 - sse / syy : (sxy * sxy) / (sxx * syy);
  const ssReg = syy - sse;
  const F = ssReg / (sse / df);
  const fmt = (v: number) => (Math.abs(v) >= 1000 || Math.abs(v) < 0.001 ? v.toExponential(3) : v.toPrecision(4));
  // Wald-Wolfowitz runs test on residual signs
  const signs = y.map((v, i) => Math.sign(v - intercept - slope * x[i])).filter((s, i) => s !== 0 || i < 0);
  let runs: { runs: number; p: number } | undefined;
  const order = x.map((_, i) => i).sort((a, b) => x[a] - x[b]);
  const sorted = order.map((i) => Math.sign(y[i] - intercept - slope * x[i])).filter((s) => s !== 0);
  if (sorted.length >= 3) {
    let r = 1;
    for (let i = 1; i < sorted.length; i++) if (sorted[i] !== sorted[i - 1]) r++;
    const n1 = sorted.filter((s) => s > 0).length, n2 = sorted.length - n1;
    if (n1 > 0 && n2 > 0) {
      const mu = (2 * n1 * n2) / (n1 + n2) + 1;
      const v = (2 * n1 * n2 * (2 * n1 * n2 - n1 - n2)) / ((n1 + n2) ** 2 * (n1 + n2 - 1));
      const z = (r - mu) / Math.sqrt(v);
      // one-tailed: too few runs indicates systematic deviation
      runs = { runs: r, p: Math.min(1, 0.5 * (1 + erfApprox(z / Math.SQRT2))) };
    }
  }
  void signs;
  return {
    slope, intercept, seSlope, seIntercept,
    slopeCI: [slope - tc * seSlope, slope + tc * seSlope],
    interceptCI: [intercept - tc * seIntercept, intercept + tc * seIntercept],
    xIntercept: -intercept / slope,
    r2, syx: Math.sqrt(sse / df), F, dfn: 1, dfd: df, p: tTwoTailP(slope / seSlope, df), n, sse, meanX: mx, sxx,
    equation: opts.throughOrigin ? `Y = ${fmt(slope)}*X` : `Y = ${fmt(slope)}*X ${intercept < 0 ? '-' : '+'} ${fmt(Math.abs(intercept))}`,
    runs,
  };
}

function erfApprox(x: number): number {
  // Only used for the runs test z → P conversion
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

/** Confidence band (mean response) for a linear fit at the requested x values. */
export function linearBand(fit: LinearFit, xs: number[], ciLevel = 0.95, prediction = false) {
  const tc = tInv(1 - (1 - ciLevel) / 2, fit.dfd);
  return xs.map((x) => {
    const yhat = fit.intercept + fit.slope * x;
    const se = fit.syx * Math.sqrt((prediction ? 1 : 0) + 1 / fit.n + (x - fit.meanX) ** 2 / fit.sxx);
    return { x, y: yhat, lo: yhat - tc * se, hi: yhat + tc * se };
  });
}

/** Tests whether slopes (then intercepts) differ between data sets (ANCOVA-style F tests). */
export function compareSlopes(sets: { x: number[]; y: number[] }[]) {
  const clean = sets.map((s) => {
    const x: number[] = [], y: number[] = [];
    s.x.forEach((v, i) => {
      if (Number.isFinite(v) && Number.isFinite(s.y[i])) {
        x.push(v);
        y.push(s.y[i]);
      }
    });
    return { x, y };
  });
  const k = clean.length;
  const N = sum(clean.map((s) => s.x.length));
  const ss1 = sum(clean.map((s) => linearRegression(s.x, s.y).sse));
  const df1 = N - 2 * k;
  // common slope, separate intercepts
  const X2: Mat = [], y2: number[] = [];
  clean.forEach((s, g) => s.x.forEach((xv, i) => {
    const row = new Array(k + 1).fill(0);
    row[g] = 1;
    row[k] = xv;
    X2.push(row);
    y2.push(s.y[i]);
  }));
  const fit2 = ols(X2, y2);
  const ss2 = fit2.sse, df2 = N - k - 1;
  const Fs = (ss2 - ss1) / (df2 - df1) / (ss1 / df1);
  const pSlopes = fSf(Fs, df2 - df1, df1);
  const allX = clean.flatMap((s) => s.x), allY = clean.flatMap((s) => s.y);
  const ss3 = linearRegression(allX, allY).sse, df3 = N - 2;
  const Fi = (ss3 - ss2) / (df3 - df2) / (ss2 / df2);
  const pIntercepts = fSf(Fi, df3 - df2, df2);
  return { slopes: { F: Fs, dfn: df2 - df1, dfd: df1, p: pSlopes }, intercepts: { F: Fi, dfn: df3 - df2, dfd: df2, p: pIntercepts }, commonSlope: fit2.beta[k] };
}

// ---------------- Nonlinear regression ----------------
export interface NLModel {
  id: string;
  name: string;
  group: string;
  equation: string;
  params: string[];
  f: (x: number, p: number[]) => number;
  guess: (x: number[], y: number[]) => number[];
  derived?: (p: number[]) => { name: string; value: number }[];
}

const ln2 = Math.LN2;
function firstLast(x: number[], y: number[]) {
  const idx = x.map((_, i) => i).sort((a, b) => x[a] - x[b]);
  const xs = idx.map((i) => x[i]), ys = idx.map((i) => y[i]);
  return { xs, ys, x0: xs[0], x1: xs[xs.length - 1], y0: ys[0], y1: ys[ys.length - 1] };
}
function xAtHalf(x: number[], y: number[]) {
  const { xs, ys } = firstLast(x, y);
  const lo = Math.min(...ys), hi = Math.max(...ys), half = (lo + hi) / 2;
  let best = xs[Math.floor(xs.length / 2)], bd = Infinity;
  xs.forEach((xv, i) => {
    const d = Math.abs(ys[i] - half);
    if (d < bd) {
      bd = d;
      best = xv;
    }
  });
  return best;
}
function trendSign(x: number[], y: number[]) {
  const { ys } = firstLast(x, y);
  const k = Math.max(1, Math.floor(ys.length / 3));
  return mean(ys.slice(-k)) >= mean(ys.slice(0, k)) ? 1 : -1;
}

export const NL_MODELS: NLModel[] = [
  {
    id: 'logAgonist4', group: 'Dose-response - Stimulation', name: 'log(agonist) vs. response -- Variable slope (four parameters)',
    equation: 'Y=Bottom + (Top-Bottom)/(1+10^((LogEC50-X)*HillSlope))', params: ['Bottom', 'Top', 'LogEC50', 'HillSlope'],
    f: (x, [b, t, l, h]) => b + (t - b) / (1 + Math.pow(10, (l - x) * h)),
    guess: (x, y) => {
      const s = trendSign(x, y);
      return [s > 0 ? Math.min(...y) : Math.max(...y), s > 0 ? Math.max(...y) : Math.min(...y), xAtHalf(x, y), 1];
    },
    derived: ([, , l]) => [{ name: 'EC50', value: Math.pow(10, l) }],
  },
  {
    id: 'logAgonist3', group: 'Dose-response - Stimulation', name: 'log(agonist) vs. response (three parameters)',
    equation: 'Y=Bottom + (Top-Bottom)/(1+10^((LogEC50-X)))', params: ['Bottom', 'Top', 'LogEC50'],
    f: (x, [b, t, l]) => b + (t - b) / (1 + Math.pow(10, l - x)),
    guess: (x, y) => [Math.min(...y), Math.max(...y), xAtHalf(x, y)],
    derived: ([, , l]) => [{ name: 'EC50', value: Math.pow(10, l) }],
  },
  {
    id: 'logInhibitor4', group: 'Dose-response - Inhibition', name: 'log(inhibitor) vs. response -- Variable slope (four parameters)',
    equation: 'Y=Bottom + (Top-Bottom)/(1+10^((X-LogIC50)*HillSlope))', params: ['Bottom', 'Top', 'LogIC50', 'HillSlope'],
    f: (x, [b, t, l, h]) => b + (t - b) / (1 + Math.pow(10, (x - l) * h)),
    guess: (x, y) => [Math.min(...y), Math.max(...y), xAtHalf(x, y), 1],
    derived: ([, , l]) => [{ name: 'IC50', value: Math.pow(10, l) }],
  },
  {
    id: 'logInhibitor3', group: 'Dose-response - Inhibition', name: 'log(inhibitor) vs. response (three parameters)',
    equation: 'Y=Bottom + (Top-Bottom)/(1+10^((X-LogIC50)))', params: ['Bottom', 'Top', 'LogIC50'],
    f: (x, [b, t, l]) => b + (t - b) / (1 + Math.pow(10, x - l)),
    guess: (x, y) => [Math.min(...y), Math.max(...y), xAtHalf(x, y)],
    derived: ([, , l]) => [{ name: 'IC50', value: Math.pow(10, l) }],
  },
  {
    id: 'agonistVar', group: 'Dose-response - Stimulation', name: '[Agonist] vs. response -- Variable slope',
    equation: 'Y=Bottom + (Top-Bottom)*X^HillSlope/(EC50^HillSlope + X^HillSlope)', params: ['Bottom', 'Top', 'EC50', 'HillSlope'],
    f: (x, [b, t, e, h]) => b + ((t - b) * Math.pow(x, h)) / (Math.pow(e, h) + Math.pow(x, h)),
    guess: (x, y) => [Math.min(...y), Math.max(...y), Math.max(1e-9, xAtHalf(x, y)), 1],
  },
  {
    id: 'mm', group: 'Enzyme kinetics', name: 'Michaelis-Menten', equation: 'Y = Vmax*X/(Km + X)', params: ['Vmax', 'Km'],
    f: (x, [v, k]) => (v * x) / (k + x),
    guess: (x, y) => [Math.max(...y) * 1.1, Math.max(1e-9, xAtHalf(x, y))],
    derived: ([v, k]) => [{ name: 'Vmax/Km', value: v / k }],
  },
  {
    id: 'hillBinding', group: 'Binding - Saturation', name: 'Specific binding with Hill slope', equation: 'Y=Bmax*X^h/(Kd^h + X^h)', params: ['Bmax', 'Kd', 'h'],
    f: (x, [bm, kd, h]) => (bm * Math.pow(x, h)) / (Math.pow(kd, h) + Math.pow(x, h)),
    guess: (x, y) => [Math.max(...y) * 1.1, Math.max(1e-9, xAtHalf(x, y)), 1],
  },
  {
    id: 'oneSite', group: 'Binding - Saturation', name: 'One site -- Specific binding', equation: 'Y = Bmax*X/(Kd + X)', params: ['Bmax', 'Kd'],
    f: (x, [bm, kd]) => (bm * x) / (kd + x),
    guess: (x, y) => [Math.max(...y) * 1.1, Math.max(1e-9, xAtHalf(x, y))],
  },
  {
    id: 'decay1', group: 'Exponential', name: 'One phase decay', equation: 'Y=(Y0 - Plateau)*exp(-K*X) + Plateau', params: ['Y0', 'Plateau', 'K'],
    f: (x, [y0, pl, k]) => (y0 - pl) * Math.exp(-k * x) + pl,
    guess: (x, y) => {
      const { y0, y1, x0, x1 } = firstLast(x, y);
      return [y0, y1, 3 / Math.max(1e-9, x1 - x0)];
    },
    derived: ([y0, pl, k]) => [{ name: 'Half-life', value: ln2 / k }, { name: 'Tau', value: 1 / k }, { name: 'Span', value: y0 - pl }],
  },
  {
    id: 'assoc1', group: 'Exponential', name: 'One phase association', equation: 'Y=Y0 + (Plateau-Y0)*(1-exp(-K*x))', params: ['Y0', 'Plateau', 'K'],
    f: (x, [y0, pl, k]) => y0 + (pl - y0) * (1 - Math.exp(-k * x)),
    guess: (x, y) => {
      const { y0, y1, x0, x1 } = firstLast(x, y);
      return [y0, y1, 3 / Math.max(1e-9, x1 - x0)];
    },
    derived: ([y0, pl, k]) => [{ name: 'Half-time', value: ln2 / k }, { name: 'Tau', value: 1 / k }, { name: 'Span', value: pl - y0 }],
  },
  {
    id: 'decay2', group: 'Exponential', name: 'Two phase decay', equation: 'Y=Plateau + SpanFast*exp(-KFast*X) + SpanSlow*exp(-KSlow*X)',
    params: ['Plateau', 'SpanFast', 'KFast', 'SpanSlow', 'KSlow'],
    f: (x, [pl, sf, kf, ss, ks]) => pl + sf * Math.exp(-kf * x) + ss * Math.exp(-ks * x),
    guess: (x, y) => {
      const { y0, y1, x0, x1 } = firstLast(x, y);
      const span = y0 - y1;
      return [y1, span / 2, 10 / Math.max(1e-9, x1 - x0), span / 2, 1 / Math.max(1e-9, x1 - x0)];
    },
    derived: ([, , kf, , ks]) => [{ name: 'Half-life (fast)', value: ln2 / kf }, { name: 'Half-life (slow)', value: ln2 / ks }],
  },
  {
    id: 'expGrowth', group: 'Exponential', name: 'Exponential (Malthusian) growth', equation: 'Y=Y0*exp(k*X)', params: ['Y0', 'k'],
    f: (x, [y0, k]) => y0 * Math.exp(k * x),
    guess: (x, y) => {
      const { y0, y1, x0, x1 } = firstLast(x, y);
      return [y0 || 1, Math.log(Math.abs(y1 / (y0 || 1)) || 2) / Math.max(1e-9, x1 - x0)];
    },
    derived: ([, k]) => [{ name: 'Doubling time', value: ln2 / k }],
  },
  {
    id: 'logistic', group: 'Growth', name: 'Logistic growth', equation: 'Y=YM*Y0/((YM-Y0)*exp(-k*x) +Y0)', params: ['YM', 'Y0', 'k'],
    f: (x, [ym, y0, k]) => (ym * y0) / ((ym - y0) * Math.exp(-k * x) + y0),
    guess: (x, y) => {
      const { y0, x0, x1 } = firstLast(x, y);
      return [Math.max(...y) * 1.05, Math.max(1e-9, y0), 4 / Math.max(1e-9, x1 - x0)];
    },
  },
  {
    id: 'gompertz', group: 'Growth', name: 'Gompertz growth', equation: 'Y=YM*(Y0/YM)^(exp(-K*X))', params: ['YM', 'Y0', 'K'],
    f: (x, [ym, y0, k]) => ym * Math.pow(y0 / ym, Math.exp(-k * x)),
    guess: (x, y) => {
      const { y0, x0, x1 } = firstLast(x, y);
      return [Math.max(...y) * 1.05, Math.max(1e-9, y0), 3 / Math.max(1e-9, x1 - x0)];
    },
  },
  {
    id: 'gaussian', group: 'Gaussian', name: 'Gaussian', equation: 'Y=Amplitude*exp(-0.5*((X-Mean)/SD)^2)', params: ['Amplitude', 'Mean', 'SD'],
    f: (x, [a, m, s]) => a * Math.exp(-0.5 * ((x - m) / s) ** 2),
    guess: (x, y) => {
      const imax = y.indexOf(Math.max(...y));
      const { x0, x1 } = firstLast(x, y);
      return [y[imax], x[imax], (x1 - x0) / 6 || 1];
    },
    derived: ([, , s]) => [{ name: 'FWHM', value: 2.35482 * Math.abs(s) }],
  },
  {
    id: 'lorentzian', group: 'Gaussian', name: 'Lorentzian', equation: 'Y=Amplitude/(1+((X-Center)/Width)^2)', params: ['Amplitude', 'Center', 'Width'],
    f: (x, [a, c, w]) => a / (1 + ((x - c) / w) ** 2),
    guess: (x, y) => {
      const imax = y.indexOf(Math.max(...y));
      const { x0, x1 } = firstLast(x, y);
      return [y[imax], x[imax], (x1 - x0) / 10 || 1];
    },
  },
  {
    id: 'boltzmann', group: 'Sigmoidal', name: 'Boltzmann sigmoid', equation: 'Y=Bottom + (Top-Bottom)/(1+exp((V50-X)/Slope))', params: ['Bottom', 'Top', 'V50', 'Slope'],
    f: (x, [b, t, v, s]) => b + (t - b) / (1 + Math.exp((v - x) / s)),
    guess: (x, y) => {
      const { x0, x1 } = firstLast(x, y);
      return [Math.min(...y), Math.max(...y), xAtHalf(x, y), (trendSign(x, y) * (x1 - x0)) / 10 || 1];
    },
  },
  {
    id: 'poly2', group: 'Polynomial', name: 'Second order polynomial (quadratic)', equation: 'Y=B0 + B1*X + B2*X^2', params: ['B0', 'B1', 'B2'],
    f: (x, [b0, b1, b2]) => b0 + b1 * x + b2 * x * x,
    guess: (x, y) => polyGuess(x, y, 2),
  },
  {
    id: 'poly3', group: 'Polynomial', name: 'Third order polynomial (cubic)', equation: 'Y=B0 + B1*X + B2*X^2 + B3*X^3', params: ['B0', 'B1', 'B2', 'B3'],
    f: (x, [b0, b1, b2, b3]) => b0 + b1 * x + b2 * x * x + b3 * x * x * x,
    guess: (x, y) => polyGuess(x, y, 3),
  },
  {
    id: 'power', group: 'Polynomial', name: 'Power series (Y = A*X^B)', equation: 'Y=A*X^B', params: ['A', 'B'],
    f: (x, [a, b]) => a * Math.pow(x, b),
    guess: (x, y) => {
      const pts = x.map((v, i) => [v, y[i]]).filter(([u, w]) => u > 0 && w > 0);
      if (pts.length >= 2) {
        const f = linearRegression(pts.map((p) => Math.log(p[0])), pts.map((p) => Math.log(p[1])));
        return [Math.exp(f.intercept), f.slope];
      }
      return [1, 1];
    },
  },
  {
    id: 'sine', group: 'Sine waves', name: 'Standard sine wave', equation: 'Y=Amplitude*sin((2*pi*X/Wavelength)+PhaseShift)+Baseline', params: ['Amplitude', 'Wavelength', 'PhaseShift', 'Baseline'],
    f: (x, [a, w, ph, b]) => a * Math.sin((2 * Math.PI * x) / w + ph) + b,
    guess: (x, y) => {
      const { x0, x1 } = firstLast(x, y);
      return [(Math.max(...y) - Math.min(...y)) / 2, (x1 - x0) / 2 || 1, 0, mean(y)];
    },
  },
  {
    id: 'line', group: 'Lines', name: 'Straight line', equation: 'Y=YIntercept + Slope*X', params: ['YIntercept', 'Slope'],
    f: (x, [b, m]) => b + m * x,
    guess: (x, y) => {
      const f = linearRegression(x, y);
      return [f.intercept, f.slope];
    },
  },
];

function polyGuess(x: number[], y: number[], deg: number): number[] {
  const X = x.map((v) => Array.from({ length: deg + 1 }, (_, k) => Math.pow(v, k)));
  const r = ols(X, y);
  return r.beta.map((b) => (Number.isFinite(b) ? b : 0));
}

export interface NLFitResult {
  params: number[];
  se: number[];
  ci: [number, number][];
  sse: number;
  df: number;
  r2: number;
  syx: number;
  n: number;
  iterations: number;
  converged: boolean;
  ambiguous: boolean;
  message: string;
  cov: Mat | null;
}

/** Levenberg-Marquardt least-squares fit. `fixed[i]` constrains parameter i to its initial value. */
export function nonlinearFit(
  f: (x: number, p: number[]) => number,
  xIn: number[],
  yIn: number[],
  p0: number[],
  opts: { fixed?: boolean[]; weights?: 'none' | '1/Y^2' | '1/Y'; maxIter?: number; ciLevel?: number } = {},
): NLFitResult {
  const x: number[] = [], y: number[] = [];
  for (let i = 0; i < Math.min(xIn.length, yIn.length); i++)
    if (Number.isFinite(xIn[i]) && Number.isFinite(yIn[i])) {
      x.push(xIn[i]);
      y.push(yIn[i]);
    }
  const n = x.length;
  const fixed = opts.fixed ?? p0.map(() => false);
  const free = p0.map((_, i) => i).filter((i) => !fixed[i]);
  const k = free.length;
  const w = y.map((v) => (opts.weights === '1/Y^2' ? 1 / (v * v || 1) : opts.weights === '1/Y' ? 1 / (Math.abs(v) || 1) : 1));
  let p = [...p0];
  const ssOf = (pp: number[]) => {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const r = y[i] - f(x[i], pp);
      s += w[i] * r * r;
    }
    return s;
  };
  let ss = ssOf(p);
  if (!Number.isFinite(ss)) {
    // nudge parameters to escape invalid region
    p = p.map((v) => (v === 0 ? 1e-3 : v));
    ss = ssOf(p);
  }
  let lambda = 1e-3;
  let iter = 0;
  let converged = false;
  const maxIter = opts.maxIter ?? 1000;
  let J: number[][] = [];
  const jac = (pp: number[]) => {
    const Jm: number[][] = new Array(n);
    const f0 = x.map((xv) => f(xv, pp));
    for (let i = 0; i < n; i++) Jm[i] = new Array(k);
    free.forEach((pi, c) => {
      const h = 1e-6 * Math.max(Math.abs(pp[pi]), 1e-4);
      const pph = [...pp];
      pph[pi] += h;
      for (let i = 0; i < n; i++) Jm[i][c] = (f(x[i], pph) - f0[i]) / h;
    });
    return { Jm, f0 };
  };
  for (iter = 0; iter < maxIter && k > 0; iter++) {
    const { Jm, f0 } = jac(p);
    J = Jm;
    const A: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
    const g = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      const r = y[i] - f0[i];
      for (let a = 0; a < k; a++) {
        g[a] += w[i] * Jm[i][a] * r;
        for (let b = a; b < k; b++) A[a][b] += w[i] * Jm[i][a] * Jm[i][b];
      }
    }
    for (let a = 0; a < k; a++) for (let b = 0; b < a; b++) A[a][b] = A[b][a];
    let improved = false;
    let relChange = 0;
    for (let tries = 0; tries < 30; tries++) {
      const M = A.map((row, a) => row.map((v, b) => (a === b ? v + lambda * Math.max(v, 1e-12) : v)));
      const inv = invertM(M, 1e-300);
      if (!inv) {
        lambda *= 10;
        continue;
      }
      const delta = inv.map((row) => row.reduce((s, v, b) => s + v * g[b], 0));
      const pn = [...p];
      free.forEach((pi, c) => (pn[pi] += delta[c]));
      const ssn = ssOf(pn);
      if (Number.isFinite(ssn) && ssn <= ss) {
        relChange = (ss - ssn) / Math.max(ss, 1e-300);
        const stepRel = Math.max(...free.map((pi, c) => Math.abs(delta[c]) / Math.max(Math.abs(pn[pi]), 1e-12)));
        p = pn;
        ss = ssn;
        lambda = Math.max(lambda / 10, 1e-12);
        improved = true;
        if (relChange < 1e-12 || stepRel < 1e-10) converged = true;
        break;
      }
      lambda *= 10;
      if (lambda > 1e16) break;
    }
    if (!improved) {
      converged = true;
      break;
    }
    if (converged) break;
  }
  if (k > 0) J = jac(p).Jm;
  const df = n - k;
  const s2 = ss / df;
  const JtJ: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let i = 0; i < n; i++) for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) JtJ[a][b] += w[i] * J[i][a] * J[i][b];
  const inv = k > 0 ? invertM(JtJ, 1e-14) : [];
  const se = p.map(() => 0);
  const ambiguous = k > 0 && !inv;
  if (inv) free.forEach((pi, c) => (se[pi] = Math.sqrt(Math.max(0, s2 * inv[c][c]))));
  const tc = tInv(1 - (1 - (opts.ciLevel ?? 0.95)) / 2, df);
  const ym = mean(y);
  const sst = sum(y.map((v, i) => w[i] * (v - ym) ** 2));
  let ssu = 0;
  for (let i = 0; i < n; i++) ssu += (y[i] - f(x[i], p)) ** 2;
  return {
    params: p,
    se,
    ci: p.map((v, i) => (fixed[i] ? [v, v] : [v - tc * se[i], v + tc * se[i]])),
    sse: ss,
    df,
    r2: 1 - ss / sst,
    syx: Math.sqrt(ssu / df),
    n,
    iterations: iter,
    converged: converged && Number.isFinite(ss),
    ambiguous,
    message: !Number.isFinite(ss) ? 'Fit failed (invalid values)' : ambiguous ? 'Ambiguous' : converged ? 'Converged' : 'Not converged (max iterations)',
    cov: inv ? inv.map((r) => r.map((v) => v * s2)) : null,
  };
}

/** Extra sum-of-squares F test comparing a simpler (null) model to a more complex one. */
export function extraSumOfSquares(ssNull: number, dfNull: number, ssAlt: number, dfAlt: number) {
  const F = (ssNull - ssAlt) / (dfNull - dfAlt) / (ssAlt / dfAlt);
  return { F, dfn: dfNull - dfAlt, dfd: dfAlt, p: fSf(F, dfNull - dfAlt, dfAlt) };
}

/** Solve f(x, p) = yTarget for x within an expanded range (used to interpolate unknowns from a standard curve). */
export function inverseModel(f: (x: number, p: number[]) => number, p: number[], yTarget: number, xmin: number, xmax: number): number {
  const span = xmax - xmin || 1;
  const grid = 200;
  const lo = xmin - span * 0.5, hi = xmax + span * 0.5;
  let prevX = lo, prevV = f(lo, p) - yTarget;
  for (let i = 1; i <= grid; i++) {
    const xv = lo + ((hi - lo) * i) / grid;
    const v = f(xv, p) - yTarget;
    if (Number.isFinite(v) && Number.isFinite(prevV) && Math.sign(v) !== Math.sign(prevV)) {
      return brent((t) => f(t, p) - yTarget, prevX, xv, 1e-12);
    }
    prevX = xv;
    prevV = v;
  }
  return NaN;
}

// ---------------- Multiple linear regression ----------------
export function multipleRegression(X: number[][], y: number[], names: string[], ciLevel = 0.95) {
  const rows: number[][] = [], yy: number[] = [];
  X.forEach((r, i) => {
    if (r.every(Number.isFinite) && Number.isFinite(y[i])) {
      rows.push([1, ...r]);
      yy.push(y[i]);
    }
  });
  const n = rows.length, p = names.length;
  const fit = ols(rows, yy);
  const ym = mean(yy);
  const sst = sum(yy.map((v) => (v - ym) ** 2));
  const r2 = 1 - fit.sse / sst;
  const adjR2 = 1 - ((1 - r2) * (n - 1)) / (n - p - 1);
  const F = (sst - fit.sse) / p / (fit.sse / (n - p - 1));
  const tc = tInv(1 - (1 - ciLevel) / 2, n - p - 1);
  const coefs = ['Intercept', ...names].map((nm, i) => {
    const t = fit.beta[i] / fit.se[i];
    let vif = NaN;
    if (i > 0 && p > 1) {
      const others = rows.map((r) => [1, ...r.slice(1).filter((_, j) => j !== i - 1)]);
      const target = rows.map((r) => r[i]);
      const f2 = ols(others, target);
      const tm = mean(target);
      const st = sum(target.map((v) => (v - tm) ** 2));
      vif = 1 / (f2.sse / st);
    }
    return { name: nm, estimate: fit.beta[i], se: fit.se[i], t, p: tTwoTailP(t, n - p - 1), ciLo: fit.beta[i] - tc * fit.se[i], ciHi: fit.beta[i] + tc * fit.se[i], vif };
  });
  return { coefs, r2, adjR2, F, dfn: p, dfd: n - p - 1, pF: fSf(F, p, n - p - 1), n, sse: fit.sse, syx: Math.sqrt(fit.mse), fitted: fit.fitted, residuals: fit.residuals };
}

// ---------------- PCA ----------------
export function pca(data: number[][], names: string[], standardize = true) {
  const rows = data.filter((r) => r.every(Number.isFinite));
  const n = rows.length, p = names.length;
  const means = names.map((_, j) => mean(rows.map((r) => r[j])));
  const sds = names.map((_, j) => sd(rows.map((r) => r[j])));
  const Z = rows.map((r) => r.map((v, j) => (v - means[j]) / (standardize ? sds[j] || 1 : 1)));
  const C: Mat = names.map(() => new Array(p).fill(0));
  for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) C[a][b] = sum(Z.map((r) => r[a] * r[b])) / (n - 1);
  const { values, vectors } = eigSym(C);
  // Sign convention: make the largest-magnitude loading of each PC positive
  for (let c = 0; c < p; c++) {
    let maxAbs = 0, sgn = 1;
    for (let r = 0; r < p; r++) if (Math.abs(vectors[r][c]) > maxAbs) {
      maxAbs = Math.abs(vectors[r][c]);
      sgn = Math.sign(vectors[r][c]);
    }
    if (sgn < 0) for (let r = 0; r < p; r++) vectors[r][c] *= -1;
  }
  const total = sum(values);
  const scores = Z.map((r) => values.map((_, c) => sum(r.map((v, j) => v * vectors[j][c]))));
  const loadings = vectors.map((row) => row.map((v, c) => v * Math.sqrt(Math.max(0, values[c]))));
  let cum = 0;
  const variance = values.map((v) => {
    cum += v;
    return { eigenvalue: v, proportion: (100 * v) / total, cumulative: (100 * cum) / total };
  });
  return { variance, eigenvectors: vectors, loadings, scores, n, means, sds };
}

export function sortedUnique(x: number[]): number[] {
  return [...new Set(sortNum(x))];
}
