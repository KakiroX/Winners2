import { MError, Tensor, StringArray, isStringLike, toNumber, toStringValue, toTensor, zeros, num, type Value, type NumClass } from '../value';
import type { Interpreter, Builtin } from '../interp';

export function argNum(args: Value[], i: number, def?: number, name = 'argument'): number {
  if (i >= args.length) {
    if (def === undefined) throw new MError(`Not enough input arguments.`, 'MATLAB:minrhs');
    return def;
  }
  return toNumber(args[i], name);
}

export function argStr(args: Value[], i: number, def?: string): string {
  if (i >= args.length) {
    if (def === undefined) throw new MError('Not enough input arguments.', 'MATLAB:minrhs');
    return def;
  }
  return toStringValue(args[i]);
}

export function argT(args: Value[], i: number, fname = 'function'): Tensor {
  if (i >= args.length) throw new MError('Not enough input arguments.', 'MATLAB:minrhs');
  return toTensor(args[i], fname);
}

export function minArgs(args: Value[], n: number) {
  if (args.length < n) throw new MError('Not enough input arguments.', 'MATLAB:minrhs');
}

/** Parse dimension arguments like zeros(3), zeros(2,3), zeros([2 3]), with optional class name. */
export function dimsArgs(args: Value[]): { r: number; c: number; cls: NumClass; like?: Tensor } {
  let cls: NumClass = 'double';
  let like: Tensor | undefined;
  const a = [...args];
  for (let i = a.length - 1; i >= 0; i--) {
    if (isStringLike(a[i])) {
      const s = toStringValue(a[i]);
      if (s === 'like') {
        like = toTensor(a[i + 1]);
        cls = like.cls;
        a.splice(i, 2);
      } else {
        cls = s as NumClass;
        a.splice(i, 1);
      }
    }
  }
  if (a.length === 0) return { r: 1, c: 1, cls, like };
  if (a.length === 1) {
    const t = toTensor(a[0]);
    if (t.numel === 1) return { r: clampDim(t.re[0]), c: clampDim(t.re[0]), cls, like };
    if (t.numel >= 2) {
      for (let k = 2; k < t.numel; k++) if (t.re[k] !== 1) throw new MError('N-dimensional arrays are not supported; only 2-D arrays are available.');
      return { r: clampDim(t.re[0]), c: clampDim(t.re[1]), cls, like };
    }
    return { r: 0, c: 0, cls, like };
  }
  for (let k = 2; k < a.length; k++) if (toNumber(a[k]) !== 1) throw new MError('N-dimensional arrays are not supported; only 2-D arrays are available.');
  return { r: clampDim(toNumber(a[0])), c: clampDim(toNumber(a[1])), cls, like };
}

function clampDim(v: number) {
  if (Number.isNaN(v)) throw new MError('Size inputs must be integers.');
  return Math.max(0, Math.floor(v));
}

/** Map a real function elementwise; result double unless `keepClass`. */
export function mapReal(t: Tensor, f: (x: number) => number, cls: NumClass = 'double'): Tensor {
  const out = zeros(t.rows, t.cols, cls);
  for (let i = 0; i < t.numel; i++) out.re[i] = f(t.re[i]);
  return out;
}

export function mapBool(t: Tensor, f: (x: number, i: number) => boolean): Tensor {
  const out = zeros(t.rows, t.cols, 'logical');
  for (let i = 0; i < t.numel; i++) out.re[i] = f(t.re[i], i) ? 1 : 0;
  return out;
}

/** Determine the default reduction dimension (1-based): first non-singleton. */
export function defaultDim(t: { rows: number; cols: number }): number {
  if (t.rows !== 1) return 1;
  return 2;
}

/** Reduce along a dimension. f receives the slice as an array, returns a number. */
export function reduce(t: Tensor, dim: number, f: (v: number[]) => number, cls: NumClass = 'double'): Tensor {
  if (t.rows === 0 && t.cols === 0) {
    const out = zeros(1, 1, cls);
    out.re[0] = f([]);
    return out;
  }
  if (dim === 1) {
    const out = zeros(1, t.cols, cls);
    for (let j = 0; j < t.cols; j++) out.re[j] = f(Array.from(t.re.subarray(j * t.rows, (j + 1) * t.rows)));
    return out;
  }
  if (dim === 2) {
    const out = zeros(t.rows, 1, cls);
    for (let i = 0; i < t.rows; i++) {
      const v: number[] = [];
      for (let j = 0; j < t.cols; j++) v.push(t.re[j * t.rows + i]);
      out.re[i] = f(v);
    }
    return out;
  }
  return mapReal(t, (x) => f([x]), cls);
}

