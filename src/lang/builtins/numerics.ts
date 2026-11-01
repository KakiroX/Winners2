import { MError, StructArray, Tensor, colVec, isStringLike, num, rowVec, str, toNumber, toStringValue, toTensor, zeros, type Value } from '../value';
import type { Interpreter, CallContext } from '../interp';
import { argNum, argT, def, minArgs, nameValues } from './helpers';
import { mldivide } from '../ops';
import { EigenvalueDecomposition, Matrix } from 'ml-matrix';
import { invertM } from '../../stats/linalg';

function vec(t: Tensor): number[] {
  return Array.from(t.re);
}

function scalarFn(ctx: CallContext, f: Value): (x: number) => number {
  const call = ctx.interp.makeCallable(f, ctx.scope);
  return (x) => toNumber(call([num(x)])[0], 'function value');
}

function vectorFn(ctx: CallContext, f: Value): (x: number[]) => number[] {
  const call = ctx.interp.makeCallable(f, ctx.scope);
  return (x) => vec(toTensor(call([colVec(x)])[0]));
}

function shapeLike(x0: Tensor, v: number[]): Tensor {
  return new Tensor(x0.rows, x0.cols, Float64Array.from(v));
}

function getOpt(opts: Value | undefined, name: string, def: number): number {
  if (!opts || opts.kind !== 'struct') return def;
  const k = opts.fields.find((f) => f.toLowerCase() === name.toLowerCase());
  if (!k) return def;
  const v = opts.data[0].get(k)!;
  if (v.kind === 'tensor' && v.numel === 0) return def;
  return toNumber(v);
}

export function polyvalArr(p: number[], x: number): number {
  let r = 0;
  for (const c of p) r = r * x + c;
  return r;
}

export function rootsOf(pIn: number[]): { re: number[]; im: number[] } {
  let p = [...pIn];
  while (p.length && p[0] === 0) p.shift();
  let trailing = 0;
  while (p.length && p[p.length - 1] === 0) {
    p.pop();
    trailing++;
  }
  const n = p.length - 1;
  const re: number[] = [], im: number[] = [];
  if (n >= 1) {
    const C = Matrix.zeros(n, n);
    for (let j = 0; j < n; j++) C.set(0, j, -p[j + 1] / p[0]);
    for (let i = 1; i < n; i++) C.set(i, i - 1, 1);
    const e = new EigenvalueDecomposition(C);
    re.push(...e.realEigenvalues);
    im.push(...e.imaginaryEigenvalues);
  }
  for (let k = 0; k < trailing; k++) {
    re.push(0);
    im.push(0);
  }
  return { re, im };
}

function naturalOrNotAKnotSpline(x: number[], y: number[]) {
  const n = x.length;
  if (n < 2) throw new MError('There should be at least two data points.');
  if (n === 2) return (xi: number) => y[0] + ((y[1] - y[0]) * (xi - x[0])) / (x[1] - x[0]);
  if (n === 3) {
    // parabola through 3 points (MATLAB behaviour)
    const [x0, x1, x2] = x, [y0, y1, y2] = y;
    return (xi: number) => y0 * ((xi - x1) * (xi - x2)) / ((x0 - x1) * (x0 - x2)) + y1 * ((xi - x0) * (xi - x2)) / ((x1 - x0) * (x1 - x2)) + y2 * ((xi - x0) * (xi - x1)) / ((x2 - x0) * (x2 - x1));
  }
  // Not-a-knot cubic spline: solve for second derivatives M
  const h = Array.from({ length: n - 1 }, (_, i) => x[i + 1] - x[i]);
  const A: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const r = new Array(n).fill(0);
  A[0][0] = h[1];
  A[0][1] = -(h[0] + h[1]);
  A[0][2] = h[0];
  A[n - 1][n - 3] = h[n - 2];
  A[n - 1][n - 2] = -(h[n - 3] + h[n - 2]);
  A[n - 1][n - 1] = h[n - 3];
  for (let i = 1; i < n - 1; i++) {
    A[i][i - 1] = h[i - 1];
    A[i][i] = 2 * (h[i - 1] + h[i]);
    A[i][i + 1] = h[i];
    r[i] = 6 * ((y[i + 1] - y[i]) / h[i] - (y[i] - y[i - 1]) / h[i - 1]);
  }
  const inv = invertM(A, 1e-300);
  const M = inv ? inv.map((row) => row.reduce((s, v, k) => s + v * r[k], 0)) : new Array(n).fill(0);
  return (xi: number) => {
    let i = 0;
    if (xi <= x[0]) i = 0;
    else if (xi >= x[n - 1]) i = n - 2;
    else {
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (x[mid] <= xi) lo = mid;
        else hi = mid;
      }
      i = lo;
    }
    const hi = h[i];
    const a = (x[i + 1] - xi) / hi, b = (xi - x[i]) / hi;
    return a * y[i] + b * y[i + 1] + ((a * a * a - a) * M[i] + (b * b * b - b) * M[i + 1]) * (hi * hi) / 6;
  };
}

function pchipFn(x: number[], y: number[]) {
  const n = x.length;
  const h = Array.from({ length: n - 1 }, (_, i) => x[i + 1] - x[i]);
  const del = Array.from({ length: n - 1 }, (_, i) => (y[i + 1] - y[i]) / h[i]);
  const d = new Array(n).fill(0);
  if (n === 2) {
    d[0] = d[1] = del[0];
  } else {
    for (let k = 1; k < n - 1; k++) {
      if (del[k - 1] * del[k] > 0) {
        const w1 = 2 * h[k] + h[k - 1], w2 = h[k] + 2 * h[k - 1];
        d[k] = (w1 + w2) / (w1 / del[k - 1] + w2 / del[k]);
      }
    }
    const end = (h0: number, h1: number, d0: number, d1: number) => {
      let dd = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
      if (Math.sign(dd) !== Math.sign(d0)) dd = 0;
      else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(dd) > Math.abs(3 * d0)) dd = 3 * d0;
      return dd;
    };
    d[0] = end(h[0], h[1], del[0], del[1]);
    d[n - 1] = end(h[n - 2], h[n - 3], del[n - 2], del[n - 3]);
  }
  return (xi: number) => {
    let i = 0;
    if (xi >= x[n - 1]) i = n - 2;
    else if (xi > x[0]) {
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (x[mid] <= xi) lo = mid;
        else hi = mid;
      }
      i = lo;
    }
    const s = xi - x[i], hh = h[i];
    const c = (3 * del[i] - 2 * d[i] - d[i + 1]) / hh;
    const b = (d[i] - 2 * del[i] + d[i + 1]) / (hh * hh);
    return y[i] + s * (d[i] + s * (c + s * b));
  };
}

