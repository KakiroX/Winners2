import { CellArray, MError, StringArray, StructArray, Tensor, emptyTensor, zeros, type NumClass, type Value, isIntClass, saturate } from './value';

export const COLON = Symbol('colon');
export type RawIndex = Value | typeof COLON;
export type IndexArg = 'all' | { idx: number[]; r: number; c: number; logical: boolean };

export function resolveIndex(v: RawIndex, dimLen: number): IndexArg {
  if (v === COLON) return 'all';
  if (v.kind === 'tensor' && v.cls === 'char' && v.numel === 1 && v.re[0] === 58) return 'all';
  if (v.kind === 'string' && v.numel === 1 && v.data[0] === ':') return 'all';
  if (v.kind !== 'tensor') throw new MError(`Unable to use a value of type ${v.kind === 'cell' ? 'cell' : v.kind} as an index.`, 'MATLAB:badsubscript');
  if (v.cls === 'logical') {
    const idx: number[] = [];
    for (let i = 0; i < v.numel; i++) if (v.re[i]) idx.push(i);
    if (v.numel > dimLen) {
      for (let i = dimLen; i < v.numel; i++) if (v.re[i]) throw new MError(`The logical indices contain a true value outside of the array bounds.`, 'MATLAB:badsubscript');
    }
    return { idx, r: v.rows === 1 ? 1 : idx.length, c: v.rows === 1 ? idx.length : 1, logical: true };
  }
  const idx = new Array<number>(v.numel);
  for (let i = 0; i < v.numel; i++) {
    const x = v.re[i];
    if (!Number.isInteger(x)) {
      if (Number.isNaN(x)) throw new MError('Index must be a positive integer or logical; NaN is not allowed.', 'MATLAB:badsubscript');
      throw new MError(`Array indices must be positive integers or logical values.`, 'MATLAB:badsubscript');
    }
    if (x < 1) throw new MError(`Array indices must be positive integers or logical values.`, 'MATLAB:badsubscript');
    idx[i] = x - 1;
  }
  return { idx, r: v.rows, c: v.cols, logical: false };
}

function count(a: IndexArg, len: number) {
  return a === 'all' ? len : a.idx.length;
}
function at(a: IndexArg, k: number) {
  return a === 'all' ? k : a.idx[k];
}

/** Collapse >2 subscripts: trailing ones must be 1 or ':' (2-D arrays only). */
function normalizeArgs(args: RawIndex[], rows: number, cols: number): IndexArg[] {
  if (args.length <= 2) {
    if (args.length === 1) return [resolveIndex(args[0], rows * cols)];
    return [resolveIndex(args[0], rows), resolveIndex(args[1], cols)];
  }
  const first = [resolveIndex(args[0], rows), resolveIndex(args[1], cols)];
  for (let k = 2; k < args.length; k++) {
    const a = resolveIndex(args[k], 1);
    if (a !== 'all' && !(a.idx.length === 1 && a.idx[0] === 0)) throw new MError('Index in position ' + (k + 1) + ' exceeds array bounds. N-dimensional arrays are not supported.', 'MATLAB:badsubscript');
  }
  return first;
}

export interface ReadPlan {
  r: number;
  c: number;
  src: number[];
}

