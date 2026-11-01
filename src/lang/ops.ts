import { CellArray, MError, Tensor, isIntClass, saturate, toTensor, zeros, type NumClass, type Value, StringArray } from './value';

function resultClass(a: Tensor, b: Tensor, op: string): NumClass {
  const ia = isIntClass(a.cls), ib = isIntClass(b.cls);
  if (ia && ib && a.cls !== b.cls) throw new MError(`Integers can only be combined with integers of the same class, or scalar doubles.`);
  if (ia) return a.cls;
  if (ib) return b.cls;
  if (a.cls === 'single' || b.cls === 'single') return 'single';
  void op;
  return 'double';
}

function bdims(a: Tensor, b: Tensor, op: string): [number, number] {
  const r = a.rows === b.rows ? a.rows : a.rows === 1 ? b.rows : b.rows === 1 ? a.rows : -1;
  const c = a.cols === b.cols ? a.cols : a.cols === 1 ? b.cols : b.cols === 1 ? a.cols : -1;
  if (r < 0 || c < 0) {
    if (op === '+' || op === '-' || op === '.*' || op === './') throw new MError('Arrays have incompatible sizes for this operation.', 'MATLAB:sizeDimensionsMustMatch');
    throw new MError(`Matrix dimensions must agree.`, 'MATLAB:dimagree');
  }
  return [r, c];
}

type RealFn = (x: number, y: number) => number;

/** Elementwise binary op with implicit expansion (real path). */
export function ewise(a: Tensor, b: Tensor, f: RealFn, op: string, outCls?: NumClass): Tensor {
  const [r, c] = bdims(a, b, op);
  const out = zeros(r, c, outCls ?? resultClass(a, b, op));
  const n = r * c;
  const are = a.re, bre = b.re, o = out.re;
  if (a.rows === r && a.cols === c && b.rows === r && b.cols === c) for (let i = 0; i < n; i++) o[i] = f(are[i], bre[i]);
  else if (a.numel === 1) {
    const x = are[0];
    if (b.numel === n) for (let i = 0; i < n; i++) o[i] = f(x, bre[i]);
    else for (let j = 0; j < c; j++) for (let i = 0; i < r; i++) o[j * r + i] = f(x, bre[(b.cols === 1 ? 0 : j) * b.rows + (b.rows === 1 ? 0 : i)]);
  } else if (b.numel === 1) {
    const y = bre[0];
    if (a.numel === n) for (let i = 0; i < n; i++) o[i] = f(are[i], y);
    else for (let j = 0; j < c; j++) for (let i = 0; i < r; i++) o[j * r + i] = f(are[(a.cols === 1 ? 0 : j) * a.rows + (a.rows === 1 ? 0 : i)], y);
  } else {
    for (let j = 0; j < c; j++)
      for (let i = 0; i < r; i++) {
        const ai = (a.cols === 1 ? 0 : j) * a.rows + (a.rows === 1 ? 0 : i);
        const bi = (b.cols === 1 ? 0 : j) * b.rows + (b.rows === 1 ? 0 : i);
        o[j * r + i] = f(are[ai], bre[bi]);
      }
  }
  if (isIntClass(out.cls)) for (let i = 0; i < n; i++) o[i] = saturate(o[i], out.cls);
  else if (out.cls === 'single') for (let i = 0; i < n; i++) o[i] = Math.fround(o[i]);
  return out;
}

