// Special functions and probability distributions used across the statistics engine.
// Implementations follow standard numerical recipes (Lanczos gamma, continued-fraction
// incomplete beta/gamma, AS 190 studentized range, Gauss-Legendre quadrature).

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

export function lgamma(x: number): number {
  if (x < 0.5) {
    // Reflection formula
    return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  }
  x -= 1;
  let a = LANCZOS[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

export function gamma(x: number): number {
  if (Number.isInteger(x)) {
    if (x <= 0) return NaN;
    if (x < 171) {
      let r = 1;
      for (let i = 2; i < x; i++) r *= i;
      return r;
    }
    return Infinity;
  }
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
  if (x > 171.6) return Infinity;
  return Math.exp(lgamma(x));
}

export function lbeta(a: number, b: number): number {
  return lgamma(a) + lgamma(b) - lgamma(a + b);
}

/** Regularized lower incomplete gamma P(a, x). */
export function gammaP(a: number, x: number): number {
  if (x <= 0 || !isFinite(a)) return 0;
  if (x === Infinity) return 1;
  if (x < a + 1) return gammaSeries(a, x);
  return 1 - gammaCF(a, x);
}

/** Regularized upper incomplete gamma Q(a, x). */
export function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x === Infinity) return 0;
  if (x < a + 1) return 1 - gammaSeries(a, x);
  return gammaCF(a, x);
}

function gammaSeries(a: number, x: number): number {
  let sum = 1 / a;
  let del = sum;
  let ap = a;
  for (let n = 0; n < 10000; n++) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * 1e-16) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
}

function gammaCF(a: number, x: number): number {
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 10000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}

/** Regularized incomplete beta I_x(a, b). */
export function betaInc(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betaCF(x, a, b)) / a;
  return 1 - (bt * betaCF(1 - x, b, a)) / b;
}

function betaCF(x: number, a: number, b: number): number {
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 10000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return h;
}

export function erf(x: number): number {
  if (x === 0) return 0;
  const v = gammaP(0.5, x * x);
  return x < 0 ? -v : v;
}

export function erfc(x: number): number {
  if (x < 0) return 1 + gammaP(0.5, x * x);
  return gammaQ(0.5, x * x);
}

export function erfinv(y: number): number {
  if (y <= -1) return -Infinity;
  if (y >= 1) return Infinity;
  return normInv((y + 1) / 2) / Math.SQRT2;
}

// ---------------- Normal ----------------
export function normPdf(z: number, mu = 0, sigma = 1): number {
  const t = (z - mu) / sigma;
  return Math.exp(-0.5 * t * t) / (sigma * Math.sqrt(2 * Math.PI));
}

export function normCdf(z: number, mu = 0, sigma = 1): number {
  const t = (z - mu) / sigma;
  if (isNaN(t)) return NaN;
  if (t === Infinity) return 1;
  if (t === -Infinity) return 0;
  if (Math.abs(t) < 3) {
    // Marsaglia's Taylor series, accurate to ~1e-16 in this range and fast.
    let s = t, tt = 0, b = t;
    const q = t * t;
    let i = 1;
    while (s !== tt) {
      tt = s;
      i += 2;
      b *= q / i;
      s = tt + b;
    }
    return 0.5 + s * Math.exp(-0.5 * q - 0.91893853320467274178);
  }
  return 0.5 * erfc(-t / Math.SQRT2);
}

/** Upper tail of the standard normal, accurate in the far tail. */
export function normSf(z: number): number {
  return 0.5 * erfc(z / Math.SQRT2);
}

export function normInv(p: number, mu = 0, sigma = 1): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  // Acklam's algorithm with one step of Halley refinement.
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  let x: number;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - plow) {
    const q = p - 0.5;
    const r = q * q;
    x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  // Refinement
  for (let k = 0; k < 2; k++) {
    const e = (p < 0.5 ? normCdf(x) - p : -(normSf(x) - (1 - p)));
    const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
    x = x - u / (1 + (x * u) / 2);
  }
  return mu + sigma * x;
}

// ---------------- Student t ----------------
export function tPdf(t: number, df: number): number {
  return Math.exp(lgamma((df + 1) / 2) - lgamma(df / 2) - 0.5 * Math.log(df * Math.PI) - ((df + 1) / 2) * Math.log(1 + (t * t) / df));
}