export function interp1(x: number[], y: number[], xi: number[], method: string, extrap: number | 'extrap' | null): number[] {
  const order = x.map((_, i) => i).sort((a, b) => x[a] - x[b]);
  const xs = order.map((i) => x[i]), ys = order.map((i) => y[i]);
  const n = xs.length;
  let f: (v: number) => number;
  switch (method) {
    case 'nearest':
      f = (v) => {
        let best = 0;
        for (let i = 1; i < n; i++) if (Math.abs(xs[i] - v) < Math.abs(xs[best] - v) || (Math.abs(xs[i] - v) === Math.abs(xs[best] - v) && xs[i] > xs[best])) best = i;
        return ys[best];
      };
      break;
    case 'previous':
      f = (v) => {
        let k = -1;
        for (let i = 0; i < n; i++) if (xs[i] <= v) k = i;
        return k < 0 ? NaN : ys[k];
      };
      break;
    case 'next':
      f = (v) => {
        for (let i = 0; i < n; i++) if (xs[i] >= v) return ys[i];
        return NaN;
      };
      break;
    case 'spline':
      f = naturalOrNotAKnotSpline(xs, ys);
      break;
    case 'pchip':
    case 'cubic':
      f = pchipFn(xs, ys);
      break;
    default:
      f = (v) => {
        if (n === 1) return v === xs[0] ? ys[0] : NaN;
        let i = 0;
        if (v <= xs[0]) i = 0;
        else if (v >= xs[n - 1]) i = n - 2;
        else {
          let lo = 0, hi = n - 1;
          while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (xs[mid] <= v) lo = mid;
            else hi = mid;
          }
          i = lo;
        }
        const t = (v - xs[i]) / (xs[i + 1] - xs[i]);
        return ys[i] + t * (ys[i + 1] - ys[i]);
      };
  }
  const lo = xs[0], hi = xs[n - 1];
  const doExtrap = extrap === 'extrap' || ((method === 'spline' || method === 'pchip' || method === 'cubic') && extrap === null);
  return xi.map((v) => {
    if (Number.isNaN(v)) return NaN;
    if (v < lo || v > hi) {
      if (doExtrap) return f(v);
      return typeof extrap === 'number' ? extrap : NaN;
    }
    return f(v);
  });
}

// ---------------- FFT ----------------
export function fftComplex(re: number[], im: number[], inverse = false): [number[], number[]] {
  const n = re.length;
  if (n <= 1) return [re.slice(), im.slice()];
  if ((n & (n - 1)) === 0) return radix2(re, im, inverse);
  // Bluestein's algorithm
  let m = 1;
  while (m < 2 * n - 1) m <<= 1;
  const sgn = inverse ? 1 : -1;
  const wr = new Array(n), wi = new Array(n);
  for (let k = 0; k < n; k++) {
    const ang = (sgn * Math.PI * ((k * k) % (2 * n))) / n;
    wr[k] = Math.cos(ang);
    wi[k] = Math.sin(ang);
  }
  const ar = new Array(m).fill(0), ai = new Array(m).fill(0);
  for (let k = 0; k < n; k++) {
    ar[k] = re[k] * wr[k] - im[k] * wi[k];
    ai[k] = re[k] * wi[k] + im[k] * wr[k];
  }
  const br = new Array(m).fill(0), bi = new Array(m).fill(0);
  br[0] = wr[0];
  bi[0] = -wi[0];
  for (let k = 1; k < n; k++) {
    br[k] = br[m - k] = wr[k];
    bi[k] = bi[m - k] = -wi[k];
  }
  const [Ar, Ai] = radix2(ar, ai, false);
  const [Br, Bi] = radix2(br, bi, false);
  const cr = new Array(m), ci = new Array(m);
  for (let k = 0; k < m; k++) {
    cr[k] = Ar[k] * Br[k] - Ai[k] * Bi[k];
    ci[k] = Ar[k] * Bi[k] + Ai[k] * Br[k];
  }
  const [Cr, Ci] = radix2(cr, ci, true);
  const outR = new Array(n), outI = new Array(n);
  for (let k = 0; k < n; k++) {
    const xr = Cr[k], xi = Ci[k];
    outR[k] = xr * wr[k] - xi * wi[k];
    outI[k] = xr * wi[k] + xi * wr[k];
  }
  if (inverse) for (let k = 0; k < n; k++) {
    outR[k] /= n;
    outI[k] /= n;
  }
  return [outR, outI];
}

function radix2(reIn: number[], imIn: number[], inverse: boolean): [number[], number[]] {
  const n = reIn.length;
  const re = reIn.slice(), im = imIn.slice();
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const half = len / 2;
    const twr = new Float64Array(half), twi = new Float64Array(half);
    for (let k = 0; k < half; k++) {
      twr[k] = Math.cos(ang * k);
      twi[k] = Math.sin(ang * k);
    }
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = twr[k], wi = twi[k];
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
      }
    }
  }
  if (inverse) for (let k = 0; k < n; k++) {
    re[k] /= n;
    im[k] /= n;
  }
  return [re, im];
}