/** Cumulative op along dim. f maps a slice to a slice. */
export function cumulate(t: Tensor, dim: number, f: (v: number[]) => number[]): Tensor {
  const out = zeros(t.rows, t.cols);
  if (dim === 1) {
    for (let j = 0; j < t.cols; j++) {
      const r = f(Array.from(t.re.subarray(j * t.rows, (j + 1) * t.rows)));
      out.re.set(r, j * t.rows);
    }
  } else {
    for (let i = 0; i < t.rows; i++) {
      const v: number[] = [];
      for (let j = 0; j < t.cols; j++) v.push(t.re[j * t.rows + i]);
      const r = f(v);
      for (let j = 0; j < t.cols; j++) out.re[j * t.rows + i] = r[j];
    }
  }
  return out;
}

export function getDim(args: Value[], i: number, t: Tensor): number {
  if (i < args.length && !isStringLike(args[i])) {
    const d = toNumber(args[i]);
    if (!Number.isInteger(d) || d < 1) throw new MError('Dimension argument must be a positive integer scalar.');
    return d;
  }
  return defaultDim(t);
}

export function hasFlag(args: Value[], flag: string): boolean {
  return args.some((a) => isStringLike(a) && toStringValue(a).toLowerCase() === flag.toLowerCase());
}

export function stripFlags(args: Value[], flags: string[]): Value[] {
  return args.filter((a) => !(isStringLike(a) && flags.includes(toStringValue(a).toLowerCase())));
}

export function nameValues(args: Value[], start = 0): Map<string, Value> {
  const m = new Map<string, Value>();
  for (let i = start; i + 1 < args.length; i += 2) {
    if (!isStringLike(args[i])) continue;
    m.set(toStringValue(args[i]).toLowerCase(), args[i + 1]);
  }
  return m;
}

export function vecValues(t: Tensor): number[] {
  return Array.from(t.re);
}

export function boolT(b: boolean): Tensor {
  const t = zeros(1, 1, 'logical');
  t.re[0] = b ? 1 : 0;
  return t;
}

export function scalarOrNum(x: number) {
  return num(x);
}

export function strings(v: Value): string[] {
  if (v.kind === 'string') return v.data;
  if (v.kind === 'cell') return v.data.map((x) => toStringValue(x));
  return [toStringValue(v)];
}

export function makeStringResult(like: Value, data: string[]): Value {
  if (like.kind === 'string') return new StringArray(like.rows, like.cols, data);
  return like;
}

export type Registry = (interp: Interpreter) => void;

export function def(interp: Interpreter, names: string | string[], fn: Builtin) {
  for (const n of Array.isArray(names) ? names : [names]) interp.register(n, fn);
}

/** Simple seeded PRNG (xorshift128+) so rng(seed) gives reproducible results. */
export class Rng {
  private s0 = 0x12345678;
  private s1 = 0x9abcdef0;
  private spare: number | null = null;
  seed(n: number) {
    this.s0 = (n * 2654435761) >>> 0 || 0x12345678;
    this.s1 = ((n + 1) * 2246822519) >>> 0 || 0x9abcdef0;
    this.spare = null;
    for (let i = 0; i < 20; i++) this.next();
  }
  next(): number {
    let x = this.s0;
    const y = this.s1;
    this.s0 = y;
    x ^= x << 23;
    x ^= x >>> 17;
    x ^= y ^ (y >>> 26);
    this.s1 = x >>> 0;
    return ((this.s0 + this.s1) >>> 0) / 4294967296;
  }
  normal(): number {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return s;
    }
    let u = 0, v = 0, s = 0;
    do {
      u = this.next() * 2 - 1;
      v = this.next() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    this.spare = v * m;
    return u * m;
  }
}

export const rng = new Rng();
rng.seed(Date.now() % 1e9);