export function tCdf(t: number, df: number): number {
  if (isNaN(t) || df <= 0) return NaN;
  if (t === Infinity) return 1;
  if (t === -Infinity) return 0;
  if (df === Infinity) return normCdf(t);
  const x = df / (df + t * t);
  const tail = 0.5 * betaInc(x, df / 2, 0.5);
  return t > 0 ? 1 - tail : tail;
}

/** Two-tailed P value for a t statistic. */
export function tTwoTailP(t: number, df: number): number {
  if (!isFinite(t)) return isNaN(t) ? NaN : 0;
  if (df === Infinity) return 2 * normSf(Math.abs(t));
  const x = df / (df + t * t);
  return Math.min(1, betaInc(x, df / 2, 0.5));
}

export function tInv(p: number, df: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (df === Infinity) return normInv(p);
  if (p === 0.5) return 0;
  // Solve using the inverse incomplete beta for the tail.
  const tailP = p < 0.5 ? p : 1 - p;
  const x = betaIncInv(2 * tailP, df / 2, 0.5);
  const t = Math.sqrt((df * (1 - x)) / x);
  return p < 0.5 ? -t : t;
}

// ---------------- F ----------------
export function fCdf(f: number, d1: number, d2: number): number {
  if (f <= 0) return 0;
  if (f === Infinity) return 1;
  return betaInc((d1 * f) / (d1 * f + d2), d1 / 2, d2 / 2);
}

export function fSf(f: number, d1: number, d2: number): number {
  if (f <= 0) return 1;
  if (f === Infinity) return 0;
  if (isNaN(f)) return NaN;
  return betaInc(d2 / (d2 + d1 * f), d2 / 2, d1 / 2);
}

export function fInv(p: number, d1: number, d2: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return Infinity;
  const x = betaIncInv(p, d1 / 2, d2 / 2);
  return (d2 * x) / (d1 * (1 - x));
}

// ---------------- Chi-square ----------------
export function chi2Cdf(x: number, k: number): number {
  if (x <= 0) return 0;
  return gammaP(k / 2, x / 2);
}

export function chi2Sf(x: number, k: number): number {
  if (x <= 0) return 1;
  if (isNaN(x)) return NaN;
  return gammaQ(k / 2, x / 2);
}

export function chi2Inv(p: number, k: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return Infinity;
  // Wilson-Hilferty starting point, then bracketed root finding
  const z = normInv(p);
  let guess = k * Math.pow(1 - 2 / (9 * k) + z * Math.sqrt(2 / (9 * k)), 3);
  if (!(guess > 0)) guess = 0.5;
  let lo = 0;
  let hi = Math.max(guess * 2, 1);
  while (chi2Cdf(hi, k) < p) hi *= 2;
  return brent((x) => chi2Cdf(x, k) - p, lo, hi, 1e-14);
}

export function gammaCdf(x: number, shape: number, scale: number): number {
  return gammaP(shape, x / scale);
}

// ---------------- Beta ----------------
export function betaPdf(x: number, a: number, b: number): number {
  if (x < 0 || x > 1) return 0;
  return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - lbeta(a, b));
}

export function betaIncInv(p: number, a: number, b: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  // Initial guess (Numerical Recipes 6.4) followed by Halley iterations, then bisection safeguard.
  let x: number;
  const a1 = a - 1, b1 = b - 1;
  if (a >= 1 && b >= 1) {
    const pp = p < 0.5 ? p : 1 - p;
    const t = Math.sqrt(-2 * Math.log(pp));
    let xx = (2.30753 + t * 0.27061) / (1 + t * (0.99229 + t * 0.04481)) - t;
    if (p < 0.5) xx = -xx;
    const al = (xx * xx - 3) / 6;
    const h = 2 / (1 / (2 * a - 1) + 1 / (2 * b - 1));
    const w = (xx * Math.sqrt(al + h)) / h - (1 / (2 * b - 1) - 1 / (2 * a - 1)) * (al + 5 / 6 - 2 / (3 * h));
    x = a / (a + b * Math.exp(2 * w));
  } else {
    const lna = Math.log(a / (a + b)), lnb = Math.log(b / (a + b));
    const t = Math.exp(a * lna) / a;
    const u = Math.exp(b * lnb) / b;
    const w = t + u;
    if (p < t / w) x = Math.pow(a * w * p, 1 / a);
    else x = 1 - Math.pow(b * w * (1 - p), 1 / b);
  }
  const afac = -lbeta(a, b);
  for (let j = 0; j < 20; j++) {
    if (x <= 0 || x >= 1) break;
    const err = betaInc(x, a, b) - p;
    let t = Math.exp(a1 * Math.log(x) + b1 * Math.log(1 - x) + afac);
    const u = err / t;
    t = u / (1 - 0.5 * Math.min(1, u * (a1 / x - b1 / (1 - x))));
    x -= t;
    if (x <= 0) x = 0.5 * (x + t);
    if (x >= 1) x = 0.5 * (x + t + 1);
    if (Math.abs(t) < 1e-14 * x && j > 0) break;
  }
  if (!(x > 0 && x < 1) || Math.abs(betaInc(x, a, b) - p) > 1e-10 * Math.max(p, 1e-300) + 1e-14) {
    x = brent((v) => betaInc(v, a, b) - p, 0, 1, 1e-15);
  }
  return x;
}