/** Elementwise complex op. f returns [re, im]. */
function ewiseC(a: Tensor, b: Tensor, f: (ar: number, ai: number, br: number, bi: number) => [number, number], op: string): Tensor {
  const [r, c] = bdims(a, b, op);
  const out = new Tensor(r, c, new Float64Array(r * c), new Float64Array(r * c), resultClass(a, b, op));
  const ai = a.im ?? new Float64Array(a.numel), bi = b.im ?? new Float64Array(b.numel);
  for (let j = 0; j < c; j++)
    for (let i = 0; i < r; i++) {
      const ia = (a.cols === 1 ? 0 : j) * a.rows + (a.rows === 1 ? 0 : i);
      const ib = (b.cols === 1 ? 0 : j) * b.rows + (b.rows === 1 ? 0 : i);
      const [x, y] = f(a.re[ia], ai[ia], b.re[ib], bi[ib]);
      out.re[j * r + i] = x;
      out.im![j * r + i] = y;
    }
  return out.simplify();
}

function cmul(ar: number, ai: number, br: number, bi: number): [number, number] {
  return [ar * br - ai * bi, ar * bi + ai * br];
}
function cdiv(ar: number, ai: number, br: number, bi: number): [number, number] {
  if (bi === 0) return [ar / br, ai / br];
  const d = br * br + bi * bi;
  return [(ar * br + ai * bi) / d, (ai * br - ar * bi) / d];
}
export function cpow(ar: number, ai: number, br: number, bi: number): [number, number] {
  if (ar === 0 && ai === 0) {
    if (br === 0 && bi === 0) return [1, 0];
    return br > 0 ? [0, 0] : [Infinity, 0];
  }
  if (ai === 0 && bi === 0 && Number.isInteger(br)) return [Math.pow(ar, br), 0];
  const logr = Math.log(Math.hypot(ar, ai)), th = Math.atan2(ai, ar);
  const er = br * logr - bi * th, ei = bi * logr + br * th;
  const m = Math.exp(er);
  return [m * Math.cos(ei), m * Math.sin(ei)];
}

function needsComplexPow(a: Tensor, b: Tensor): boolean {
  if (a.im || b.im) return true;
  let anyNeg = false;
  for (let i = 0; i < a.numel; i++) if (a.re[i] < 0) {
    anyNeg = true;
    break;
  }
  if (!anyNeg) return false;
  for (let i = 0; i < b.numel; i++) if (!Number.isInteger(b.re[i])) return true;
  return false;
}

export function binaryOp(op: string, av: Value, bv: Value): Value {
  if (av.kind === 'string' || bv.kind === 'string') return stringOp(op, av, bv);
  if (av.kind === 'cell' || bv.kind === 'cell') throw new MError(`Operator '${op}' is not supported for operands of type 'cell'.`, 'MATLAB:UndefinedFunction');
  const a = toTensor(av, op), b = toTensor(bv, op);
  switch (op) {
    case '+':
      if (a.im || b.im) return ewiseC(a, b, (w, x, y, z) => [w + y, x + z], op);
      return ewise(a, b, (x, y) => x + y, op);
    case '-':
      if (a.im || b.im) return ewiseC(a, b, (w, x, y, z) => [w - y, x - z], op);
      return ewise(a, b, (x, y) => x - y, op);
    case '.*':
      if (a.im || b.im) return ewiseC(a, b, cmul, op);
      return ewise(a, b, (x, y) => x * y, op);
    case './':
      if (a.im || b.im) return ewiseC(a, b, cdiv, op);
      return ewise(a, b, (x, y) => x / y, op);
    case '.\\':
      if (a.im || b.im) return ewiseC(b, a, cdiv, op);
      return ewise(a, b, (x, y) => y / x, op);
    case '.^':
      if (needsComplexPow(a, b)) return ewiseC(a, b, cpow, op);
      return ewise(a, b, Math.pow, op);
    case '*':
      return mtimes(a, b);
    case '/':
      if (b.numel === 1) return binaryOp('./', a, b);
      return transpose(mldivide(transpose(b, true) as Tensor, transpose(a, true) as Tensor), true);
    case '\\':
      if (a.numel === 1) return binaryOp('.\\', a, b);
      return mldivide(a, b);
    case '^':
      return mpower(a, b);
    case '==':
      if (a.im || b.im) return ewiseC(a, b, (w, x, y, z) => [w === y && x === z ? 1 : 0, 0], op).withClass('logical');
      return ewise(a, b, (x, y) => (x === y ? 1 : 0), op, 'logical');
    case '~=':
      if (a.im || b.im) return ewiseC(a, b, (w, x, y, z) => [w !== y || x !== z ? 1 : 0, 0], op).withClass('logical');
      return ewise(a, b, (x, y) => (x !== y ? 1 : 0), op, 'logical');
    case '<': return ewise(a, b, (x, y) => (x < y ? 1 : 0), op, 'logical');
    case '<=': return ewise(a, b, (x, y) => (x <= y ? 1 : 0), op, 'logical');
    case '>': return ewise(a, b, (x, y) => (x > y ? 1 : 0), op, 'logical');
    case '>=': return ewise(a, b, (x, y) => (x >= y ? 1 : 0), op, 'logical');
    case '&': return ewise(a, b, (x, y) => (nanCheck(x) && nanCheck(y) ? 1 : 0), op, 'logical');
    case '|': return ewise(a, b, (x, y) => (nanCheck(x) || nanCheck(y) ? 1 : 0), op, 'logical');
  }
  throw new MError(`Unknown operator ${op}`);
}