export function planRead(rows: number, cols: number, args: RawIndex[]): ReadPlan {
  const numel = rows * cols;
  if (args.length === 0) return { r: rows, c: cols, src: Array.from({ length: numel }, (_, i) => i) };
  const ia = normalizeArgs(args, rows, cols);
  if (ia.length === 1) {
    const a = ia[0];
    if (a === 'all') return { r: numel, c: 1, src: Array.from({ length: numel }, (_, i) => i) };
    for (const i of a.idx) if (i >= numel) throw new MError(`Index exceeds the number of array elements. Index must not exceed ${numel}.`, 'MATLAB:badsubscript');
    let r = a.r, c = a.c;
    const isVecIdx = a.r === 1 || a.c === 1;
    const isVecSrc = rows === 1 || cols === 1;
    if (a.logical) {
      if (rows === 1) {
        r = 1;
        c = a.idx.length;
      } else {
        r = a.idx.length;
        c = 1;
      }
    } else if (isVecIdx && isVecSrc && numel > 0) {
      if (rows === 1) {
        r = 1;
        c = a.idx.length;
      } else {
        r = a.idx.length;
        c = 1;
      }
    }
    return { r, c, src: a.idx };
  }
  const [ar, ac] = ia;
  const nr = count(ar, rows), nc = count(ac, cols);
  if (ar !== 'all') for (const i of ar.idx) if (i >= rows) throw new MError(`Index in position 1 exceeds array bounds. Index must not exceed ${rows}.`, 'MATLAB:badsubscript');
  if (ac !== 'all') for (const j of ac.idx) if (j >= cols) throw new MError(`Index in position 2 exceeds array bounds. Index must not exceed ${cols}.`, 'MATLAB:badsubscript');
  const src = new Array<number>(nr * nc);
  for (let j = 0; j < nc; j++) {
    const cj = at(ac, j);
    for (let i = 0; i < nr; i++) src[j * nr + i] = cj * rows + at(ar, i);
  }
  return { r: nr, c: nc, src };
}

export interface AssignPlan {
  rows: number;
  cols: number;
  dst: number[];
  /** shape of the indexed region (for checking rhs shape) */
  r: number;
  c: number;
}

export function planAssign(rows: number, cols: number, args: RawIndex[], rhsRows: number, rhsCols: number): AssignPlan {
  const rhsNumel = rhsRows * rhsCols;
  if (args.length === 1) {
    const numel = rows * cols;
    let a = resolveIndex(args[0], numel);
    if (a === 'all') {
      if (numel === 0 && rhsNumel > 0) return { rows: rhsRows, cols: rhsCols, dst: Array.from({ length: rhsNumel }, (_, i) => i), r: rhsRows, c: rhsCols };
      a = { idx: Array.from({ length: numel }, (_, i) => i), r: rows, c: cols, logical: false };
    }
    let maxI = -1;
    for (const i of a.idx) if (i > maxI) maxI = i;
    let nr = rows, nc = cols;
    if (maxI >= numel) {
      if (numel === 0) {
        nr = 1;
        nc = maxI + 1;
        if (rows > 0 && cols === 0) {
          nr = maxI + 1;
          nc = 1;
        }
      } else if (rows === 1) nc = maxI + 1;
      else if (cols === 1) nr = maxI + 1;
      else throw new MError('Attempt to grow array along ambiguous dimension.', 'MATLAB:badsubscript');
    }
    return { rows: nr, cols: nc, dst: a.idx, r: a.r, c: a.c };
  }
  const ia = normalizeArgs(args, rows, cols);
  let [ar, ac] = ia;
  if (ar === 'all' && rows === 0) ar = { idx: Array.from({ length: rhsRows === 1 && ac !== 'all' && ac.idx.length === rhsNumel && rhsCols !== 1 ? 1 : rhsRows }, (_, i) => i), r: 1, c: 1, logical: false };
  if (ac === 'all' && cols === 0) ac = { idx: Array.from({ length: rhsCols }, (_, i) => i), r: 1, c: 1, logical: false };
  const ri = ar === 'all' ? Array.from({ length: rows }, (_, i) => i) : ar.idx;
  const ci = ac === 'all' ? Array.from({ length: cols }, (_, i) => i) : ac.idx;
  const nr = Math.max(rows, ...ri.map((i) => i + 1), 0), nc = Math.max(cols, ...ci.map((j) => j + 1), 0);
  const dst = new Array<number>(ri.length * ci.length);
  for (let j = 0; j < ci.length; j++) for (let i = 0; i < ri.length; i++) dst[j * ri.length + i] = ci[j] * nr + ri[i];
  return { rows: nr, cols: nc, dst, r: ri.length, c: ci.length };
}

