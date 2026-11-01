import { Matrix, EigenvalueDecomposition, SingularValueDecomposition, QrDecomposition, CholeskyDecomposition } from 'ml-matrix';
import { MError, Tensor, num, toNumber, toStringValue, isStringLike, zeros, colVec, rowVec, type Value } from '../value';
import type { Interpreter } from '../interp';
import { argT, def, minArgs } from './helpers';
import { det, inv, luDecompose, mldivide, mtimes } from '../ops';

export function toML(t: Tensor): Matrix {
  if (t.im) throw new MError('Complex matrices are not supported by this function.');
  const rows: number[][] = [];
  for (let i = 0; i < t.rows; i++) {
    const r: number[] = [];
    for (let j = 0; j < t.cols; j++) r.push(t.re[j * t.rows + i]);
    rows.push(r);
  }
  return new Matrix(rows);
}

export function fromML(m: Matrix): Tensor {
  const out = zeros(m.rows, m.columns);
  for (let i = 0; i < m.rows; i++) for (let j = 0; j < m.columns; j++) out.re[j * m.rows + i] = m.get(i, j);
  return out;
}

function isSymmetric(t: Tensor): boolean {
  if (t.rows !== t.cols) return false;
  let scale = 0;
  for (let i = 0; i < t.numel; i++) scale = Math.max(scale, Math.abs(t.re[i]));
  for (let i = 0; i < t.rows; i++) for (let j = i + 1; j < t.cols; j++) if (Math.abs(t.re[j * t.rows + i] - t.re[i * t.rows + j]) > 1e-12 * Math.max(1, scale)) return false;
  return true;
}

function svdValues(t: Tensor): number[] {
  if (t.numel === 0) return [];
  const s = new SingularValueDecomposition(toML(t), { computeLeftSingularVectors: false, computeRightSingularVectors: false, autoTranspose: true });
  return [...s.diagonal].sort((a, b) => b - a);
}

