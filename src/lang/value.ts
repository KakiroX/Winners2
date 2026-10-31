// Runtime values for the MATLAB-compatible interpreter. Numeric arrays are 2-D, column-major.

export type NumClass = 'double' | 'single' | 'logical' | 'char' | 'int8' | 'int16' | 'int32' | 'int64' | 'uint8' | 'uint16' | 'uint32' | 'uint64';

export class MError extends Error {
  identifier: string;
  constructor(message: string, identifier = '') {
    super(message);
    this.identifier = identifier;
  }
}

export const INT_RANGE: Partial<Record<NumClass, [number, number]>> = {
  int8: [-128, 127], uint8: [0, 255], int16: [-32768, 32767], uint16: [0, 65535],
  int32: [-2147483648, 2147483647], uint32: [0, 4294967295], int64: [-9223372036854775808, 9223372036854775807], uint64: [0, 18446744073709551615],
};

export function isIntClass(c: NumClass) {
  return c in INT_RANGE;
}

export class Tensor {
  readonly kind = 'tensor';
  constructor(
    public rows: number,
    public cols: number,
    public re: Float64Array,
    public im: Float64Array | null = null,
    public cls: NumClass = 'double',
  ) {}
  get numel() {
    return this.rows * this.cols;
  }
  isEmpty() {
    return this.rows === 0 || this.cols === 0;
  }
  isScalar() {
    return this.rows === 1 && this.cols === 1;
  }
  isVector() {
    return (this.rows === 1 || this.cols === 1) && this.numel >= 1;
  }
  isComplex() {
    return this.im !== null;
  }
  get(i: number) {
    return this.re[i];
  }
  get2(r: number, c: number) {
    return this.re[c * this.rows + r];
  }
  scalar(): number {
    return this.re[0];
  }
  toStr(): string {
    if (this.cls === 'char') {
      if (this.rows <= 1) return String.fromCharCode(...this.re);
      // multi-row char matrix → rows joined
      const lines: string[] = [];
      for (let r = 0; r < this.rows; r++) {
        let s = '';
        for (let c = 0; c < this.cols; c++) s += String.fromCharCode(this.re[c * this.rows + r]);
        lines.push(s);
      }
      return lines.join('\n');
    }
    return Array.from(this.re).map((v) => String.fromCharCode(v)).join('');
  }
  rowStrings(): string[] {
    const out: string[] = [];
    for (let r = 0; r < this.rows; r++) {
      let s = '';
      for (let c = 0; c < this.cols; c++) s += String.fromCharCode(this.re[c * this.rows + r]);
      out.push(s);
    }
    return out;
  }
  clone(): Tensor {
    return new Tensor(this.rows, this.cols, new Float64Array(this.re), this.im ? new Float64Array(this.im) : null, this.cls);
  }
  withClass(cls: NumClass): Tensor {
    return new Tensor(this.rows, this.cols, this.re, this.im, cls);
  }
  reshape(r: number, c: number): Tensor {
    return new Tensor(r, c, this.re, this.im, this.cls);
  }
  /** Drop an all-zero imaginary part. */
  simplify(): Tensor {
    if (this.im && this.im.every((v) => v === 0)) this.im = null;
    return this;
  }
}

export class CellArray {
  readonly kind = 'cell';
  constructor(public rows: number, public cols: number, public data: Value[]) {}
  get numel() {
    return this.rows * this.cols;
  }
  static empty(r = 0, c = 0) {
    return new CellArray(r, c, Array.from({ length: r * c }, () => emptyTensor()));
  }
}

export class StructArray {
  readonly kind = 'struct';
  constructor(public rows: number, public cols: number, public fields: string[], public data: Map<string, Value>[]) {}
  get numel() {
    return this.rows * this.cols;
  }
  static scalar(entries: [string, Value][] = []): StructArray {
    const m = new Map<string, Value>(entries);
    return new StructArray(1, 1, entries.map((e) => e[0]), [m]);
  }
  getField(name: string, i = 0): Value {
    const v = this.data[i]?.get(name);
    if (v === undefined) throw new MError(`Unrecognized field name "${name}".`, 'MATLAB:nonExistentField');
    return v;
  }
  clone(): StructArray {
    return new StructArray(this.rows, this.cols, [...this.fields], this.data.map((m) => new Map(m)));
  }
}