export function planDelete(rows: number, cols: number, args: RawIndex[]): { rows: number; cols: number; keep: number[] } {
  const numel = rows * cols;
  if (args.length === 1) {
    const a = resolveIndex(args[0], numel);
    if (a === 'all') return { rows: 0, cols: 0, keep: [] };
    const del = new Set(a.idx);
    for (const i of del) if (i >= numel) throw new MError(`Index exceeds the number of array elements. Index must not exceed ${numel}.`);
    const keep: number[] = [];
    for (let i = 0; i < numel; i++) if (!del.has(i)) keep.push(i);
    return cols === 1 && rows !== 1 ? { rows: keep.length, cols: 1, keep } : { rows: keep.length ? 1 : rows === 1 ? 1 : 0, cols: keep.length, keep };
  }
  const [ar, ac] = normalizeArgs(args, rows, cols);
  const fullR = ar === 'all' || (ar.idx.length >= rows && new Set(ar.idx).size === rows);
  const fullC = ac === 'all' || (ac.idx.length >= cols && new Set(ac.idx).size === cols);
  if (fullR && ac !== 'all') {
    const del = new Set(ac.idx);
    const keepC: number[] = [];
    for (let j = 0; j < cols; j++) if (!del.has(j)) keepC.push(j);
    const keep: number[] = [];
    for (const j of keepC) for (let i = 0; i < rows; i++) keep.push(j * rows + i);
    return { rows, cols: keepC.length, keep };
  }
  if (fullC && ar !== 'all') {
    const del = new Set(ar.idx);
    const keepR: number[] = [];
    for (let i = 0; i < rows; i++) if (!del.has(i)) keepR.push(i);
    const keep: number[] = [];
    for (let j = 0; j < cols; j++) for (const i of keepR) keep.push(j * rows + i);
    return { rows: keepR.length, cols, keep };
  }
  if (ar === 'all' && ac === 'all') return { rows: 0, cols: cols, keep: [] };
  throw new MError('A null assignment can have only one non-colon index.', 'MATLAB:nullAssignmentNonColon');
}

// ---------------- Applying plans ----------------
export function indexValue(v: Value, args: RawIndex[]): Value {
  const p = planRead(v.rows, v.cols, args);
  switch (v.kind) {
    case 'tensor': {
      const out = new Tensor(p.r, p.c, new Float64Array(p.src.length), v.im ? new Float64Array(p.src.length) : null, v.cls);
      for (let k = 0; k < p.src.length; k++) out.re[k] = v.re[p.src[k]];
      if (v.im) {
        for (let k = 0; k < p.src.length; k++) out.im![k] = v.im[p.src[k]];
        out.simplify();
      }
      return out;
    }
    case 'cell':
      return new CellArray(p.r, p.c, p.src.map((i) => v.data[i]));
    case 'string':
      return new StringArray(p.r, p.c, p.src.map((i) => v.data[i]));
    case 'struct':
      return new StructArray(p.r, p.c, [...v.fields], p.src.map((i) => v.data[i]));
    case 'fhandle':
      throw new MError('Function handles cannot be indexed with ().');
  }
}

function mergeClass(base: Tensor | undefined, rhs: Tensor): NumClass {
  if (!base || (base.numel === 0 && base.cls === 'double')) return rhs.cls;
  if (base.cls === 'logical' && rhs.cls !== 'logical') return rhs.cls === 'char' ? 'double' : rhs.cls;
  if (base.cls === 'char' && rhs.cls !== 'char') return isIntClass(rhs.cls) ? rhs.cls : 'char';
  if (base.cls === 'double' && isIntClass(rhs.cls)) return rhs.cls;
  return base.cls;
}

function checkRhs(plan: AssignPlan, rhsNumel: number) {
  if (rhsNumel !== 1 && rhsNumel !== plan.dst.length)
    throw new MError(
      plan.dst.length === 0 && rhsNumel > 0 ? 'Unable to perform assignment because the indices on the left side are not compatible with the size of the right side.' : `Unable to perform assignment because the left and right sides have a different number of elements.`,
      'MATLAB:subsassignnumelmismatch',
    );
}

function relayout<T>(old: T[] | Float64Array, oldR: number, oldC: number, nr: number, nc: number, fill: T, make: (n: number) => any) {
  if (oldR === nr && oldC === nc) return old.slice() as any;
  const out = make(nr * nc);
  if (fill !== undefined && !(out instanceof Float64Array)) for (let i = 0; i < nr * nc; i++) out[i] = fill;
  for (let j = 0; j < oldC; j++) for (let i = 0; i < oldR; i++) out[j * nr + i] = (old as any)[j * oldR + i];
  return out;
}