// ---------------- Discrete ----------------
export function lchoose(n: number, k: number): number {
  return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
}

export function binomPmf(k: number, n: number, p: number): number {
  if (k < 0 || k > n) return 0;
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  return Math.exp(lchoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

export function binomCdf(k: number, n: number, p: number): number {
  if (k < 0) return 0;
  if (k >= n) return 1;
  return 1 - betaInc(p, k + 1, n - k);
}

export function poissonCdf(k: number, lambda: number): number {
  if (k < 0) return 0;
  return gammaQ(Math.floor(k) + 1, lambda);
}

export function hypergeomPmf(k: number, N: number, K: number, n: number): number {
  if (k < Math.max(0, n - (N - K)) || k > Math.min(n, K)) return 0;
  return Math.exp(lchoose(K, k) + lchoose(N - K, n - k) - lchoose(N, n));
}

// ---------------- Root finding & quadrature ----------------
export function brent(f: (x: number) => number, a: number, b: number, tol = 1e-12, maxIter = 300): number {
  let fa = f(a), fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (fa * fb > 0) {
    // Try to expand the bracket
    for (let i = 0; i < 60 && fa * fb > 0; i++) {
      const w = b - a;
      a -= w;
      b += w;
      fa = f(a);
      fb = f(b);
    }
    if (fa * fb > 0) return NaN;
  }
  let c = a, fc = fa, d = b - a, e = d;
  for (let iter = 0; iter < maxIter; iter++) {
    if (fb * fc > 0) {
      c = a; fc = fa; d = b - a; e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b; b = c; c = a;
      fa = fb; fb = fc; fc = fa;
    }
    const tol1 = 2 * Number.EPSILON * Math.abs(b) + 0.5 * tol;
    const xm = 0.5 * (c - b);
    if (Math.abs(xm) <= tol1 || fb === 0) return b;
    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p: number, q: number;
      if (a === c) {
        p = 2 * xm * s;
        q = 1 - s;
      } else {
        const qq = fa / fc, r = fb / fc;
        p = s * (2 * xm * qq * (qq - r) - (b - a) * (r - 1));
        q = (qq - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      p = Math.abs(p);
      if (2 * p < Math.min(3 * xm * q - Math.abs(tol1 * q), Math.abs(e * q))) {
        e = d;
        d = p / q;
      } else {
        d = xm;
        e = d;
      }
    } else {
      d = xm;
      e = d;
    }
    a = b;
    fa = fb;
    b += Math.abs(d) > tol1 ? d : xm > 0 ? tol1 : -tol1;
    fb = f(b);
  }
  return b;
}

const glCache = new Map<number, { x: number[]; w: number[] }>();
/** Gauss-Legendre nodes/weights on [-1, 1]. */
export function gaussLegendre(n: number): { x: number[]; w: number[] } {
  const cached = glCache.get(n);
  if (cached) return cached;
  const x = new Array(n).fill(0), w = new Array(n).fill(0);
  const m = Math.floor((n + 1) / 2);
  for (let i = 0; i < m; i++) {
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
    let pp = 0;
    for (let it = 0; it < 100; it++) {
      let p1 = 1, p2 = 0;
      for (let j = 0; j < n; j++) {
        const p3 = p2;
        p2 = p1;
        p1 = ((2 * j + 1) * z * p2 - j * p3) / (j + 1);
      }
      pp = (n * (z * p1 - p2)) / (z * z - 1);
      const z1 = z;
      z = z1 - p1 / pp;
      if (Math.abs(z - z1) < 1e-15) break;
    }
    x[i] = -z;
    x[n - 1 - i] = z;
    w[i] = 2 / ((1 - z * z) * pp * pp);
    w[n - 1 - i] = w[i];
  }
  const res = { x, w };
  glCache.set(n, res);
  return res;
}

export function integrate(f: (x: number) => number, a: number, b: number, n = 64): number {
  const { x, w } = gaussLegendre(n);
  const h = (b - a) / 2, c = (a + b) / 2;
  let s = 0;
  for (let i = 0; i < n; i++) s += w[i] * f(c + h * x[i]);
  return s * h;
}

// ---------------- Studentized range (Tukey) ----------------
const XLEG = [0.98156063424671925069, 0.90411725637047485668, 0.76990267419430468704, 0.58731795428661744730, 0.36783149899818019375, 0.12523340851146891547];
const ALEG = [0.047175336386511827195, 0.10693932599531843096, 0.16007832854334622633, 0.20316742672306592175, 0.23349253653835480876, 0.24914704581340278500];

function wprob(w: number, rr: number, cc: number): number {
  const nleg = 12, ihalf = 6;
  const C1 = -30, C2 = -50, C3 = 60, bb = 8, wlar = 3, wincr1 = 2, wincr2 = 3;
  const qsqz = w * 0.5;
  if (qsqz >= bb) return 1;
  let pr_w = 2 * normCdf(qsqz) - 1;
  if (pr_w >= Math.exp(C2 / cc)) pr_w = Math.pow(pr_w, cc);
  else pr_w = 0;
  const wincr = w > wlar ? wincr1 : wincr2;
  let blb = qsqz;
  const binc = (bb - qsqz) / wincr;
  let bub = blb + binc;
  let einsum = 0;
  const cc1 = cc - 1;
  for (let wi = 1; wi <= wincr; wi++) {
    let elsum = 0;
    const a = 0.5 * (bub + blb);
    const b = 0.5 * (bub - blb);
    for (let jj = 1; jj <= nleg; jj++) {
      let j: number, xx: number;
      if (ihalf < jj) {
        j = nleg - jj + 1;
        xx = XLEG[j - 1];
      } else {
        j = jj;
        xx = -XLEG[j - 1];
      }
      const c = b * xx;
      const ac = a + c;
      const qexpo = ac * ac;
      if (qexpo > C3) break;
      const pplus = 2 * normCdf(ac);
      const pminus = 2 * normCdf(ac, w);
      let rinsum = pplus * 0.5 - pminus * 0.5;
      if (rinsum >= Math.exp(C1 / cc1)) {
        rinsum = ALEG[j - 1] * Math.exp(-(0.5 * qexpo)) * Math.pow(rinsum, cc1);
        elsum += rinsum;
      }
    }
    elsum *= (2 * b * cc) / Math.sqrt(2 * Math.PI);
    einsum += elsum;
    blb = bub;
    bub += binc;
  }
  pr_w += einsum;
  if (pr_w <= Math.exp(C1 / rr)) return 0;
  pr_w = Math.pow(pr_w, rr);
  return pr_w >= 1 ? 1 : pr_w;
}

const XLEGQ = [0.989400934991649932596, 0.944575023073232576078, 0.865631202387831743880, 0.755404408355003033895, 0.617876244402643748447, 0.458016777657227386342, 0.281603550779258913230, 0.0950125098376374401853];
const ALEGQ = [0.0271524594117540948518, 0.0622535239386478928628, 0.0951585116824927848099, 0.124628971255533872052, 0.149595988816576732081, 0.169156519395002538189, 0.182603415044923588867, 0.189450610455068496285];

/** CDF of the studentized range distribution with `nmeans` groups and `df` degrees of freedom. */
export function ptukey(q: number, nmeans: number, df: number, nranges = 1): number {
  if (q <= 0) return 0;
  if (df < 2 || nranges < 1 || nmeans < 2) return NaN;
  if (!isFinite(q)) return 1;
  const nlegq = 16, ihalfq = 8;
  const eps1 = -30, eps2 = 1e-14, dhaf = 100, dquar = 800, deigh = 5000, dlarg = 25000;
  if (df > dlarg) return wprob(q, nranges, nmeans);
  const f2 = df * 0.5;
  let f2lf = f2 * Math.log(df) - df * Math.LN2 - lgamma(f2);
  const f21 = f2 - 1;
  const ff4 = df * 0.25;
  let ulen: number;
  if (df <= dhaf) ulen = 1;
  else if (df <= dquar) ulen = 0.5;
  else if (df <= deigh) ulen = 0.25;
  else ulen = 0.125;
  f2lf += Math.log(ulen);
  let ans = 0;
  let otsum = 0;
  for (let i = 1; i <= 50; i++) {
    otsum = 0;
    const twa1 = (2 * i - 1) * ulen;
    for (let jj = 1; jj <= nlegq; jj++) {
      let j: number, t1: number;
      if (ihalfq < jj) {
        j = jj - ihalfq - 1;
        t1 = f2lf + f21 * Math.log(twa1 + XLEGQ[j] * ulen) - (XLEGQ[j] * ulen + twa1) * ff4;
      } else {
        j = jj - 1;
        t1 = f2lf + f21 * Math.log(twa1 - XLEGQ[j] * ulen) + (XLEGQ[j] * ulen - twa1) * ff4;
      }
      if (t1 >= eps1) {
        let qsqz: number;
        if (ihalfq < jj) qsqz = q * Math.sqrt((XLEGQ[j] * ulen + twa1) * 0.5);
        else qsqz = q * Math.sqrt((-(XLEGQ[j] * ulen) + twa1) * 0.5);
        const wprb = wprob(qsqz, nranges, nmeans);
        otsum += wprb * ALEGQ[j] * Math.exp(t1);
      }
    }
    if (i * ulen >= 1 && otsum <= eps2) break;
    ans += otsum;
  }
  return ans > 1 ? 1 : ans;
}

export function qtukey(p: number, nmeans: number, df: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return Infinity;
  let hi = 5;
  while (ptukey(hi, nmeans, df) < p && hi < 1e4) hi *= 2;
  return brent((q) => ptukey(q, nmeans, df) - p, 0, hi, 1e-10);
}

// ---------------- Dunnett (many-to-one comparisons) ----------------
/**
 * P(max_i |T_i| <= c) for Dunnett-type statistics with correlation rho_ij = lambda_i * lambda_j,
 * lambda_i = sqrt(n_i / (n_i + n0)), and `df` error degrees of freedom.
 */
export function dunnettCdf(c: number, lambdas: number[], df: number): number {
  if (c <= 0) return 0;
  const nodesZ = gaussLegendre(48);
  const zLo = -7.5, zHi = 7.5;
  const hz = (zHi - zLo) / 2, cz = (zHi + zLo) / 2;
  const sqrt1m = lambdas.map((l) => Math.sqrt(1 - l * l));
  const inner = (s: number) => {
    let tot = 0;
    for (let i = 0; i < nodesZ.x.length; i++) {
      const z = cz + hz * nodesZ.x[i];
      let prod = 1;
      for (let k = 0; k < lambdas.length; k++) {
        const up = (c * s - lambdas[k] * z) / sqrt1m[k];
        const lo = (-c * s - lambdas[k] * z) / sqrt1m[k];
        prod *= normCdf(up) - normCdf(lo);
        if (prod < 1e-300) break;
      }
      tot += nodesZ.w[i] * normPdf(z) * prod;
    }
    return tot * hz;
  };
  if (!isFinite(df) || df > 5000) return inner(1);
  // Density of s = sqrt(chi2_df / df)
  const logC = (df / 2) * Math.log(df) - (df / 2 - 1) * Math.LN2 - lgamma(df / 2);
  const sDens = (s: number) => (s <= 0 ? 0 : Math.exp(logC + (df - 1) * Math.log(s) - (df * s * s) / 2));
  const sLo = Math.sqrt(chi2Inv(1e-9, df) / df);
  const sHi = Math.sqrt(chi2Inv(1 - 1e-9, df) / df);
  const panels = 4;
  const nodesS = gaussLegendre(24);
  let total = 0;
  for (let p = 0; p < panels; p++) {
    const a = sLo + ((sHi - sLo) * p) / panels;
    const b = sLo + ((sHi - sLo) * (p + 1)) / panels;
    const h = (b - a) / 2, m = (a + b) / 2;
    for (let i = 0; i < nodesS.x.length; i++) {
      const s = m + h * nodesS.x[i];
      total += nodesS.w[i] * h * sDens(s) * inner(s);
    }
  }
  return Math.min(1, total);
}

export function dunnettCritical(alpha: number, lambdas: number[], df: number): number {
  return brent((c) => dunnettCdf(c, lambdas, df) - (1 - alpha), 0.5, 10, 1e-6);
}