function levenbergMarquardt(F: (p: number[]) => number[], p0: number[], maxIter = 400, tol = 1e-10) {
  let p = [...p0];
  let r = F(p);
  let ss = r.reduce((s, v) => s + v * v, 0);
  let lambda = 1e-3;
  const k = p.length;
  let iter = 0;
  let converged = false;
  for (; iter < maxIter; iter++) {
    const J: number[][] = r.map(() => new Array(k).fill(0));
    for (let c = 0; c < k; c++) {
      const h = 1e-7 * Math.max(Math.abs(p[c]), 1);
      const pp = [...p];
      pp[c] += h;
      const rh = F(pp);
      for (let i = 0; i < r.length; i++) J[i][c] = (rh[i] - r[i]) / h;
    }
    const A = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, b) => J.reduce((s, row) => s + row[a] * row[b], 0)));
    const g = Array.from({ length: k }, (_, a) => J.reduce((s, row, i) => s + row[a] * r[i], 0));
    let improved = false;
    for (let t = 0; t < 30; t++) {
      const M = A.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lambda) + 1e-12 : v)));
      const inv = invertM(M, 1e-300);
      if (!inv) {
        lambda *= 10;
        continue;
      }
      const d = inv.map((row) => -row.reduce((s, v, b) => s + v * g[b], 0));
      const pn = p.map((v, i) => v + d[i]);
      const rn = F(pn);
      const ssn = rn.reduce((s, v) => s + v * v, 0);
      if (Number.isFinite(ssn) && ssn < ss) {
        const rel = (ss - ssn) / Math.max(ss, 1e-300);
        p = pn;
        r = rn;
        ss = ssn;
        lambda = Math.max(1e-12, lambda / 10);
        improved = true;
        if (rel < tol || Math.max(...d.map((v, i) => Math.abs(v) / Math.max(1, Math.abs(p[i])))) < tol) converged = true;
        break;
      }
      lambda *= 10;
    }
    if (!improved || converged || ss < 1e-30) {
      converged = true;
      break;
    }
  }
  return { p, ss, r, iter, converged };
}

function nelderMead(f: (x: number[]) => number, x0: number[], opts: { tolX: number; tolF: number; maxIter: number; maxFun: number }) {
  const n = x0.length;
  let simplex: number[][] = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const y = x0.slice();
    y[i] = y[i] !== 0 ? 1.05 * y[i] : 0.00025;
    simplex.push(y);
  }
  let fv = simplex.map(f);
  let funcCount = n + 1;
  let iter = 0;
  const order = () => {
    const idx = fv.map((_, i) => i).sort((a, b) => fv[a] - fv[b]);
    simplex = idx.map((i) => simplex[i]);
    fv = idx.map((i) => fv[i]);
  };
  order();
  while (iter < opts.maxIter && funcCount < opts.maxFun) {
    const maxDx = Math.max(...simplex.slice(1).map((s) => Math.max(...s.map((v, j) => Math.abs(v - simplex[0][j])))));
    const maxDf = Math.max(...fv.slice(1).map((v) => Math.abs(v - fv[0])));
    if (maxDx <= opts.tolX && maxDf <= opts.tolF) break;
    iter++;
    const xbar = Array.from({ length: n }, (_, j) => simplex.slice(0, n).reduce((s, p) => s + p[j], 0) / n);
    const xr = xbar.map((v, j) => 2 * v - simplex[n][j]);
    const fr = f(xr);
    funcCount++;
    if (fr < fv[0]) {
      const xe = xbar.map((v, j) => 3 * v - 2 * simplex[n][j]);
      const fe = f(xe);
      funcCount++;
      if (fe < fr) {
        simplex[n] = xe;
        fv[n] = fe;
      } else {
        simplex[n] = xr;
        fv[n] = fr;
      }
    } else if (fr < fv[n - 1]) {
      simplex[n] = xr;
      fv[n] = fr;
    } else {
      let shrink = false;
      if (fr < fv[n]) {
        const xc = xbar.map((v, j) => 1.5 * v - 0.5 * simplex[n][j]);
        const fc = f(xc);
        funcCount++;
        if (fc <= fr) {
          simplex[n] = xc;
          fv[n] = fc;
        } else shrink = true;
      } else {
        const xcc = xbar.map((v, j) => 0.5 * v + 0.5 * simplex[n][j]);
        const fcc = f(xcc);
        funcCount++;
        if (fcc < fv[n]) {
          simplex[n] = xcc;
          fv[n] = fcc;
        } else shrink = true;
      }
      if (shrink) {
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]));
          fv[i] = f(simplex[i]);
          funcCount++;
        }
      }
    }
    order();
  }
  return { x: simplex[0], fval: fv[0], iter, funcCount, exitflag: iter >= opts.maxIter || funcCount >= opts.maxFun ? 0 : 1 };
}

function brentMin(f: (x: number) => number, a: number, b: number, tol = 1e-4) {
  const gold = 0.3819660112501051;
  let x = a + gold * (b - a), w = x, v = x;
  let fx = f(x), fw = fx, fv = fx;
  let d = 0, e = 0;
  let iter = 0;
  for (; iter < 500; iter++) {
    const xm = 0.5 * (a + b);
    const tol1 = 1.4901161193847656e-8 * Math.abs(x) + tol / 3, tol2 = 2 * tol1;
    if (Math.abs(x - xm) <= tol2 - 0.5 * (b - a)) break;
    let golden = true;
    if (Math.abs(e) > tol1) {
      const r = (x - w) * (fx - fv);
      let q = (x - v) * (fx - fw);
      let p = (x - v) * q - (x - w) * r;
      q = 2 * (q - r);
      if (q > 0) p = -p;
      q = Math.abs(q);
      const etemp = e;
      e = d;
      if (!(Math.abs(p) >= Math.abs(0.5 * q * etemp) || p <= q * (a - x) || p >= q * (b - x))) {
        d = p / q;
        const u = x + d;
        if (u - a < tol2 || b - u < tol2) d = xm - x >= 0 ? tol1 : -tol1;
        golden = false;
      }
    }
    if (golden) {
      e = x >= xm ? a - x : b - x;
      d = gold * e;
    }
    const u = Math.abs(d) >= tol1 ? x + d : x + (d >= 0 ? tol1 : -tol1);
    const fu = f(u);
    if (fu <= fx) {
      if (u >= x) a = x;
      else b = x;
      v = w; fv = fw; w = x; fw = fx; x = u; fx = fu;
    } else {
      if (u < x) a = u;
      else b = u;
      if (fu <= fw || w === x) {
        v = w; fv = fw; w = u; fw = fu;
      } else if (fu <= fv || v === x || v === w) {
        v = u; fv = fu;
      }
    }
  }
  return { x, fval: fx, iter };
}