export function isDeletion(rhs: Value): boolean {
  return rhs.kind === 'tensor' && rhs.rows === 0 && rhs.cols === 0 && rhs.cls === 'double';
}

export function assignIndex(base: Value | undefined, args: RawIndex[], rhs: Value): Value {
  if (base && isDeletion(rhs) && base.kind !== 'cell' ) return deleteElements(base, args);
  if (base && base.kind === 'cell' && isDeletion(rhs)) return deleteElements(base, args);
  if (!base) {
    if (rhs.kind === 'cell') base = new CellArray(0, 0, []);
    else if (rhs.kind === 'struct') base = new StructArray(0, 0, [...rhs.fields], []);
    else if (rhs.kind === 'string') base = new StringArray(0, 0, []);
    else if (rhs.kind === 'fhandle') {
      if (args.every((a) => a !== COLON && a.kind === 'tensor' && a.numel === 1 && a.re[0] === 1)) return rhs;
      throw new MError('Function handle arrays are not supported.');
    } else base = emptyTensor(rhs.kind === 'tensor' ? rhs.cls : 'double');
  }
  const plan = planAssign(base.rows, base.cols, args, rhs.rows, rhs.cols);
  switch (base.kind) {
    case 'tensor': {
      if (rhs.kind === 'cell') {
        if (base.numel === 0) return assignIndex(new CellArray(0, 0, []), args, rhs);
        throw new MError('Conversion to double from cell is not possible.');
      }
      if (rhs.kind === 'struct') {
        if (base.numel === 0) return assignIndex(undefined, args, rhs);
        throw new MError('Conversion to double from struct is not possible.');
      }
      if (rhs.kind === 'string') {
        if (base.numel === 0) return assignIndex(new StringArray(0, 0, []), args, rhs);
        throw new MError('Conversion to double from string is not possible.');
      }
      if (rhs.kind !== 'tensor') throw new MError(`Conversion to double from ${rhs.kind} is not possible.`);
      checkRhs(plan, rhs.numel);
      const cls = mergeClass(base, rhs);
      const re = relayout(base.re, base.rows, base.cols, plan.rows, plan.cols, 0, (n) => new Float64Array(n)) as Float64Array;
      let im: Float64Array | null = base.im ? (relayout(base.im, base.rows, base.cols, plan.rows, plan.cols, 0, (n) => new Float64Array(n)) as Float64Array) : null;
      if (rhs.im && !im) im = new Float64Array(plan.rows * plan.cols);
      const one = rhs.numel === 1;
      for (let k = 0; k < plan.dst.length; k++) {
        let v = rhs.re[one ? 0 : k];
        if (isIntClass(cls)) v = saturate(v, cls);
        else if (cls === 'logical' && v !== 0 && v !== 1) v = v ? 1 : 0;
        re[plan.dst[k]] = v;
        if (im) im[plan.dst[k]] = rhs.im ? rhs.im[one ? 0 : k] : 0;
      }
      return new Tensor(plan.rows, plan.cols, re, im, cls).simplify();
    }
    case 'cell': {
      if (rhs.kind !== 'cell') {
        throw new MError("Conversion to cell from " + (rhs.kind === 'tensor' ? rhs.cls : rhs.kind) + " is not possible. Use {} to assign cell contents.", 'MATLAB:invalidConversion');
      }
      checkRhs(plan, rhs.numel);
      const data = relayout(base.data, base.rows, base.cols, plan.rows, plan.cols, undefined as any, (n) => new Array(n)) as Value[];
      for (let i = 0; i < data.length; i++) if (!data[i]) data[i] = emptyTensor();
      const one = rhs.numel === 1;
      for (let k = 0; k < plan.dst.length; k++) data[plan.dst[k]] = rhs.data[one ? 0 : k];
      return new CellArray(plan.rows, plan.cols, data);
    }
    case 'string': {
      let rs: string[];
      if (rhs.kind === 'string') rs = rhs.data;
      else if (rhs.kind === 'tensor' && rhs.cls === 'char') rs = [rhs.toStr()];
      else if (rhs.kind === 'tensor') rs = Array.from(rhs.re, (x) => String(x));
      else throw new MError('Cannot convert to string.');
      checkRhs(plan, rs.length);
      const data = relayout(base.data, base.rows, base.cols, plan.rows, plan.cols, undefined as any, (n) => new Array(n)) as string[];
      for (let i = 0; i < data.length; i++) if (data[i] === undefined) data[i] = '';
      for (let k = 0; k < plan.dst.length; k++) data[plan.dst[k]] = rs[rs.length === 1 ? 0 : k];
      return new StringArray(plan.rows, plan.cols, data);
    }
    case 'struct': {
      if (rhs.kind !== 'struct') throw new MError('Conversion to struct from ' + rhs.kind + ' is not possible.');
      checkRhs(plan, rhs.numel);
      const fields = [...base.fields];
      for (const f of rhs.fields) if (!fields.includes(f)) fields.push(f);
      const blank = () => new Map(fields.map((f) => [f, emptyTensor() as Value]));
      const data = relayout(base.data, base.rows, base.cols, plan.rows, plan.cols, undefined as any, (n) => new Array(n)) as Map<string, Value>[];
      for (let i = 0; i < data.length; i++) {
        if (!data[i]) data[i] = blank();
        else for (const f of fields) if (!data[i].has(f)) data[i].set(f, emptyTensor());
      }
      const one = rhs.numel === 1;
      for (let k = 0; k < plan.dst.length; k++) {
        const m = new Map(rhs.data[one ? 0 : k]);
        for (const f of fields) if (!m.has(f)) m.set(f, emptyTensor());
        data[plan.dst[k]] = m;
      }
      return new StructArray(plan.rows, plan.cols, fields, data);
    }
    case 'fhandle':
      throw new MError('Function handles cannot be indexed.');
  }
}