function nanCheck(x: number): boolean {
  if (Number.isNaN(x)) throw new MError("NaN's cannot be converted to logicals.");
  return x !== 0;
}

function stringOp(op: string, av: Value, bv: Value): Value {
  const toS = (v: Value): string[] => {
    if (v.kind === 'string') return v.data;
    if (v.kind === 'tensor') {
      if (v.cls === 'char') return [v.toStr()];
      return Array.from(v.re).map((x) => String(Math.round(x * 1e4) / 1e4));
    }
    if (v.kind === 'cell') return v.data.map((x) => (x.kind === 'tensor' ? x.toStr() : x.kind === 'string' ? x.data[0] : ''));
    throw new MError(`Operator '${op}' is not supported for these operands.`);
  };
  const A = toS(av), B = toS(bv);
  const n = Math.max(A.length, B.length);
  if (A.length !== 1 && B.length !== 1 && A.length !== B.length) throw new MError('Arrays have incompatible sizes for this operation.');
  const g = (arr: string[], i: number) => arr[arr.length === 1 ? 0 : i];
  const shapeSrc = A.length >= B.length ? av : bv;
  if (op === '+') {
    const data = Array.from({ length: n }, (_, i) => g(A, i) + g(B, i));
    return new StringArray(shapeSrc.rows || 1, shapeSrc.cols || n, data);
  }
  const cmp: Record<string, (x: string, y: string) => boolean> = {
    '==': (x, y) => x === y, '~=': (x, y) => x !== y, '<': (x, y) => x < y, '>': (x, y) => x > y, '<=': (x, y) => x <= y, '>=': (x, y) => x >= y,
  };
  if (cmp[op]) {
    const t = zeros(shapeSrc.rows || 1, shapeSrc.cols || n, 'logical');
    for (let i = 0; i < n; i++) t.re[i] = cmp[op](g(A, i), g(B, i)) ? 1 : 0;
    return t;
  }
  throw new MError(`Operator '${op}' is not supported for operands of type 'string'.`);
}