function gaussKronrod(f: (x: number[]) => number[], a: number, b: number, absTol: number, relTol: number): { value: number; err: number } {
  const xk = [0.991455371120813, 0.949107912342759, 0.864864423359769, 0.741531185599394, 0.586087235467691, 0.405845151377397, 0.207784955007898, 0];
  const wk = [0.022935322010529, 0.063092092629979, 0.104790010322250, 0.140653259715525, 0.169004726639267, 0.190350578064785, 0.204432940075298, 0.209482141084728];
  const wg = [0, 0.129484966168870, 0, 0.279705391489277, 0, 0.381830050505119, 0, 0.417959183673469];
  const seg = (lo: number, hi: number) => {
    const c = (lo + hi) / 2, h = (hi - lo) / 2;
    const xs: number[] = [];
    for (let i = 0; i < 7; i++) xs.push(c - h * xk[i], c + h * xk[i]);
    xs.push(c);
    const fv = f(xs);
    let k = 0, g = 0;
    for (let i = 0; i < 7; i++) {
      const s = fv[2 * i] + fv[2 * i + 1];
      k += wk[i] * s;
      g += wg[i] * s;
    }
    k += wk[7] * fv[14];
    g += wg[7] * fv[14];
    return { v: k * h, e: Math.abs((k - g) * h) };
  };
  let intervals = [{ lo: a, hi: b, ...seg(a, b) }];
  for (let it = 0; it < 650; it++) {
    const total = intervals.reduce((s, x) => s + x.v, 0);
    const err = intervals.reduce((s, x) => s + x.e, 0);
    if (err <= Math.max(absTol, relTol * Math.abs(total))) return { value: total, err };
    intervals.sort((p, q) => q.e - p.e);
    const worst = intervals.shift()!;
    const mid = (worst.lo + worst.hi) / 2;
    intervals.push({ lo: worst.lo, hi: mid, ...seg(worst.lo, mid) }, { lo: mid, hi: worst.hi, ...seg(mid, worst.hi) });
  }
  return { value: intervals.reduce((s, x) => s + x.v, 0), err: intervals.reduce((s, x) => s + x.e, 0) };
}

function integrate1(ctx: CallContext, fv: Value, a: number, b: number, opts: Map<string, Value>): number {
  const call = ctx.interp.makeCallable(fv, ctx.scope);
  const arrayValued = opts.has('arrayvalued') && toNumber(opts.get('arrayvalued')!) !== 0;
  let vectorized = !arrayValued;
  const evalF = (xs: number[]): number[] => {
    if (vectorized) {
      try {
        const r = toTensor(call([rowVec(xs)])[0]);
        if (r.numel === xs.length) return Array.from(r.re);
      } catch {
        /* fall back to scalar calls */
      }
      vectorized = false;
    }
    return xs.map((x) => toNumber(call([num(x)])[0]));
  };
  const absTol = opts.has('abstol') ? toNumber(opts.get('abstol')!) : 1e-10;
  const relTol = opts.has('reltol') ? toNumber(opts.get('reltol')!) : 1e-6;
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    // map to (-1, 1) via x = t / (1 - t^2)
    const map = (t: number) => t / (1 - t * t);
    const dmap = (t: number) => (1 + t * t) / ((1 - t * t) ** 2);
    const ta = a === -Infinity ? -1 : inverseMap(a), tb = b === Infinity ? 1 : inverseMap(b);
    const g = (ts: number[]) => {
      const xs = ts.map(map);
      const v = evalF(xs);
      return v.map((y, i) => y * dmap(ts[i]));
    };
    return gaussKronrod(g, ta, tb, absTol, relTol).value;
  }
  return gaussKronrod(evalF, a, b, absTol, relTol).value;
}

function inverseMap(x: number) {
  if (x === 0) return 0;
  return (-1 + Math.sqrt(1 + 4 * x * x)) / (2 * x);
}

function odeSolve(ctx: CallContext, fv: Value, tspan: number[], y0: number[], opts: Value | undefined, order: 45 | 23) {
  const call = ctx.interp.makeCallable(fv, ctx.scope);
  const f = (t: number, y: number[]) => {
    const r = toTensor(call([num(t), colVec(y)])[0]);
    if (r.numel !== y.length) throw new MError(`${order === 45 ? 'ode45' : 'ode23'}: the function must return a column vector of length ${y.length}.`);
    return Array.from(r.re);
  };
  const rtol = getOpt(opts, 'RelTol', 1e-3), atol = getOpt(opts, 'AbsTol', 1e-6);
  const t0 = tspan[0], tf = tspan[tspan.length - 1];
  const dir = Math.sign(tf - t0) || 1;
  const hmax = getOpt(opts, 'MaxStep', Math.abs(tf - t0) / 10);
  let h = getOpt(opts, 'InitialStep', Math.abs(tf - t0) / 100) * dir;
  const ts: number[] = [t0], ys: number[][] = [y0.slice()], ds: number[][] = [];
  let t = t0, y = y0.slice();
  let k1 = f(t, y);
  ds.push(k1);
  // Dormand-Prince or Bogacki-Shampine tableaux
  const DP = {
    c: [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1],
    a: [[], [1 / 5], [3 / 40, 9 / 40], [44 / 45, -56 / 15, 32 / 9], [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729], [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656], [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84]],
    b: [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0],
    e: [71 / 57600, 0, -71 / 16695, 71 / 1920, -17253 / 339200, 22 / 525, -1 / 40],
    p: 5,
  };
  const BS = {
    c: [0, 1 / 2, 3 / 4, 1],
    a: [[], [1 / 2], [0, 3 / 4], [2 / 9, 1 / 3, 4 / 9]],
    b: [2 / 9, 1 / 3, 4 / 9, 0],
    e: [-5 / 72, 1 / 12, 1 / 9, -1 / 8],
    p: 3,
  };
  const tab = order === 45 ? DP : BS;
  let steps = 0;
  while ((tf - t) * dir > 1e-14 * Math.max(1, Math.abs(tf))) {
    ctx.interp.checkTime();
    if (++steps > 200000) throw new MError('Integration failed: too many steps.');
    if (Math.abs(h) > hmax) h = hmax * dir;
    if ((t + h - tf) * dir > 0) h = tf - t;
    const K: number[][] = [k1];
    for (let s = 1; s < tab.c.length; s++) {
      const yi = y.map((v, i) => v + h * tab.a[s].reduce((acc, aij, j) => acc + aij * K[j][i], 0));
      K.push(f(t + tab.c[s] * h, yi));
    }
    const ynew = y.map((v, i) => v + h * tab.b.reduce((acc, bj, j) => acc + bj * K[j][i], 0));
    const errv = y.map((_, i) => h * tab.e.reduce((acc, ej, j) => acc + ej * K[j][i], 0));
    let err = 0;
    for (let i = 0; i < y.length; i++) {
      const sc = atol + rtol * Math.max(Math.abs(y[i]), Math.abs(ynew[i]));
      err = Math.max(err, Math.abs(errv[i]) / sc);
    }
    if (err <= 1 || Math.abs(h) < 1e-14) {
      t += h;
      y = ynew;
      k1 = order === 45 ? K[6] : K[3];
      ts.push(t);
      ys.push(y.slice());
      ds.push(k1);
      const fac = err === 0 ? 5 : Math.min(5, Math.max(0.2, 0.9 * Math.pow(1 / err, 1 / tab.p)));
      h *= fac;
    } else {
      h *= Math.max(0.1, 0.9 * Math.pow(1 / err, 1 / tab.p));
    }
  }
  const hermite = (tq: number) => {
    let i = 0;
    while (i < ts.length - 2 && (ts[i + 1] - tq) * dir < 0) i++;
    const ta = ts[i], tb = ts[i + 1] ?? ts[i];
    const hh = tb - ta;
    if (hh === 0) return ys[i].slice();
    const s = (tq - ta) / hh;
    const h00 = 2 * s ** 3 - 3 * s ** 2 + 1, h10 = s ** 3 - 2 * s ** 2 + s, h01 = -2 * s ** 3 + 3 * s ** 2, h11 = s ** 3 - s ** 2;
    return ys[i].map((v, k) => h00 * v + h10 * hh * ds[i][k] + h01 * ys[i + 1][k] + h11 * hh * ds[i + 1][k]);
  };
  if (tspan.length > 2) return { t: tspan, y: tspan.map((tq, i) => (i === 0 ? y0.slice() : hermite(tq))) };
  // Refine = 4 like MATLAB's ode45 output
  const refine = order === 45 ? 4 : 1;
  const tOut: number[] = [ts[0]], yOut: number[][] = [ys[0]];
  for (let i = 1; i < ts.length; i++) {
    for (let r = 1; r < refine; r++) {
      const tq = ts[i - 1] + ((ts[i] - ts[i - 1]) * r) / refine;
      tOut.push(tq);
      yOut.push(hermite(tq));
    }
    tOut.push(ts[i]);
    yOut.push(ys[i]);
  }
  return { t: tOut, y: yOut };
}