export function registerLinalg(I: Interpreter) {
  def(I, 'inv', (a) => {
    const t = argT(a, 0, 'inv');
    if (t.rows !== t.cols) throw new MError('Matrix must be square.', 'MATLAB:square');
    const r = inv(t);
    const c = cond(t);
    if (c > 1e15 && Number.isFinite(r.re[0])) I.warn(`Matrix is close to singular or badly scaled. Results may be inaccurate. RCOND = ${(1 / c).toExponential(6)}.`);
    return r;
  });
  def(I, 'det', (a) => num(det(argT(a, 0, 'det'))));
  def(I, 'trace', (a) => {
    const t = argT(a, 0);
    let s = 0;
    for (let i = 0; i < Math.min(t.rows, t.cols); i++) s += t.re[i * t.rows + i];
    return num(s);
  });
  def(I, 'rank', (a) => {
    const t = argT(a, 0);
    const s = svdValues(t);
    const tol = a.length > 1 ? toNumber(a[1]) : Math.max(t.rows, t.cols) * (s[0] ?? 0) * Number.EPSILON;
    return num(s.filter((v) => v > tol).length);
  });
  def(I, 'norm', (a) => {
    const t = argT(a, 0, 'norm');
    const p = a.length > 1 ? (isStringLike(a[1]) ? toStringValue(a[1]) : toNumber(a[1])) : 2;
    const absv = (i: number) => (t.im ? Math.hypot(t.re[i], t.im[i]) : Math.abs(t.re[i]));
    if (t.rows === 1 || t.cols === 1) {
      const v = Array.from({ length: t.numel }, (_, i) => absv(i));
      if (p === Infinity || p === 'inf' || p === 'Inf') return num(Math.max(...v));
      if (p === -Infinity) return num(Math.min(...v));
      if (p === 'fro') return num(Math.sqrt(v.reduce((s, x) => s + x * x, 0)));
      const pp = Number(p);
      if (pp === 1) return num(v.reduce((s, x) => s + x, 0));
      return num(Math.pow(v.reduce((s, x) => s + Math.pow(x, pp), 0), 1 / pp));
    }
    if (p === 'fro') {
      let s = 0;
      for (let i = 0; i < t.numel; i++) s += absv(i) ** 2;
      return num(Math.sqrt(s));
    }
    if (p === 1) {
      let m = 0;
      for (let j = 0; j < t.cols; j++) {
        let s = 0;
        for (let i = 0; i < t.rows; i++) s += absv(j * t.rows + i);
        m = Math.max(m, s);
      }
      return num(m);
    }
    if (p === Infinity || p === 'inf') {
      let m = 0;
      for (let i = 0; i < t.rows; i++) {
        let s = 0;
        for (let j = 0; j < t.cols; j++) s += absv(j * t.rows + i);
        m = Math.max(m, s);
      }
      return num(m);
    }
    return num(svdValues(t)[0] ?? 0);
  });
  def(I, 'cond', (a) => num(cond(argT(a, 0))));
  def(I, 'rcond', (a) => num(1 / cond(argT(a, 0), 1)));
  def(I, 'pinv', (a) => {
    const t = argT(a, 0);
    const s = new SingularValueDecomposition(toML(t), { autoTranspose: true });
    const U = s.leftSingularVectors, V = s.rightSingularVectors, d = s.diagonal;
    const tol = a.length > 1 ? toNumber(a[1]) : Math.max(t.rows, t.cols) * Math.max(...d) * Number.EPSILON;
    const Sinv = Matrix.zeros(V.columns, U.columns);
    d.forEach((v, i) => {
      if (v > tol) Sinv.set(i, i, 1 / v);
    });
    return fromML(V.mmul(Sinv).mmul(U.transpose()));
  });
  def(I, 'svd', (a, nargout) => {
    const t = argT(a, 0, 'svd');
    const econ = a.length > 1;
    if (nargout <= 1) return colVec(svdValues(t));
    const m = t.rows, n = t.cols;
    const s = new SingularValueDecomposition(toML(t), { autoTranspose: true });
    let U = s.leftSingularVectors, V = s.rightSingularVectors;
    const d = s.diagonal;
    const k = Math.min(m, n);
    // full U (m×m) when not economy: complete the basis via QR
    if (!econ && U.columns < m) U = completeBasis(U, m);
    if (V.columns < n) V = completeBasis(V, n);
    const S = econ ? Matrix.zeros(k, k) : Matrix.zeros(m, n);
    for (let i = 0; i < k; i++) S.set(i, i, d[i]);
    return [fromML(econ ? U.subMatrix(0, m - 1, 0, k - 1) : U), fromML(S), fromML(econ ? V.subMatrix(0, n - 1, 0, k - 1) : V)];
  });
  def(I, 'eig', (a, nargout) => {
    const t = argT(a, 0, 'eig');
    if (t.rows !== t.cols) throw new MError('Matrix must be square.', 'MATLAB:square');
    if (a.length > 1 && !isStringLike(a[1])) {
      // generalized eigenproblem: solve B\A
      const B = argT(a, 1);
      return eigOf(mldivide(B, t), nargout);
    }
    return eigOf(t, nargout);
  });
  def(I, 'lu', (a, nargout) => {
    const t = argT(a, 0, 'lu');
    const n = t.rows;
    if (t.rows !== t.cols) throw new MError('lu currently supports square matrices only.');
    const f = luDecompose(t);
    const L = zeros(n, n), U = zeros(n, n), P = zeros(n, n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const v = f.lu[j * n + i];
      if (i > j) L.re[j * n + i] = v;
      else U.re[j * n + i] = v;
      if (i === j) L.re[j * n + i] = 1;
    }
    f.piv.forEach((p, i) => (P.re[p * n + i] = 1));
    if (nargout <= 2) {
      // L is permuted so that A = L*U
      const PtL = mtimes(transposeT(P), L);
      return nargout <= 1 ? [U] : [PtL, U];
    }
    return [L, U, P];
  });
  def(I, 'qr', (a, nargout) => {
    const t = argT(a, 0, 'qr');
    const q = new QrDecomposition(toML(t));
    let Q = q.orthogonalMatrix, R = q.upperTriangularMatrix;
    const econ = a.length > 1;
    if (!econ && Q.columns < t.rows) {
      Q = completeBasis(Q, t.rows);
      const R2 = Matrix.zeros(t.rows, t.cols);
      for (let i = 0; i < R.rows; i++) for (let j = 0; j < R.columns; j++) R2.set(i, j, R.get(i, j));
      R = R2;
    }
    if (nargout <= 1) return fromML(R);
    return [fromML(Q), fromML(R)];
  });
  def(I, 'chol', (a, nargout) => {
    const t = argT(a, 0, 'chol');
    const c = new CholeskyDecomposition(toML(t));
    if (!c.isPositiveDefinite()) {
      if (nargout > 1) return [zeros(0, 0), num(1)];
      throw new MError('Matrix must be positive definite.', 'MATLAB:posdef');
    }
    const L = c.lowerTriangularMatrix;
    const lower = a.length > 1 && toStringValue(a[1]) === 'lower';
    const R = fromML(lower ? L : L.transpose());
    return nargout > 1 ? [R, num(0)] : [R];
  });
  def(I, 'null', (a) => {
    const t = argT(a, 0);
    const s = new SingularValueDecomposition(toML(t), { autoTranspose: false });
    const V = completeBasis(s.rightSingularVectors, t.cols);
    const d = s.diagonal;
    const tol = Math.max(t.rows, t.cols) * (Math.max(...d, 0)) * Number.EPSILON;
    const r = d.filter((v) => v > tol).length;
    if (r >= t.cols) return zeros(t.cols, 0);
    return fromML(V.subMatrix(0, t.cols - 1, r, t.cols - 1));
  });
  def(I, 'orth', (a) => {
    const t = argT(a, 0);
    const s = new SingularValueDecomposition(toML(t), { autoTranspose: true });
    const d = s.diagonal;
    const tol = Math.max(t.rows, t.cols) * Math.max(...d) * Number.EPSILON;
    const r = d.filter((v) => v > tol).length;
    return fromML(s.leftSingularVectors.subMatrix(0, t.rows - 1, 0, r - 1));
  });
  def(I, 'expm', (a) => {
    const t = argT(a, 0, 'expm');
    // scaling and squaring with Padé(6)
    const n = t.rows;
    let A = toML(t);
    const nrm = Math.max(...Array.from({ length: n }, (_, i) => A.getRow(i).reduce((s, v) => s + Math.abs(v), 0)));
    const sPow = Math.max(0, Math.ceil(Math.log2(nrm || 1)) + 1);
    A = A.mul(1 / Math.pow(2, sPow));
    const c = [1, 0.5, 0.11363636363636363, 0.015151515151515152, 0.0012626262626262627, 6.313131313131313e-5, 1.5031265031265032e-6];
    let X = Matrix.eye(n), N = Matrix.eye(n), D = Matrix.eye(n);
    for (let k = 1; k < c.length; k++) {
      X = A.mmul(X);
      N = N.add(X.clone().mul(c[k]));
      D = D.add(X.clone().mul(k % 2 ? -c[k] : c[k]));
    }
    let E = fromML(D);
    E = mldivide(E, fromML(N));
    for (let k = 0; k < sPow; k++) E = mtimes(E, E);
    return E;
  });
  def(I, 'linsolve', (a) => mldivide(argT(a, 0), argT(a, 1)));
  def(I, 'lsqminnorm', (a) => mldivide(argT(a, 0), argT(a, 1)));
  def(I, 'mldivide_internal', (a) => mldivide(argT(a, 0), argT(a, 1)));
  def(I, 'issymmetric', (a) => {
    const t = argT(a, 0);
    const out = zeros(1, 1, 'logical');
    out.re[0] = isSymmetric(t) ? 1 : 0;
    return out;
  });
  def(I, 'isdiag', (a) => {
    const t = argT(a, 0);
    const out = zeros(1, 1, 'logical');
    out.re[0] = Array.from(t.re).every((v, k) => v === 0 || k % t.rows === Math.floor(k / t.rows)) ? 1 : 0;
    return out;
  });
  def(I, 'vander', (a) => {
    const v = Array.from(argT(a, 0).re);
    const n = v.length;
    const out = zeros(n, n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.re[j * n + i] = Math.pow(v[i], n - 1 - j);
    return out;
  });
  def(I, 'hilb', (a) => {
    const n = toNumber(a[0]);
    const out = zeros(n, n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.re[j * n + i] = 1 / (i + j + 1);
    return out;
  });
  def(I, 'toeplitz', (a) => {
    const c = Array.from(argT(a, 0).re);
    const r = a.length > 1 ? Array.from(argT(a, 1).re) : c;
    const out = zeros(c.length, r.length);
    for (let i = 0; i < c.length; i++) for (let j = 0; j < r.length; j++) out.re[j * c.length + i] = i >= j ? c[i - j] : r[j - i];
    return out;
  });
  def(I, 'compan', (a) => {
    const p = Array.from(argT(a, 0).re);
    const n = p.length - 1;
    const out = zeros(n, n);
    for (let j = 0; j < n; j++) out.re[j * n] = -p[j + 1] / p[0];
    for (let i = 1; i < n; i++) out.re[(i - 1) * n + i] = 1;
    return out;
  });
  void minArgs;
  void rowVec;
}

function transposeT(t: Tensor): Tensor {
  const out = zeros(t.cols, t.rows);
  for (let i = 0; i < t.rows; i++) for (let j = 0; j < t.cols; j++) out.re[i * t.cols + j] = t.re[j * t.rows + i];
  return out;
}

function cond(t: Tensor, _p = 2): number {
  const s = svdValues(t);
  if (!s.length) return 0;
  const mn = s[s.length - 1];
  return mn === 0 ? Infinity : s[0] / mn;
}

/** Extend orthonormal columns to a full orthonormal basis of R^n (Gram-Schmidt on unit vectors). */
function completeBasis(Q: Matrix, n: number): Matrix {
  const cols: number[][] = [];
  for (let j = 0; j < Q.columns; j++) cols.push(Q.getColumn(j));
  for (let e = 0; e < n && cols.length < n; e++) {
    const v = new Array(n).fill(0);
    v[e] = 1;
    for (const c of cols) {
      const d = c.reduce((s, x, i) => s + x * v[i], 0);
      for (let i = 0; i < n; i++) v[i] -= d * c[i];
    }
    const nr = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    if (nr > 1e-10) cols.push(v.map((x) => x / nr));
  }
  const M = Matrix.zeros(n, cols.length);
  cols.forEach((c, j) => c.forEach((x, i) => M.set(i, j, x)));
  return M;
}

function eigOf(t: Tensor, nargout: number): Value[] {
  const n = t.rows;
  const sym = isSymmetric(t);
  const e = new EigenvalueDecomposition(toML(t), { assumeSymmetric: sym });
  const re = e.realEigenvalues, im = e.imaginaryEigenvalues;
  const isComplex = im.some((v) => Math.abs(v) > 1e-14 * Math.max(1, Math.abs(Math.max(...re.map(Math.abs)))));
  if (nargout <= 1) {
    const out = new Tensor(n, 1, Float64Array.from(re), isComplex ? Float64Array.from(im) : null);
    return [out];
  }
  const Vm = e.eigenvectorMatrix;
  const V = new Tensor(n, n, new Float64Array(n * n), isComplex ? new Float64Array(n * n) : null);
  for (let j = 0; j < n; j++) {
    if (isComplex && im[j] !== 0) {
      if (im[j] > 0 && j + 1 < n) {
        let nrm = 0;
        for (let i = 0; i < n; i++) nrm += Vm.get(i, j) ** 2 + Vm.get(i, j + 1) ** 2;
        nrm = Math.sqrt(nrm);
        for (let i = 0; i < n; i++) {
          V.re[j * n + i] = Vm.get(i, j) / nrm;
          V.im![j * n + i] = Vm.get(i, j + 1) / nrm;
          V.re[(j + 1) * n + i] = Vm.get(i, j) / nrm;
          V.im![(j + 1) * n + i] = -Vm.get(i, j + 1) / nrm;
        }
        j++;
      }
      continue;
    }
    let nrm = 0;
    for (let i = 0; i < n; i++) nrm += Vm.get(i, j) ** 2;
    nrm = Math.sqrt(nrm) || 1;
    // sign convention: make the largest component positive for symmetric matrices only if negative-dominant
    for (let i = 0; i < n; i++) V.re[j * n + i] = Vm.get(i, j) / nrm;
  }
  const D = new Tensor(n, n, new Float64Array(n * n), isComplex ? new Float64Array(n * n) : null);
  for (let i = 0; i < n; i++) {
    D.re[i * n + i] = re[i];
    if (isComplex) D.im![i * n + i] = im[i];
  }
  return [V, D];
}