export function mtimes(a: Tensor, b: Tensor): Tensor {
  if (a.numel === 1 || b.numel === 1) return binaryOp('.*', a, b) as Tensor;
  if (a.cols !== b.rows) throw new MError('Incorrect dimensions for matrix multiplication. Check that the number of columns in the first matrix matches the number of rows in the second matrix. To operate on each element of the matrix individually, use TIMES (.*) for elementwise multiplication.', 'MATLAB:innerdim');
  const r = a.rows, k = a.cols, c = b.cols;
  const out = zeros(r, c, resultClass(a, b, '*'));
  const are = a.re, bre = b.re, o = out.re;
  for (let j = 0; j < c; j++)
    for (let p = 0; p < k; p++) {
      const bv = bre[j * k + p];
      if (bv === 0) continue;
      const off = p * r;
      for (let i = 0; i < r; i++) o[j * r + i] += are[off + i] * bv;
    }
  if (a.im || b.im) {
    const ai = a.im ?? new Float64Array(a.numel), bi = b.im ?? new Float64Array(b.numel);
    const oi = new Float64Array(r * c);
    for (let j = 0; j < c; j++)
      for (let p = 0; p < k; p++) {
        const br = bre[j * k + p], bim = bi[j * k + p];
        for (let i = 0; i < r; i++) {
          const ar = are[p * r + i], aim = ai[p * r + i];
          // real part: subtract ai*bi (ar*br already added above)
          o[j * r + i] -= aim * bim;
          oi[j * r + i] += ar * bim + aim * br;
        }
      }
    out.im = oi;
    out.simplify();
  }
  return out;
}

export function transpose(v: Value, conj = true): Value {
  if (v.kind === 'cell') {
    const out = new CellArray(v.cols, v.rows, new Array(v.numel));
    for (let i = 0; i < v.rows; i++) for (let j = 0; j < v.cols; j++) out.data[i * v.cols + j] = v.data[j * v.rows + i];
    return out;
  }
  if (v.kind === 'string') {
    const out = new StringArray(v.cols, v.rows, new Array(v.numel));
    for (let i = 0; i < v.rows; i++) for (let j = 0; j < v.cols; j++) out.data[i * v.cols + j] = v.data[j * v.rows + i];
    return out;
  }
  if (v.kind === 'struct') {
    const s = v.clone();
    const out = new (s.constructor as any)(v.cols, v.rows, s.fields, new Array(v.numel));
    for (let i = 0; i < v.rows; i++) for (let j = 0; j < v.cols; j++) out.data[i * v.cols + j] = s.data[j * v.rows + i];
    return out;
  }
  const t = toTensor(v, 'transpose');
  const r = t.rows, c = t.cols;
  const out = new Tensor(c, r, new Float64Array(r * c), t.im ? new Float64Array(r * c) : null, t.cls);
  for (let i = 0; i < r; i++)
    for (let j = 0; j < c; j++) {
      out.re[i * c + j] = t.re[j * r + i];
      if (t.im) out.im![i * c + j] = conj ? -t.im[j * r + i] : t.im[j * r + i];
    }
  return out;
}

/** Solve A x = B. Square: LU with partial pivoting; otherwise least squares via Householder QR. */
export function mldivide(A: Tensor, B: Tensor): Tensor {
  if (A.im || B.im) throw new MError('Complex linear systems are not supported.');
  if (A.rows !== B.rows) throw new MError('Matrix dimensions must agree.', 'MATLAB:dimagree');
  const n = A.rows, m = A.cols, nb = B.cols;
  if (n === m) {
    const lu = luDecompose(A);
    if (!lu.singular) return luSolve(lu, B);
    warnings.push('Warning: Matrix is singular to working precision.');
    const out = zeros(m, nb);
    out.re.fill(Infinity);
    return out;
  }
  return lstsq(A, B);
}

export const warnings: string[] = [];

export interface LU {
  n: number;
  lu: Float64Array;
  piv: number[];
  sign: number;
  singular: boolean;
}