export function registerNumerics(I: Interpreter) {
  def(I, 'polyfit', (a, nargout) => {
    const x = vec(argT(a, 0)), y = vec(argT(a, 1)), n = argNum(a, 2);
    let xs = x;
    let mu: number[] | null = null;
    if (nargout > 2) {
      const m = x.reduce((s, v) => s + v, 0) / x.length;
      const s = Math.sqrt(x.reduce((acc, v) => acc + (v - m) ** 2, 0) / (x.length - 1));
      mu = [m, s];
      xs = x.map((v) => (v - m) / s);
    }
    const V = zeros(xs.length, n + 1);
    for (let i = 0; i < xs.length; i++) for (let j = 0; j <= n; j++) V.re[j * xs.length + i] = Math.pow(xs[i], n - j);
    const p = mldivide(V, colVec(y));
    const pr = new Tensor(1, n + 1, p.re);
    const resid = y.map((v, i) => v - polyvalArr(Array.from(pr.re), xs[i]));
    const S = StructArray.scalar([['normr', num(Math.sqrt(resid.reduce((s, v) => s + v * v, 0)))], ['df', num(Math.max(0, x.length - (n + 1)))]]);
    return [pr, S, mu ? colVec(mu) : zeros(0, 0)].slice(0, Math.max(1, nargout));
  });
  def(I, 'polyval', (a) => {
    const p = vec(argT(a, 0));
    const x = argT(a, 1);
    let mu: number[] | null = null;
    if (a.length > 3) mu = vec(argT(a, 3));
    const out = zeros(x.rows, x.cols);
    for (let i = 0; i < x.numel; i++) out.re[i] = polyvalArr(p, mu ? (x.re[i] - mu[0]) / mu[1] : x.re[i]);
    return out;
  });
  def(I, 'polyvalm', (a) => {
    const p = vec(argT(a, 0));
    const X = argT(a, 1);
    const n = X.rows;
    let R = zeros(n, n);
    for (const c of p) {
      const RX = zeros(n, n);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) RX.re[j * n + i] += R.re[k * n + i] * X.re[j * n + k];
      for (let i = 0; i < n; i++) RX.re[i * n + i] += c;
      R = RX;
    }
    return R;
  });
  def(I, 'roots', (a) => {
    const r = rootsOf(vec(argT(a, 0)));
    const isC = r.im.some((v) => Math.abs(v) > 1e-12);
    return new Tensor(r.re.length, 1, Float64Array.from(r.re), isC ? Float64Array.from(r.im.map((v) => (Math.abs(v) < 1e-14 ? 0 : v))) : null);
  });
  def(I, 'poly', (a) => {
    const t = argT(a, 0);
    let rootsRe: number[], rootsIm: number[];
    if (t.rows === t.cols && t.rows > 1) {
      const e = new EigenvalueDecomposition(new Matrix(Array.from({ length: t.rows }, (_, i) => Array.from({ length: t.cols }, (_, j) => t.re[j * t.rows + i]))));
      rootsRe = e.realEigenvalues;
      rootsIm = e.imaginaryEigenvalues;
    } else {
      rootsRe = vec(t);
      rootsIm = t.im ? Array.from(t.im) : rootsRe.map(() => 0);
    }
    let cr = [1], ci = [0];
    for (let k = 0; k < rootsRe.length; k++) {
      const nr = new Array(cr.length + 1).fill(0), ni = new Array(cr.length + 1).fill(0);
      for (let j = 0; j < cr.length; j++) {
        nr[j] += cr[j];
        ni[j] += ci[j];
        nr[j + 1] -= cr[j] * rootsRe[k] - ci[j] * rootsIm[k];
        ni[j + 1] -= cr[j] * rootsIm[k] + ci[j] * rootsRe[k];
      }
      cr = nr;
      ci = ni;
    }
    const isC = ci.some((v) => Math.abs(v) > 1e-10);
    return new Tensor(1, cr.length, Float64Array.from(cr), isC ? Float64Array.from(ci) : null);
  });
  def(I, 'conv', (a) => {
    const u = vec(argT(a, 0)), v = vec(argT(a, 1));
    const shape = a.length > 2 ? toStringValue(a[2]) : 'full';
    const full = new Array(u.length + v.length - 1).fill(0);
    for (let i = 0; i < u.length; i++) for (let j = 0; j < v.length; j++) full[i + j] += u[i] * v[j];
    let out = full;
    if (shape === 'same') {
      const start = Math.floor(v.length / 2);
      out = full.slice(start, start + u.length);
    } else if (shape === 'valid') out = full.slice(v.length - 1, u.length);
    const ut = argT(a, 0);
    return ut.cols === 1 && ut.rows > 1 ? colVec(out) : rowVec(out);
  });
  def(I, 'deconv', (a) => {
    const u = vec(argT(a, 0)), v = vec(argT(a, 1));
    if (v.length > u.length) return [num(0), rowVec(u)];
    const q = new Array(u.length - v.length + 1).fill(0);
    const r = u.slice();
    for (let i = 0; i < q.length; i++) {
      q[i] = r[i] / v[0];
      for (let j = 0; j < v.length; j++) r[i + j] -= q[i] * v[j];
    }
    return [rowVec(q), rowVec(r)];
  });
  def(I, 'polyder', (a) => {
    if (a.length > 1) {
      // derivative of a product
      const u = vec(argT(a, 0)), v = vec(argT(a, 1));
      const prod = new Array(u.length + v.length - 1).fill(0);
      for (let i = 0; i < u.length; i++) for (let j = 0; j < v.length; j++) prod[i + j] += u[i] * v[j];
      const n = prod.length - 1;
      return rowVec(n === 0 ? [0] : prod.slice(0, n).map((c, i) => c * (n - i)));
    }
    const p = vec(argT(a, 0));
    const n = p.length - 1;
    if (n <= 0) return num(0);
    return rowVec(p.slice(0, n).map((c, i) => c * (n - i)));
  });
  def(I, 'polyint', (a) => {
    const p = vec(argT(a, 0));
    const k = a.length > 1 ? toNumber(a[1]) : 0;
    const n = p.length;
    return rowVec([...p.map((c, i) => c / (n - i)), k]);
  });
  def(I, 'interp1', (a) => {
    minArgs(a, 2);
    let x: number[], y: Tensor, xi: Tensor, rest: Value[];
    if (a.length === 2 || (a.length >= 3 && isStringLike(a[2]))) {
      y = argT(a, 0);
      x = Array.from({ length: y.rows === 1 ? y.cols : y.rows }, (_, i) => i + 1);
      xi = argT(a, 1);
      rest = a.slice(2);
    } else {
      x = vec(argT(a, 0));
      y = argT(a, 1);
      xi = argT(a, 2);
      rest = a.slice(3);
    }
    let method = 'linear';
    let extrap: number | 'extrap' | null = null;
    for (const r of rest) {
      if (isStringLike(r)) {
        const s = toStringValue(r).toLowerCase();
        if (s === 'extrap') extrap = 'extrap';
        else method = s.replace('*', '');
      } else extrap = toNumber(r);
    }
    if (y.rows === 1 || y.cols === 1) {
      const r = interp1(x, vec(y), vec(xi), method, extrap);
      return new Tensor(xi.rows, xi.cols, Float64Array.from(r));
    }
    const out = zeros(xi.numel, y.cols);
    for (let j = 0; j < y.cols; j++) {
      const r = interp1(x, Array.from(y.re.subarray(j * y.rows, (j + 1) * y.rows)), vec(xi), method, extrap);
      out.re.set(r, j * xi.numel);
    }
    return out;
  });
  def(I, ['spline', 'pchip'], (a, _n, ctx) => {
    const x = vec(argT(a, 0)), y = vec(argT(a, 1));
    if (a.length < 3) throw new MError('Piecewise polynomial (pp) form is not supported; pass query points as the third argument.');
    const xi = argT(a, 2);
    const r = interp1(x, y, vec(xi), ctx.name, 'extrap');
    return new Tensor(xi.rows, xi.cols, Float64Array.from(r));
  });
  def(I, 'interp2', (a) => {
    const X = vec(argT(a, 0)), Y = vec(argT(a, 1)), Z = argT(a, 2), Xi = argT(a, 3), Yi = argT(a, 4);
    const xs = [...new Set(X)].sort((p, q) => p - q), ys = [...new Set(Y)].sort((p, q) => p - q);
    const out = zeros(Xi.rows, Xi.cols);
    for (let k = 0; k < Xi.numel; k++) {
      const xv = Xi.re[k], yv = Yi.re[k];
      const ix = Math.max(0, Math.min(xs.length - 2, xs.findIndex((v) => v > xv) - 1));
      const iy = Math.max(0, Math.min(ys.length - 2, ys.findIndex((v) => v > yv) - 1));
      const tx = (xv - xs[ix]) / (xs[ix + 1] - xs[ix]), ty = (yv - ys[iy]) / (ys[iy + 1] - ys[iy]);
      const z = (i: number, j: number) => Z.re[i * Z.rows + j];
      if (xv < xs[0] || xv > xs[xs.length - 1] || yv < ys[0] || yv > ys[ys.length - 1]) out.re[k] = NaN;
      else out.re[k] = (1 - tx) * (1 - ty) * z(ix, iy) + tx * (1 - ty) * z(ix + 1, iy) + (1 - tx) * ty * z(ix, iy + 1) + tx * ty * z(ix + 1, iy + 1);
    }
    return out;
  });
  def(I, ['integral', 'quad', 'quadgk', 'quadl'], (a, _n, ctx) => {
    minArgs(a, 3);
    const lo = toNumber(a[1]), hi = toNumber(a[2]);
    const opts = nameValues(a, 3);
    return num(integrate1(ctx, a[0], lo, hi, opts));
  });
  def(I, 'integral2', (a, _n, ctx) => {
    const call = ctx.interp.makeCallable(a[0], ctx.scope);
    const xa = toNumber(a[1]), xb = toNumber(a[2]);
    const yaV = a[3], ybV = a[4];
    const yb = (x: number) => (ybV.kind === 'fhandle' ? toNumber(ctx.interp.callHandle(ybV, [num(x)], 1)[0]) : toNumber(ybV));
    const ya = (x: number) => (yaV.kind === 'fhandle' ? toNumber(ctx.interp.callHandle(yaV, [num(x)], 1)[0]) : toNumber(yaV));
    const inner = (x: number) => gaussKronrod((ys) => ys.map((y) => toNumber(call([num(x), num(y)])[0])), ya(x), yb(x), 1e-10, 1e-6).value;
    return num(gaussKronrod((xs) => xs.map(inner), xa, xb, 1e-10, 1e-6).value);
  });
  def(I, 'fzero', (a, nargout, ctx) => {
    minArgs(a, 2);
    const f = scalarFn(ctx, a[0]);
    const x0 = argT(a, 1);
    let lo: number, hi: number;
    if (x0.numel >= 2) {
      lo = x0.re[0];
      hi = x0.re[1];
      if (Math.sign(f(lo)) === Math.sign(f(hi)) && f(lo) !== 0) throw new MError('The function values at the interval endpoints must differ in sign.', 'MATLAB:fzero:ValuesAtEndPtsSameSign');
    } else {
      const x = x0.re[0];
      const fx = f(x);
      if (fx === 0) return [num(x), num(0), num(1)];
      let dx = x === 0 ? 1 / 50 : x / 50;
      lo = x;
      hi = x;
      let found = false;
      for (let k = 0; k < 120; k++) {
        dx *= Math.SQRT2;
        lo = x - dx;
        hi = x + dx;
        const fl = f(lo), fh = f(hi);
        if (!Number.isFinite(fl) || !Number.isFinite(fh)) continue;
        if (Math.sign(fl) !== Math.sign(fx)) {
          hi = x;
          found = true;
          break;
        }
        if (Math.sign(fh) !== Math.sign(fx)) {
          lo = x;
          found = true;
          break;
        }
      }
      if (!found) throw new MError('Exiting fzero: aborting search for an interval containing a sign change because no sign change was found.', 'MATLAB:fzero:NoSignChange');
    }
    let fa = f(lo), fb = f(hi);
    let b = hi, aa = lo;
    if (Math.abs(fa) < Math.abs(fb)) {
      [aa, b] = [b, aa];
      [fa, fb] = [fb, fa];
    }
    let c = aa, fc = fa, d = b - aa, e = d;
    for (let it = 0; it < 500; it++) {
      if (fb === 0) break;
      if (Math.sign(fb) === Math.sign(fc)) {
        c = aa; fc = fa; d = b - aa; e = d;
      }
      if (Math.abs(fc) < Math.abs(fb)) {
        aa = b; b = c; c = aa; fa = fb; fb = fc; fc = fa;
      }
      const tol = 2 * Number.EPSILON * Math.abs(b) + 1e-16;
      const m = 0.5 * (c - b);
      if (Math.abs(m) <= tol) break;
      if (Math.abs(e) >= tol && Math.abs(fa) > Math.abs(fb)) {
        const s = fb / fa;
        let p: number, q: number;
        if (aa === c) {
          p = 2 * m * s;
          q = 1 - s;
        } else {
          const qq = fa / fc, r = fb / fc;
          p = s * (2 * m * qq * (qq - r) - (b - aa) * (r - 1));
          q = (qq - 1) * (r - 1) * (s - 1);
        }
        if (p > 0) q = -q;
        else p = -p;
        if (2 * p < Math.min(3 * m * q - Math.abs(tol * q), Math.abs(e * q))) {
          e = d;
          d = p / q;
        } else {
          d = m;
          e = m;
        }
      } else {
        d = m;
        e = m;
      }
      aa = b;
      fa = fb;
      b += Math.abs(d) > tol ? d : m > 0 ? tol : -tol;
      fb = f(b);
    }
    return [num(b), num(fb), num(1)].slice(0, Math.max(1, nargout));
  });
  def(I, 'optimset', (a) => {
    const entries: [string, Value][] = [];
    for (let i = 0; i + 1 < a.length; i += 2) entries.push([toStringValue(a[i]), a[i + 1]]);
    return StructArray.scalar(entries);
  });
  def(I, 'optimoptions', (a) => {
    const entries: [string, Value][] = [];
    for (let i = 1; i + 1 < a.length; i += 2) entries.push([toStringValue(a[i]), a[i + 1]]);
    return StructArray.scalar(entries);
  });
  def(I, ['fminsearch', 'fminunc'], (a, nargout, ctx) => {
    minArgs(a, 2);
    const x0 = argT(a, 1);
    const call = ctx.interp.makeCallable(a[0], ctx.scope);
    const f = (x: number[]) => toNumber(call([shapeLike(x0, x)])[0]);
    const opts = a[2];
    const n = x0.numel;
    const r = nelderMead(f, vec(x0), {
      tolX: getOpt(opts, 'TolX', getOpt(opts, 'StepTolerance', 1e-4)),
      tolF: getOpt(opts, 'TolFun', getOpt(opts, 'FunctionTolerance', 1e-4)),
      maxIter: getOpt(opts, 'MaxIter', getOpt(opts, 'MaxIterations', 200 * n)),
      maxFun: getOpt(opts, 'MaxFunEvals', getOpt(opts, 'MaxFunctionEvaluations', 200 * n)),
    });
    const output = StructArray.scalar([['iterations', num(r.iter)], ['funcCount', num(r.funcCount)], ['algorithm', str('Nelder-Mead simplex direct search')]]);
    return [shapeLike(x0, r.x), num(r.fval), num(r.exitflag), output].slice(0, Math.max(1, nargout));
  });
  def(I, 'fminbnd', (a, nargout, ctx) => {
    const f = scalarFn(ctx, a[0]);
    const r = brentMin(f, toNumber(a[1]), toNumber(a[2]), getOpt(a[3], 'TolX', 1e-4));
    return [num(r.x), num(r.fval), num(1)].slice(0, Math.max(1, nargout));
  });
  def(I, ['fsolve', 'lsqnonlin'], (a, nargout, ctx) => {
    const x0 = argT(a, 1);
    const call = ctx.interp.makeCallable(a[0], ctx.scope);
    const F = (p: number[]) => vec(toTensor(call([shapeLike(x0, p)])[0]));
    const r = levenbergMarquardt(F, vec(x0));
    const fval = ctx.name === 'fsolve' ? new Tensor(r.r.length, 1, Float64Array.from(r.r)) : num(r.ss);
    return [shapeLike(x0, r.p), fval, num(r.converged ? 1 : 0)].slice(0, Math.max(1, nargout));
  });
  def(I, 'lsqcurvefit', (a, nargout, ctx) => {
    const x0 = argT(a, 1), xdata = a[2], ydata = vec(argT(a, 3));
    const call = ctx.interp.makeCallable(a[0], ctx.scope);
    const F = (p: number[]) => {
      const v = vec(toTensor(call([shapeLike(x0, p), xdata])[0]));
      return v.map((y, i) => y - ydata[i]);
    };
    const r = levenbergMarquardt(F, vec(x0));
    return [shapeLike(x0, r.p), num(r.ss), colVec(r.r), num(r.converged ? 1 : 0)].slice(0, Math.max(1, nargout));
  });
  def(I, 'lsqlin_internal', () => num(0));
  def(I, 'odeset', (a) => {
    const entries: [string, Value][] = [];
    for (let i = 0; i + 1 < a.length; i += 2) entries.push([toStringValue(a[i]), a[i + 1]]);
    return StructArray.scalar(entries);
  });
  for (const [name, order] of [['ode45', 45], ['ode23', 23], ['ode113', 45], ['ode15s', 45], ['ode23s', 23], ['ode78', 45], ['ode89', 45]] as const) {
    def(I, name, (a, nargout, ctx) => {
      minArgs(a, 3);
      const tspan = vec(argT(a, 1));
      const y0 = vec(argT(a, 2));
      const r = odeSolve(ctx, a[0], tspan, y0, a[3], order);
      const T = colVec(r.t);
      const Y = zeros(r.t.length, y0.length);
      r.y.forEach((row, i) => row.forEach((v, j) => (Y.re[j * r.t.length + i] = v)));
      if (nargout <= 1 && nargout !== 0 && false) return [];
      if (nargout === 1) {
        const sol = StructArray.scalar([['x', rowVec(r.t)], ['y', transposeT(Y)], ['solver', str(name)]]);
        return [sol];
      }
      return [T, Y];
    });
  }
  def(I, 'deval', (a) => {
    const sol = a[0];
    if (sol.kind !== 'struct') throw new MError('deval requires a solution structure.');
    const xs = vec(toTensor(sol.getField('x')));
    const Y = toTensor(sol.getField('y'));
    const xi = vec(argT(a, 1));
    const out = zeros(Y.rows, xi.length);
    for (let r = 0; r < Y.rows; r++) {
      const row = Array.from({ length: Y.cols }, (_, j) => Y.re[j * Y.rows + r]);
      const v = interp1(xs, row, xi, 'pchip', 'extrap');
      v.forEach((val, j) => (out.re[j * Y.rows + r] = val));
    }
    return out;
  });
  def(I, ['fft', 'ifft'], (a, _n, ctx) => {
    const t = argT(a, 0);
    const inverse = ctx.name === 'ifft';
    const nArg = a.length > 1 && a[1].numel ? toNumber(a[1]) : undefined;
    const doCol = (re: number[], im: number[]) => {
      const n = nArg ?? re.length;
      const r = re.slice(0, n), i = im.slice(0, n);
      while (r.length < n) {
        r.push(0);
        i.push(0);
      }
      return fftComplex(r, i, inverse);
    };
    const symmetric = a.some((x) => isStringLike(x) && toStringValue(x) === 'symmetric');
    if (t.rows === 1 || t.cols === 1) {
      const [r, i] = doCol(vec(t), t.im ? Array.from(t.im) : new Array(t.numel).fill(0));
      const n = r.length;
      const out = new Tensor(t.rows === 1 ? 1 : n, t.rows === 1 ? n : 1, Float64Array.from(r), symmetric ? null : Float64Array.from(i));
      return out.simplify();
    }
    const n = nArg ?? t.rows;
    const out = new Tensor(n, t.cols, new Float64Array(n * t.cols), new Float64Array(n * t.cols));
    for (let j = 0; j < t.cols; j++) {
      const [r, i] = doCol(Array.from(t.re.subarray(j * t.rows, (j + 1) * t.rows)), t.im ? Array.from(t.im.subarray(j * t.rows, (j + 1) * t.rows)) : new Array(t.rows).fill(0));
      out.re.set(r, j * n);
      out.im!.set(i, j * n);
    }
    return out.simplify();
  });
  def(I, ['fftshift', 'ifftshift'], (a, _n, ctx) => {
    const t = argT(a, 0);
    const n = t.numel;
    const k = ctx.name === 'fftshift' ? Math.floor(n / 2) : Math.ceil(n / 2);
    const out = new Tensor(t.rows, t.cols, new Float64Array(n), t.im ? new Float64Array(n) : null);
    for (let i = 0; i < n; i++) {
      out.re[(i + k) % n] = t.re[i];
      if (t.im) out.im![(i + k) % n] = t.im[i];
    }
    return out;
  });
  def(I, 'filter', (a) => {
    const b = vec(argT(a, 0)), aa = vec(argT(a, 1)), xT = argT(a, 2);
    const x = vec(xT);
    const a0 = aa[0];
    const bn = b.map((v) => v / a0), an = aa.map((v) => v / a0);
    const n = Math.max(bn.length, an.length);
    while (bn.length < n) bn.push(0);
    while (an.length < n) an.push(0);
    const z = new Array(n).fill(0);
    const y = x.map((xv) => {
      const yv = bn[0] * xv + z[0];
      for (let k = 1; k < n; k++) z[k - 1] = bn[k] * xv + z[k] - an[k] * yv;
      return yv;
    });
    return new Tensor(xT.rows, xT.cols, Float64Array.from(y));
  });
  def(I, 'trapz_internal', () => num(0));
}

function transposeT(t: Tensor): Tensor {
  const out = zeros(t.cols, t.rows);
  for (let i = 0; i < t.rows; i++) for (let j = 0; j < t.cols; j++) out.re[i * t.cols + j] = t.re[j * t.rows + i];
  return out;
}
