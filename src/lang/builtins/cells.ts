import { CellArray, MError, StringArray, StructArray, Tensor, bool, cellOf, emptyTensor, isStringLike, num, str, toNumber, toStringValue, toTensor, zeros, type Value, cellStrings } from '../value';
import type { Interpreter } from '../interp';
import { argNum, def, dimsArgs, minArgs } from './helpers';
import { concat } from '../concat';

export function registerCells(I: Interpreter) {
  def(I, 'cell', (a) => {
    const d = dimsArgs(a);
    return CellArray.empty(d.r, d.c);
  });
  def(I, 'struct', (a) => {
    if (!a.length) return StructArray.scalar();
    if (a.length % 2) throw new MError('Field and value input arguments must come in pairs.');
    const names: string[] = [];
    const vals: Value[] = [];
    for (let i = 0; i < a.length; i += 2) {
      names.push(toStringValue(a[i]));
      vals.push(a[i + 1]);
    }
    // cell values create struct arrays
    const sizes = vals.map((v) => (v.kind === 'cell' ? v.numel : 1));
    const n = Math.max(...sizes);
    const cellV = vals.find((v) => v.kind === 'cell' && v.numel === n) as CellArray | undefined;
    if (vals.some((v) => v.kind === 'cell' && v.numel === 0)) return new StructArray(0, 0, names, []);
    if (n === 1) return StructArray.scalar(names.map((nm, i) => [nm, vals[i].kind === 'cell' ? (vals[i] as CellArray).data[0] : vals[i]]));
    const data = Array.from({ length: n }, (_, k) => new Map<string, Value>(names.map((nm, i) => [nm, vals[i].kind === 'cell' ? ((vals[i] as CellArray).numel === 1 ? (vals[i] as CellArray).data[0] : (vals[i] as CellArray).data[k]) : vals[i]])));
    return new StructArray(cellV?.rows ?? 1, cellV?.cols ?? n, names, data);
  });
  def(I, 'fieldnames', (a) => {
    const s = a[0];
    if (s.kind !== 'struct') throw new MError('Invalid input argument of type ' + s.kind + '. Input must be a structure.');
    return new CellArray(s.fields.length, 1, s.fields.map((f) => str(f)));
  });
  def(I, 'isfield', (a) => {
    const s = a[0];
    if (s.kind !== 'struct') return bool(false);
    if (a[1].kind === 'cell') {
      const t = zeros(a[1].rows, a[1].cols, 'logical');
      a[1].data.forEach((x, i) => (t.re[i] = s.fields.includes(toStringValue(x)) ? 1 : 0));
      return t;
    }
    return bool(s.fields.includes(toStringValue(a[1])));
  });
  def(I, 'rmfield', (a) => {
    const s = a[0];
    if (s.kind !== 'struct') throw new MError('Input must be a structure.');
    const rm = a[1].kind === 'cell' ? a[1].data.map((x) => toStringValue(x)) : [toStringValue(a[1])];
    for (const f of rm) if (!s.fields.includes(f)) throw new MError(`A field named '${f}' doesn't exist.`);
    const out = s.clone();
    out.fields = out.fields.filter((f) => !rm.includes(f));
    for (const m of out.data) for (const f of rm) m.delete(f);
    return out;
  });
  def(I, 'setfield', (a) => {
    const s = (a[0].kind === 'struct' ? a[0] : StructArray.scalar()).clone();
    const f = toStringValue(a[1]);
    if (!s.fields.includes(f)) s.fields.push(f);
    s.data[0].set(f, a[2]);
    return s;
  });
  def(I, 'getfield', (a) => {
    const s = a[0];
    if (s.kind !== 'struct') throw new MError('Input must be a structure.');
    return s.getField(toStringValue(a[1]));
  });
  def(I, 'orderfields', (a) => {
    const s = (a[0] as StructArray).clone();
    s.fields.sort();
    return s;
  });
  def(I, 'struct2cell', (a) => {
    const s = a[0] as StructArray;
    return new CellArray(s.fields.length, 1, s.fields.map((f) => s.data[0].get(f)!));
  });
  def(I, 'cell2struct', (a) => {
    const c = a[0] as CellArray;
    const f = cellStrings(a[1]);
    return StructArray.scalar(f.map((n, i) => [n, c.data[i]]));
  });
  def(I, 'iscellstr', (a) => bool(a[0].kind === 'cell' && a[0].data.every((x) => x.kind === 'tensor' && x.cls === 'char')));
  def(I, 'cell2mat', (a) => {
    const c = a[0];
    if (c.kind !== 'cell') throw new MError('cell2mat: input must be a cell array.');
    if (!c.numel) return emptyTensor();
    const rows: Value[][] = [];
    for (let i = 0; i < c.rows; i++) {
      const r: Value[] = [];
      for (let j = 0; j < c.cols; j++) r.push(c.data[j * c.rows + i]);
      rows.push(r);
    }
    return concat(rows, 'matrix');
  });
  def(I, 'mat2cell', (a) => {
    const t = toTensor(a[0]);
    const rd = Array.from(toTensor(a[1]).re);
    const cd = a.length > 2 ? Array.from(toTensor(a[2]).re) : [t.cols];
    const out: Value[] = [];
    let r0 = 0;
    const cells = new CellArray(rd.length, cd.length, new Array(rd.length * cd.length));
    rd.forEach((rn, i) => {
      let c0 = 0;
      cd.forEach((cn, j) => {
        const sub = zeros(rn, cn, t.cls);
        for (let p = 0; p < rn; p++) for (let q = 0; q < cn; q++) sub.re[q * rn + p] = t.re[(c0 + q) * t.rows + r0 + p];
        cells.data[j * rd.length + i] = sub;
        c0 += cn;
      });
      r0 += rn;
    });
    void out;
    return cells;
  });
  def(I, ['cellfun', 'arrayfun'], (a, nargout, ctx) => {
    minArgs(a, 2);
    let f = a[0];
    // cellfun('isempty', c) legacy string form
    if (isStringLike(f)) {
      const nm = toStringValue(f);
      f = { kind: 'fhandle', h: { name: nm, src: `@${nm}` } } as any;
    }
    let uniform = true;
    let errorHandler: Value | null = null;
    const inputs: Value[] = [];
    for (let i = 1; i < a.length; i++) {
      if (isStringLike(a[i]) && i + 1 < a.length) {
        const k = toStringValue(a[i]).toLowerCase();
        if (k === 'uniformoutput') {
          uniform = toNumber(a[i + 1]) !== 0;
          i++;
          continue;
        }
        if (k === 'errorhandler') {
          errorHandler = a[i + 1];
          i++;
          continue;
        }
      }
      inputs.push(a[i]);
    }
    const isCell = ctx.name === 'cellfun';
    const n = inputs[0].numel;
    for (const x of inputs) if (x.numel !== n) throw new MError('All of the input arguments must be of the same size and shape.');
    const getEl = (x: Value, k: number): Value => {
      if (isCell) {
        if (x.kind !== 'cell') throw new MError('cellfun: inputs must be cell arrays.');
        return x.data[k];
      }
      if (x.kind === 'tensor') return new Tensor(1, 1, Float64Array.of(x.re[k]), x.im ? Float64Array.of(x.im[k]) : null, x.cls);
      if (x.kind === 'cell') return new CellArray(1, 1, [x.data[k]]);
      if (x.kind === 'struct') return new StructArray(1, 1, x.fields, [x.data[k]]);
      if (x.kind === 'string') return StringArray.scalar(x.data[k]);
      return x;
    };
    const nout = Math.max(1, nargout);
    const results: Value[][] = Array.from({ length: nout }, () => []);
    for (let k = 0; k < n; k++) {
      let r: Value[];
      try {
        r = ctx.interp.callHandle(f, inputs.map((x) => getEl(x, k)), nout, ctx.scope);
      } catch (e: any) {
        if (!errorHandler) throw e;
        const es = StructArray.scalar([['message', str(e.message)], ['identifier', str(e.identifier ?? '')], ['index', num(k + 1)]]);
        r = ctx.interp.callHandle(errorHandler, [es, ...inputs.map((x) => getEl(x, k))], nout, ctx.scope);
      }
      if (r.length < nout && nargout > 0) throw new MError('Too many output arguments.');
      for (let o = 0; o < nout; o++) results[o].push(r[o] ?? emptyTensor());
    }
    const shape = inputs[0];
    return results.map((list) => {
      if (!uniform) return new CellArray(shape.rows, shape.cols, list);
      const t = zeros(shape.rows, shape.cols, list.length && list.every((v) => v.kind === 'tensor' && v.cls === 'logical') ? 'logical' : list.length && list.every((v) => v.kind === 'tensor' && v.cls === 'char') ? 'char' : 'double');
      list.forEach((v, i) => {
        if (v.kind !== 'tensor' || v.numel !== 1) throw new MError("Non-scalar in Uniform output, at index " + (i + 1) + ". Set 'UniformOutput' to false.", 'MATLAB:cellfun:NotAScalarOutput');
        t.re[i] = v.re[0];
        if (v.im) {
          t.im = t.im ?? new Float64Array(t.numel);
          t.im[i] = v.im[0];
        }
      });
      return t;
    });
  });
  def(I, 'structfun', (a, _n, ctx) => {
    const s = a[1] as StructArray;
    let uniform = true;
    if (a.length > 3 && toStringValue(a[2]).toLowerCase() === 'uniformoutput') uniform = toNumber(a[3]) !== 0;
    const vals = s.fields.map((f) => ctx.interp.callHandle(a[0], [s.data[0].get(f)!], 1, ctx.scope)[0]);
    if (!uniform) return StructArray.scalar(s.fields.map((f, i) => [f, vals[i]]));
    const t = zeros(vals.length, 1);
    vals.forEach((v, i) => (t.re[i] = toNumber(v)));
    return t;
  });
  def(I, 'containers.Map', (a) => {
    // Lightweight Map emulation as struct with keys/values cells
    const keys = a.length ? cellStrings(a[0]) : [];
    const vals = a.length > 1 ? (a[1].kind === 'cell' ? a[1].data : [a[1]]) : [];
    return StructArray.scalar(keys.map((k, i) => [k.replace(/[^A-Za-z0-9_]/g, '_'), vals[i] ?? emptyTensor()]));
  });
  def(I, 'isKey', (a) => bool(a[0].kind === 'struct' && a[0].fields.includes(toStringValue(a[1]))));
  def(I, 'keys', (a) => cellOf((a[0] as StructArray).fields.map((f) => str(f))));
  def(I, 'values', (a) => cellOf((a[0] as StructArray).fields.map((f) => (a[0] as StructArray).data[0].get(f)!)));
  def(I, 'numfields', (a) => num(a[0].kind === 'struct' ? a[0].fields.length : 0));
  def(I, 'cellfun_internal', () => num(argNum([num(0)], 0)));
}