export class StringArray {
  readonly kind = 'string';
  constructor(public rows: number, public cols: number, public data: string[]) {}
  get numel() {
    return this.rows * this.cols;
  }
  static scalar(s: string) {
    return new StringArray(1, 1, [s]);
  }
}

export interface FuncHandleData {
  name?: string;
  params?: string[];
  body?: import('./ast').Expr;
  closure?: Map<string, Value>;
  src?: string;
}

export class FuncHandle {
  readonly kind = 'fhandle';
  constructor(public h: FuncHandleData) {}
  get rows() {
    return 1;
  }
  get cols() {
    return 1;
  }
  get numel() {
    return 1;
  }
  toString() {
    return this.h.src ?? `@${this.h.name}`;
  }
}

export type Value = Tensor | CellArray | StructArray | StringArray | FuncHandle;

// ---------------- Constructors ----------------
export function emptyTensor(cls: NumClass = 'double'): Tensor {
  return new Tensor(0, 0, new Float64Array(0), null, cls);
}

export function num(v: number): Tensor {
  return new Tensor(1, 1, Float64Array.of(v));
}

export function complexScalar(re: number, im: number): Tensor {
  return new Tensor(1, 1, Float64Array.of(re), Float64Array.of(im)).simplify();
}

export function bool(v: boolean): Tensor {
  return new Tensor(1, 1, Float64Array.of(v ? 1 : 0), null, 'logical');
}

export function str(s: string): Tensor {
  const t = new Tensor(s.length ? 1 : 0, s.length, new Float64Array(s.length), null, 'char');
  for (let i = 0; i < s.length; i++) t.re[i] = s.charCodeAt(i);
  return t;
}

export function charMatrix(lines: string[]): Tensor {
  const w = Math.max(0, ...lines.map((l) => l.length));
  const r = lines.length;
  const t = new Tensor(r, w, new Float64Array(r * w), null, 'char');
  for (let i = 0; i < r; i++) for (let j = 0; j < w; j++) t.re[j * r + i] = (lines[i][j] ?? ' ').charCodeAt(0);
  return t;
}

export function zeros(r: number, c: number, cls: NumClass = 'double'): Tensor {
  return new Tensor(r, c, new Float64Array(Math.max(0, r * c)), null, cls);
}

export function fromRows(rows: number[][]): Tensor {
  const r = rows.length, c = rows[0]?.length ?? 0;
  const t = zeros(r, c);
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) t.re[j * r + i] = rows[i][j];
  return t;
}

export function rowVec(v: ArrayLike<number>): Tensor {
  return new Tensor(1, v.length, Float64Array.from(v));
}

export function colVec(v: ArrayLike<number>): Tensor {
  return new Tensor(v.length, 1, Float64Array.from(v));
}

export function toRows(t: Tensor): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < t.rows; i++) {
    const row: number[] = [];
    for (let j = 0; j < t.cols; j++) row.push(t.re[j * t.rows + i]);
    out.push(row);
  }
  return out;
}

export function cellOf(values: Value[], rows = 1, cols = values.length): CellArray {
  return new CellArray(rows, cols, values);
}

export function strArr(s: string[]): StringArray {
  return new StringArray(1, s.length, s);
}

// ---------------- Type helpers ----------------
export function isTensor(v: Value | undefined): v is Tensor {
  return !!v && v.kind === 'tensor';
}

export function className(v: Value): string {
  switch (v.kind) {
    case 'tensor': return v.cls;
    case 'cell': return 'cell';
    case 'struct': return 'struct';
    case 'string': return 'string';
    case 'fhandle': return 'function_handle';
  }
}

export function sizeOf(v: Value): [number, number] {
  return [v.rows, v.cols];
}

export function toTensor(v: Value, ctx = 'operation'): Tensor {
  if (v.kind === 'tensor') return v;
  if (v.kind === 'string') {
    if (v.numel === 1) return str(v.data[0]);
    throw new MError(`Conversion from string array to numeric is not supported in ${ctx}.`);
  }
  if (v.kind === 'cell') throw new MError(`Operator or function '${ctx}' is not supported for operands of type 'cell'.`, 'MATLAB:UndefinedFunction');
  if (v.kind === 'struct') throw new MError(`Operator or function '${ctx}' is not supported for operands of type 'struct'.`, 'MATLAB:UndefinedFunction');
  throw new MError(`Operator or function '${ctx}' is not supported for operands of type 'function_handle'.`);
}

