import { CellArray, MError, StringArray, StructArray, Tensor, emptyTensor, isIntClass, saturate, type NumClass, type Value } from './value';

function isEmptyVal(v: Value) {
  return v.rows * v.cols === 0 && !(v.kind === 'tensor' && v.cls === 'char' && v.rows > 0);
}

function tensorClass(vals: Tensor[]): NumClass {
  if (vals.some((v) => v.cls === 'char')) return 'char';
  const ints = vals.filter((v) => isIntClass(v.cls));
  if (ints.length) return ints[0].cls;
  if (vals.some((v) => v.cls === 'single')) return 'single';
  if (vals.length && vals.every((v) => v.cls === 'logical')) return 'logical';
  return 'double';
}

function hcatTensor(vals: Tensor[]): Tensor {
  const nonEmpty = vals.filter((v) => !(v.rows === 0 && v.cols === 0));
  if (!nonEmpty.length) {
    const cls = tensorClass(vals);
    const totalCols = vals.reduce((s, v) => s + v.cols, 0);
    return new Tensor(0, totalCols && vals.every((v) => v.rows === 0) ? totalCols : 0, new Float64Array(0), null, cls);
  }
  const rows = nonEmpty[0].rows;
  for (const v of nonEmpty) if (v.rows !== rows) throw new MError('Dimensions of arrays being concatenated are not consistent.', 'MATLAB:catenate:dimensionMismatch');
  const cols = nonEmpty.reduce((s, v) => s + v.cols, 0);
  const cls = tensorClass(vals);
  const cplx = nonEmpty.some((v) => v.im);
  const out = new Tensor(rows, cols, new Float64Array(rows * cols), cplx ? new Float64Array(rows * cols) : null, cls);
  let off = 0;
  for (const v of nonEmpty) {
    out.re.set(v.re, off);
    if (cplx && v.im) out.im!.set(v.im, off);
    off += v.numel;
  }
  if (isIntClass(cls)) for (let i = 0; i < out.numel; i++) out.re[i] = saturate(out.re[i], cls);
  return out;
}

function vcatTensor(vals: Tensor[]): Tensor {
  const nonEmpty = vals.filter((v) => !(v.rows === 0 && v.cols === 0) && !(v.numel === 0 && v.cols === 0));
  if (!nonEmpty.length) return new Tensor(0, 0, new Float64Array(0), null, tensorClass(vals));
  const cols = nonEmpty[0].cols;
  for (const v of nonEmpty)
    if (v.cols !== cols) {
      if (v.cls === 'char' || nonEmpty[0].cls === 'char') throw new MError('Dimensions of arrays being concatenated are not consistent. (Use char() or strvcat() to vertically concatenate character vectors of different lengths.)', 'MATLAB:catenate:dimensionMismatch');
      throw new MError('Dimensions of arrays being concatenated are not consistent.', 'MATLAB:catenate:dimensionMismatch');
    }
  const rows = nonEmpty.reduce((s, v) => s + v.rows, 0);
  const cls = tensorClass(vals);
  const cplx = nonEmpty.some((v) => v.im);
  const out = new Tensor(rows, cols, new Float64Array(rows * cols), cplx ? new Float64Array(rows * cols) : null, cls);
  let r0 = 0;
  for (const v of nonEmpty) {
    for (let j = 0; j < cols; j++)
      for (let i = 0; i < v.rows; i++) {
        out.re[j * rows + r0 + i] = v.re[j * v.rows + i];
        if (cplx && v.im) out.im![j * rows + r0 + i] = v.im[j * v.rows + i];
      }
    r0 += v.rows;
  }
  return out;
}

function toCell(v: Value): CellArray {
  if (v.kind === 'cell') return v;
  return new CellArray(1, 1, [v]);
}

function hcatGeneric<T>(vals: { rows: number; cols: number; data: T[] }[]): { rows: number; cols: number; data: T[] } {
  const ne = vals.filter((v) => v.rows * v.cols > 0);
  if (!ne.length) return { rows: 0, cols: 0, data: [] };
  const rows = ne[0].rows;
  for (const v of ne) if (v.rows !== rows) throw new MError('Dimensions of arrays being concatenated are not consistent.');
  return { rows, cols: ne.reduce((s, v) => s + v.cols, 0), data: ne.flatMap((v) => v.data) };
}