export function deleteElements(base: Value, args: RawIndex[]): Value {
  const p = planDelete(base.rows, base.cols, args);
  switch (base.kind) {
    case 'tensor': {
      const out = new Tensor(p.rows, p.cols, new Float64Array(p.keep.length), base.im ? new Float64Array(p.keep.length) : null, base.cls);
      p.keep.forEach((i, k) => {
        out.re[k] = base.re[i];
        if (base.im) out.im![k] = base.im[i];
      });
      return out;
    }
    case 'cell':
      return new CellArray(p.rows, p.cols, p.keep.map((i) => base.data[i]));
    case 'string':
      return new StringArray(p.rows, p.cols, p.keep.map((i) => base.data[i]));
    case 'struct':
      return new StructArray(p.rows, p.cols, [...base.fields], p.keep.map((i) => base.data[i]));
    case 'fhandle':
      throw new MError('Cannot delete from a function handle.');
  }
}

/** Contents of C{args} as a list of values (cs-list). */
export function cellContents(c: Value, args: RawIndex[]): Value[] {
  if (c.kind !== 'cell') {
    if (c.kind === 'string') return planRead(c.rows, c.cols, args).src.map((i) => strToChar(c.data[i]));
    throw new MError(`Brace indexing is not supported for variables of this type.`, 'MATLAB:cellRefFromNonCell');
  }
  const p = planRead(c.rows, c.cols, args);
  return p.src.map((i) => c.data[i]);
}

function strToChar(s: string): Tensor {
  const t = zeros(s.length ? 1 : 0, s.length, 'char');
  for (let i = 0; i < s.length; i++) t.re[i] = s.charCodeAt(i);
  return t;
}

export function assignCellContents(base: Value | undefined, args: RawIndex[], rhs: Value): Value {
  if (base && base.kind !== 'cell') {
    if (base.kind === 'tensor' && base.numel === 0) base = undefined;
    else throw new MError('Unable to perform assignment because brace indexing is not supported for variables of this type.', 'MATLAB:cellAssToNonCell');
  }
  const cbase = (base as CellArray | undefined) ?? new CellArray(0, 0, []);
  return assignIndex(cbase, args, new CellArray(1, 1, [rhs]));
}