export function toNumber(v: Value, ctx = 'argument'): number {
  const t = toTensor(v, ctx);
  if (t.numel < 1) throw new MError(`Expected a scalar ${ctx} but got an empty array.`);
  return t.re[0];
}

export function toBoolScalar(v: Value): boolean {
  if (v.kind === 'tensor') {
    if (v.numel === 0) return false;
    for (let i = 0; i < v.numel; i++) {
      if (Number.isNaN(v.re[i])) throw new MError("NaN's cannot be converted to logicals.");
      if (v.re[i] === 0 && !(v.im && v.im[i] !== 0)) return false;
    }
    return true;
  }
  if (v.kind === 'string') return v.numel > 0;
  throw new MError(`Conversion to logical from ${className(v)} is not possible.`);
}

export function toStringValue(v: Value, ctx = 'argument'): string {
  if (v.kind === 'tensor') {
    if (v.cls === 'char' || v.numel === 0) return v.toStr();
    throw new MError(`Expected a character vector or string for ${ctx}.`);
  }
  if (v.kind === 'string') return v.data.join(' ');
  if (v.kind === 'cell' && v.numel === 1) return toStringValue(v.data[0], ctx);
  throw new MError(`Expected a character vector or string for ${ctx}.`);
}

export function isStringLike(v: Value | undefined): boolean {
  return !!v && ((v.kind === 'tensor' && v.cls === 'char') || (v.kind === 'string' && v.numel === 1));
}

export function cellStrings(v: Value): string[] {
  if (v.kind === 'cell') return v.data.map((x) => toStringValue(x));
  if (v.kind === 'string') return v.data;
  if (v.kind === 'tensor' && v.cls === 'char') return v.rows > 1 ? v.rowStrings().map((s) => s.trimEnd()) : [v.toStr()];
  throw new MError('Expected a cell array of character vectors.');
}

export function saturate(v: number, cls: NumClass): number {
  const r = INT_RANGE[cls];
  if (!r) return v;
  if (Number.isNaN(v)) return 0;
  const x = Math.round(v);
  return Math.min(r[1], Math.max(r[0], x));
}

export function castTo(t: Tensor, cls: NumClass): Tensor {
  const out = new Tensor(t.rows, t.cols, new Float64Array(t.re), cls === 'logical' || cls === 'char' || isIntClass(cls) ? null : t.im ? new Float64Array(t.im) : null, cls);
  if (cls === 'logical') {
    for (let i = 0; i < out.numel; i++) {
      if (Number.isNaN(out.re[i])) throw new MError("NaN's cannot be converted to logicals.");
      out.re[i] = out.re[i] !== 0 ? 1 : 0;
    }
  } else if (isIntClass(cls)) for (let i = 0; i < out.numel; i++) out.re[i] = saturate(out.re[i], cls);
  else if (cls === 'single') for (let i = 0; i < out.numel; i++) out.re[i] = Math.fround(out.re[i]);
  return out;
}

export function valuesEqual(a: Value, b: Value): boolean {
  if (a.kind !== b.kind) {
    if ((a.kind === 'string' && b.kind === 'tensor') || (a.kind === 'tensor' && b.kind === 'string')) {
      try {
        return toStringValue(a) === toStringValue(b);
      } catch {
        return false;
      }
    }
    return false;
  }
  if (a.rows !== b.rows || a.cols !== b.cols) return false;
  switch (a.kind) {
    case 'tensor': {
      const bt = b as Tensor;
      for (let i = 0; i < a.numel; i++) {
        if (a.re[i] !== bt.re[i]) return false;
        if ((a.im?.[i] ?? 0) !== (bt.im?.[i] ?? 0)) return false;
      }
      return true;
    }
    case 'cell':
      return a.data.every((v, i) => valuesEqual(v, (b as CellArray).data[i]));
    case 'string':
      return a.data.every((v, i) => v === (b as StringArray).data[i]);
    case 'struct': {
      const bs = b as StructArray;
      if (a.fields.length !== bs.fields.length || !a.fields.every((f) => bs.fields.includes(f))) return false;
      return a.data.every((m, i) => a.fields.every((f) => valuesEqual(m.get(f)!, bs.data[i].get(f)!)));
    }
    case 'fhandle':
      return a === b;
  }
}
