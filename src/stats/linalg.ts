// Small dense linear-algebra helpers for the statistics engine (row-major number[][]).

export type Mat = number[][];

export function zerosM(r: number, c: number): Mat {
  return Array.from({ length: r }, () => new Array(c).fill(0));
}

export function transposeM(a: Mat): Mat {
  const r = a.length, c = a[0]?.length ?? 0;
  const out = zerosM(c, r);
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) out[j][i] = a[i][j];
  return out;
}

export function mulM(a: Mat, b: Mat): Mat {
  const r = a.length, k = b.length, c = b[0]?.length ?? 0;
  const out = zerosM(r, c);
  for (let i = 0; i < r; i++) {
    const ai = a[i], oi = out[i];
    for (let p = 0; p < k; p++) {
      const v = ai[p];
      if (v === 0) continue;
      const bp = b[p];
      for (let j = 0; j < c; j++) oi[j] += v * bp[j];
    }
  }
  return out;
}

export function mulMV(a: Mat, v: number[]): number[] {
  return a.map((row) => row.reduce((s, x, j) => s + x * v[j], 0));
}

/** Gauss-Jordan inverse with partial pivoting. Returns null if singular. */
export function invertM(aIn: Mat, tol = 1e-12): Mat | null {
  const n = aIn.length;
  const a = aIn.map((r) => [...r]);
  const inv = zerosM(n, n);
  for (let i = 0; i < n; i++) inv[i][i] = 1;
  let scale = 0;
  for (const r of a) for (const v of r) scale = Math.max(scale, Math.abs(v));
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
    if (Math.abs(a[piv][col]) <= tol * Math.max(1, scale)) return null;
    [a[col], a[piv]] = [a[piv], a[col]];
    [inv[col], inv[piv]] = [inv[piv], inv[col]];
    const d = a[col][col];
    for (let j = 0; j < n; j++) {
      a[col][j] /= d;
      inv[col][j] /= d;
    }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r][col];
      if (f === 0) continue;
      for (let j = 0; j < n; j++) {
        a[r][j] -= f * a[col][j];
        inv[r][j] -= f * inv[col][j];
      }
    }
  }
  return inv;
}

/** Symmetric eigen-decomposition by cyclic Jacobi rotations. Eigenvalues sorted descending. */
export function eigSym(aIn: Mat): { values: number[]; vectors: Mat } {
  const n = aIn.length;
  const a = aIn.map((r) => [...r]);
  const v = zerosM(n, n);
  for (let i = 0; i < n; i++) v[i][i] = 1;
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const values = a.map((r, i) => r[i]);
  const order = values.map((_, i) => i).sort((i, j) => values[j] - values[i]);
  return {
    values: order.map((i) => values[i]),
    vectors: v.map((row) => order.map((i) => row[i])),
  };
}

export interface OLSResult {
  beta: number[];
  se: number[];
  sse: number;
  dfResid: number;
  mse: number;
  fitted: number[];
  residuals: number[];
  covUnscaled: Mat | null;
  rankDeficient: boolean;
}

/** Ordinary least squares via normal equations. X rows are observations. */
export function ols(X: Mat, y: number[]): OLSResult {
  const n = X.length, p = X[0]?.length ?? 0;
  const Xt = transposeM(X);
  const XtX = mulM(Xt, X);
  const Xty = mulMV(Xt, y);
  const inv = invertM(XtX);
  if (!inv) {
    return { beta: new Array(p).fill(NaN), se: new Array(p).fill(NaN), sse: NaN, dfResid: n - p, mse: NaN, fitted: [], residuals: [], covUnscaled: null, rankDeficient: true };
  }
  const beta = mulMV(inv, Xty);
  const fitted = mulMV(X, beta);
  const residuals = y.map((v, i) => v - fitted[i]);
  const sse = residuals.reduce((s, r) => s + r * r, 0);
  const dfResid = n - p;
  const mse = sse / dfResid;
  const se = inv.map((r, i) => Math.sqrt(mse * r[i]));
  return { beta, se, sse, dfResid, mse, fitted, residuals, covUnscaled: inv, rankDeficient: false };
}

/** Residual sum of squares only (cheap path for model comparison). */
export function olsSSE(X: Mat, y: number[]): number {
  if (!X.length || !X[0].length) return y.reduce((s, v) => s + v * v, 0);
  return ols(X, y).sse;
}