export function luDecompose(A: Tensor): LU {
  const n = A.rows;
  const lu = new Float64Array(A.re);
  const piv = Array.from({ length: n }, (_, i) => i);
  let sign = 1;
  let singular = false;
  let maxAbs = 0;
  for (let i = 0; i < lu.length; i++) maxAbs = Math.max(maxAbs, Math.abs(lu[i]));
  const tol = n * 2.220446049250313e-16 * maxAbs;
  for (let k = 0; k < n; k++) {
    let p = k, pv = Math.abs(lu[k * n + k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(lu[k * n + i]);
      if (v > pv) {
        pv = v;
        p = i;
      }
    }
    if (p !== k) {
      for (let j = 0; j < n; j++) {
        const t = lu[j * n + k];
        lu[j * n + k] = lu[j * n + p];
        lu[j * n + p] = t;
      }
      [piv[k], piv[p]] = [piv[p], piv[k]];
      sign = -sign;
    }
    const d = lu[k * n + k];
    if (Math.abs(d) <= tol) {
      singular = true;
      continue;
    }
    for (let i = k + 1; i < n; i++) {
      lu[k * n + i] /= d;
      const f = lu[k * n + i];
      if (f === 0) continue;
      for (let j = k + 1; j < n; j++) lu[j * n + i] -= f * lu[j * n + k];
    }
  }
  return { n, lu, piv, sign, singular };
}

export function luSolve(f: LU, B: Tensor): Tensor {
  const n = f.n, nb = B.cols;
  const X = zeros(n, nb);
  for (let c = 0; c < nb; c++) {
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = B.re[c * n + f.piv[i]];
    for (let i = 0; i < n; i++) for (let k = 0; k < i; k++) y[i] -= f.lu[k * n + i] * y[k];
    for (let i = n - 1; i >= 0; i--) {
      for (let k = i + 1; k < n; k++) y[i] -= f.lu[k * n + i] * y[k];
      y[i] /= f.lu[i * n + i];
    }
    X.re.set(y, c * n);
  }
  return X;
}

export function lstsq(A: Tensor, B: Tensor): Tensor {
  // Householder QR with column pivoting omitted (fine for well-conditioned problems)
  const m = A.rows, n = A.cols, nb = B.cols;
  const R = new Float64Array(A.re);
  const Q = new Float64Array(B.re);
  const k = Math.min(m, n);
  for (let j = 0; j < k; j++) {
    let norm = 0;
    for (let i = j; i < m; i++) norm += R[j * m + i] ** 2;
    norm = Math.sqrt(norm);
    if (norm === 0) continue;
    const alpha = R[j * m + j] > 0 ? -norm : norm;
    const v = new Float64Array(m);
    for (let i = j; i < m; i++) v[i] = R[j * m + i];
    v[j] -= alpha;
    let vn = 0;
    for (let i = j; i < m; i++) vn += v[i] * v[i];
    if (vn === 0) continue;
    for (let c = j; c < n; c++) {
      let s = 0;
      for (let i = j; i < m; i++) s += v[i] * R[c * m + i];
      s = (2 * s) / vn;
      for (let i = j; i < m; i++) R[c * m + i] -= s * v[i];
    }
    for (let c = 0; c < nb; c++) {
      let s = 0;
      for (let i = j; i < m; i++) s += v[i] * Q[c * m + i];
      s = (2 * s) / vn;
      for (let i = j; i < m; i++) Q[c * m + i] -= s * v[i];
    }
  }
  const X = zeros(n, nb);
  const rank = (() => {
    let r = 0;
    let maxd = 0;
    for (let j = 0; j < k; j++) maxd = Math.max(maxd, Math.abs(R[j * m + j]));
    for (let j = 0; j < k; j++) if (Math.abs(R[j * m + j]) > Math.max(m, n) * 2.2e-16 * maxd) r++;
    return r;
  })();
  if (rank < Math.min(m, n)) warnings.push(`Warning: Rank deficient, rank = ${rank}.`);
  for (let c = 0; c < nb; c++) {
    for (let i = Math.min(n, m) - 1; i >= 0; i--) {
      let s = Q[c * m + i];
      for (let j = i + 1; j < n; j++) s -= R[j * m + i] * X.re[c * n + j];
      const d = R[i * m + i];
      X.re[c * n + i] = d === 0 ? 0 : s / d;
    }
  }
  return X;
}

export function inv(A: Tensor): Tensor {
  if (A.rows !== A.cols) throw new MError('Matrix must be square.', 'MATLAB:square');
  const n = A.rows;
  const I = zeros(n, n);
  for (let i = 0; i < n; i++) I.re[i * n + i] = 1;
  const lu = luDecompose(A);
  if (lu.singular) {
    warnings.push('Warning: Matrix is singular to working precision.');
    const out = zeros(n, n);
    out.re.fill(Infinity);
    return out;
  }
  return luSolve(lu, I);
}

export function det(A: Tensor): number {
  if (A.rows !== A.cols) throw new MError('Matrix must be square.', 'MATLAB:square');
  if (A.rows === 0) return 1;
  const lu = luDecompose(A);
  let d = lu.sign;
  for (let i = 0; i < A.rows; i++) d *= lu.lu[i * A.rows + i];
  return d;
}

export function mpower(a: Tensor, b: Tensor): Tensor {
  if (a.numel === 1 && b.numel === 1) return binaryOp('.^', a, b) as Tensor;
  if (b.numel === 1 && a.rows === a.cols) {
    let p = b.re[0];
    if (!Number.isInteger(p)) throw new MError('Non-integer matrix powers are not supported.');
    let base = p < 0 ? inv(a) : a;
    p = Math.abs(p);
    let result = zeros(a.rows, a.cols);
    for (let i = 0; i < a.rows; i++) result.re[i * a.rows + i] = 1;
    while (p > 0) {
      if (p & 1) result = mtimes(result, base);
      base = mtimes(base, base);
      p >>= 1;
    }
    return result;
  }
  if (a.rows !== a.cols) throw new MError('Incorrect dimensions for raising a matrix to a power. Check that the matrix is square and the power is a scalar. To operate on each element of the matrix individually, use POWER (.^) for elementwise power.');
  throw new MError('Matrix exponent must be a scalar.');
}

export function unaryOp(op: string, v: Value): Value {
  if (op === '+') return v.kind === 'tensor' && (v.cls === 'char' || v.cls === 'logical') ? new Tensor(v.rows, v.cols, v.re, v.im, 'double') : v;
  const t = toTensor(v, op);
  if (op === '-') {
    const out = new Tensor(t.rows, t.cols, t.re.map((x) => -x), t.im ? t.im.map((x) => -x) : null, t.cls === 'logical' || t.cls === 'char' ? 'double' : t.cls);
    return out;
  }
  if (op === '~') {
    const out = zeros(t.rows, t.cols, 'logical');
    for (let i = 0; i < t.numel; i++) {
      if (Number.isNaN(t.re[i])) throw new MError("NaN's cannot be converted to logicals.");
      out.re[i] = t.re[i] === 0 && !(t.im && t.im[i] !== 0) ? 1 : 0;
    }
    return out;
  }
  throw new MError(`Unknown unary operator ${op}`);
}

export function colonRange(start: number, step: number, stop: number): Tensor {
  if (!Number.isFinite(start) || !Number.isFinite(stop) || !Number.isFinite(step)) {
    if (Number.isNaN(start) || Number.isNaN(stop) || Number.isNaN(step)) return new Tensor(1, 1, Float64Array.of(NaN));
    throw new MError('Maximum variable size allowed by the program is exceeded.');
  }
  if (step === 0 || (step > 0 && start > stop) || (step < 0 && start < stop)) return zeros(1, 0);
  const n = Math.floor((stop - start) / step + 1e-10) + 1;
  if (n > 2e8) throw new MError('Maximum variable size allowed by the program is exceeded.');
  const out = zeros(1, n);
  for (let i = 0; i < n; i++) out.re[i] = start + i * step;
  // Snap the last element to stop when within rounding error
  if (n > 1 && Math.abs(out.re[n - 1] - stop) < Math.abs(step) * 1e-10) out.re[n - 1] = stop;
  return out;
}