function vcatGeneric<T>(vals: { rows: number; cols: number; data: T[] }[]): { rows: number; cols: number; data: T[] } {
  const ne = vals.filter((v) => v.rows * v.cols > 0);
  if (!ne.length) return { rows: 0, cols: 0, data: [] };
  const cols = ne[0].cols;
  for (const v of ne) if (v.cols !== cols) throw new MError('Dimensions of arrays being concatenated are not consistent.');
  const rows = ne.reduce((s, v) => s + v.rows, 0);
  const data = new Array<T>(rows * cols);
  let r0 = 0;
  for (const v of ne) {
    for (let j = 0; j < cols; j++) for (let i = 0; i < v.rows; i++) data[j * rows + r0 + i] = v.data[j * v.rows + i];
    r0 += v.rows;
  }
  return { rows, cols, data };
}

function toStringArr(v: Value): StringArray {
  if (v.kind === 'string') return v;
  if (v.kind === 'tensor' && v.cls === 'char') return new StringArray(1, 1, [v.toStr()]);
  if (v.kind === 'tensor') return new StringArray(v.rows, v.cols, Array.from(v.re, (x) => String(x)));
  if (v.kind === 'cell') return new StringArray(v.rows, v.cols, v.data.map((x) => (x.kind === 'string' ? x.data[0] : x.kind === 'tensor' ? x.toStr() : '')));
  throw new MError('Unable to concatenate with a string.');
}

/** Concatenate rows of values: horizontally within each row, then vertically. */
export function concat(rows: Value[][], mode: 'matrix' | 'cell'): Value {
  const flat = rows.flat();
  if (mode === 'cell' || flat.some((v) => v.kind === 'cell')) {
    const rowVals = rows.map((r) => {
      const h = hcatGeneric(r.map((v) => {
        const c = toCell(v);
        return { rows: c.rows, cols: c.cols, data: c.data };
      }));
      return h;
    });
    const v = vcatGeneric(rowVals);
    return new CellArray(v.rows, v.cols, v.data);
  }
  if (!flat.length) return emptyTensor();
  if (flat.some((v) => v.kind === 'string')) {
    const v = vcatGeneric(rows.map((r) => {
      const h = hcatGeneric(r.map((x) => {
        const s = toStringArr(x);
        return { rows: s.rows, cols: s.cols, data: s.data };
      }));
      return h;
    }));
    return new StringArray(v.rows, v.cols, v.data);
  }
  if (flat.some((v) => v.kind === 'struct')) {
    const all = flat.filter((v) => !isEmptyVal(v));
    if (!all.every((v) => v.kind === 'struct')) throw new MError('Cannot concatenate a struct with a non-struct value.');
    const ss = all as StructArray[];
    const fields = ss[0].fields;
    for (const s of ss) if (s.fields.length !== fields.length || !s.fields.every((f) => fields.includes(f))) throw new MError('Field names must match for struct concatenation.', 'MATLAB:catenate:structFieldBad');
    const v = vcatGeneric(rows.map((r) => hcatGeneric(r.filter((x) => x.kind === 'struct').map((x) => ({ rows: x.rows, cols: x.cols, data: (x as StructArray).data })))));
    return new StructArray(v.rows, v.cols, [...fields], v.data);
  }
  if (flat.some((v) => v.kind === 'fhandle')) {
    if (flat.length === 1) return flat[0];
    throw new MError('Nonscalar arrays of function handles are not allowed; use cell arrays instead.');
  }
  const trows = rows.map((r) => hcatTensor(r as Tensor[]));
  if (trows.length === 1) return trows[0];
  return vcatTensor(trows);
}

export function hcat(vals: Value[]): Value {
  return concat([vals], 'matrix');
}

export function vcat(vals: Value[]): Value {
  return concat(vals.map((v) => [v]), 'matrix');
}
