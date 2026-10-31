import {
  CellArray, FuncHandle, MError, StringArray, StructArray, Tensor, bool, castTo, className, complexScalar, emptyTensor, isStringLike, num, str, toNumber, toStringValue, toTensor, zeros, rowVec,
  valuesEqual, type NumClass, type Value, INT_RANGE, cellOf, fromRows,
} from '../value';
import { displayValue, describeVar, displayBody } from '../display';
import { concat } from '../concat';
import { indexValue } from '../indexing';
import type { Interpreter } from '../interp';
import { argNum, argStr, argT, def, dimsArgs, mapReal, rng, boolT, minArgs } from './helpers';
import { colonRange } from '../ops';
import { formatSprintf } from './strings';

const HELP: Record<string, string> = {
  plot: 'plot(X,Y,LineSpec,Name,Value) creates a 2-D line plot.',
  zeros: 'zeros(n), zeros(m,n) create arrays of zeros.',
  sum: 'sum(A), sum(A,dim) sum of elements.',
  fzero: 'x = fzero(fun,x0) finds a root of a nonlinear function.',
  ode45: '[t,y] = ode45(odefun,tspan,y0) solves nonstiff differential equations.',
  gettable: 'T = gettable(name) returns the data in a Quanta data table as a struct with fields x, y (matrix), names.',
  puttable: "puttable(name, X, Y, 'Names', {...}, 'Kind', 'xy') creates or replaces a data table from workspace data.",
};

export function registerCore(I: Interpreter) {
  // ---------- constants ----------
  def(I, 'pi', () => num(Math.PI));
  def(I, ['Inf', 'inf'], (a) => fill(a, Infinity));
  def(I, ['NaN', 'nan'], (a) => fill(a, NaN));
  def(I, 'eps', (a) => {
    if (a.length === 1 && !isStringLike(a[0])) {
      const x = Math.abs(toNumber(a[0]));
      if (!Number.isFinite(x)) return num(NaN);
      if (x === 0) return num(Number.MIN_VALUE);
      return num(Math.pow(2, Math.floor(Math.log2(x)) - 52));
    }
    return fill(a, Number.EPSILON);
  });
  def(I, 'realmax', () => num(Number.MAX_VALUE));
  def(I, 'realmin', () => num(2.2250738585072014e-308));
  def(I, 'intmax', (a) => {
    const c = (a.length ? argStr(a, 0) : 'int32') as NumClass;
    return castTo(num(INT_RANGE[c]?.[1] ?? 2147483647), c);
  });
  def(I, 'intmin', (a) => {
    const c = (a.length ? argStr(a, 0) : 'int32') as NumClass;
    return castTo(num(INT_RANGE[c]?.[0] ?? -2147483648), c);
  });
  def(I, 'flintmax', () => num(9007199254740992));
  def(I, ['i', 'j', '1i', '1j'], () => complexScalar(0, 1));
  def(I, 'true', (a) => {
    const d = dimsArgs(a);
    const t = zeros(d.r, d.c, 'logical');
    t.re.fill(1);
    return t;
  });
  def(I, 'false', (a) => {
    const d = dimsArgs(a);
    return zeros(d.r, d.c, 'logical');
  });

  // ---------- constructors ----------
  def(I, 'zeros', (a) => {
    const d = dimsArgs(a);
    return zeros(d.r, d.c, d.cls);
  });
  def(I, 'ones', (a) => {
    const d = dimsArgs(a);
    const t = zeros(d.r, d.c, d.cls);
    t.re.fill(1);
    return t;
  });
  def(I, 'eye', (a) => {
    const d = dimsArgs(a);
    const t = zeros(d.r, d.c, d.cls);
    for (let k = 0; k < Math.min(d.r, d.c); k++) t.re[k * d.r + k] = 1;
    return t;
  });
  def(I, 'rand', (a) => {
    if (a.length && isStringLike(a[0]) && ['seed', 'state', 'twister'].includes(toStringValue(a[0]))) {
      if (a.length > 1) rng.seed(toNumber(a[1]));
      return [];
    }
    const d = dimsArgs(a);
    const t = zeros(d.r, d.c);
    for (let k = 0; k < t.numel; k++) t.re[k] = rng.next();
    return t;
  });
  def(I, 'randn', (a) => {
    const d = dimsArgs(a);
    const t = zeros(d.r, d.c);
    for (let k = 0; k < t.numel; k++) t.re[k] = rng.normal();
    return t;
  });
  def(I, 'randi', (a) => {
    minArgs(a, 1);
    const lim = argT(a, 0);
    const lo = lim.numel > 1 ? lim.re[0] : 1, hi = lim.numel > 1 ? lim.re[1] : lim.re[0];
    const d = dimsArgs(a.slice(1));
    const t = zeros(d.r, d.c);
    for (let k = 0; k < t.numel; k++) t.re[k] = lo + Math.floor(rng.next() * (hi - lo + 1));
    return t;
  });
  def(I, 'randperm', (a) => {
    const n = argNum(a, 0);
    const k = argNum(a, 1, n);
    const p = Array.from({ length: n }, (_, i) => i + 1);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    return rowVec(p.slice(0, k));
  });
  def(I, 'rng', (a) => {
    if (!a.length) return StructArray.scalar([['Type', str('twister')], ['Seed', num(0)]]);
    const v = a[0];
    if (isStringLike(v)) {
      const s = toStringValue(v);
      if (s === 'default') rng.seed(0);
      else if (s === 'shuffle') rng.seed(Date.now() % 1e9);
      else if (/^\d+$/.test(s)) rng.seed(Number(s));
    } else rng.seed(toNumber(v));
    return [];
  });
  def(I, 'linspace', (a) => {
    const x0 = argNum(a, 0), x1 = argNum(a, 1), n = Math.floor(argNum(a, 2, 100));
    if (n < 1) return zeros(1, 0);
    if (n === 1) return num(x1);
    const t = zeros(1, n);
    for (let k = 0; k < n; k++) t.re[k] = x0 + ((x1 - x0) * k) / (n - 1);
    t.re[n - 1] = x1;
    return t;
  });
  def(I, 'logspace', (a) => {
    const x0 = argNum(a, 0), x1 = argNum(a, 1), n = Math.floor(argNum(a, 2, 50));
    const t = zeros(1, n);
    for (let k = 0; k < n; k++) t.re[k] = Math.pow(10, n === 1 ? x1 : x0 + ((x1 - x0) * k) / (n - 1));
    return t;
  });
  def(I, 'colon', (a) => colonRange(argNum(a, 0), a.length > 2 ? argNum(a, 1) : 1, argNum(a, a.length > 2 ? 2 : 1)));
  def(I, 'magic', (a) => magic(argNum(a, 0)));
  def(I, 'peaks', (a, nargout) => {
    let xs: number[], ys: number[];
    if (a.length >= 2) {
      xs = Array.from(toTensor(a[0]).re);
      ys = Array.from(toTensor(a[1]).re);
    } else {
      const n = a.length ? toTensor(a[0]) : num(49);
      const v = n.numel === 1 ? Array.from({ length: n.re[0] }, (_, k) => -3 + (6 * k) / Math.max(1, n.re[0] - 1)) : Array.from(n.re);
      xs = v;
      ys = v;
    }
    const grid = a.length >= 2 && toTensor(a[0]).rows > 1 && toTensor(a[0]).cols > 1;
    const rows = grid ? toTensor(a[0]).rows : ys.length, cols = grid ? toTensor(a[0]).cols : xs.length;
    const X = zeros(rows, cols), Y = zeros(rows, cols), Z = zeros(rows, cols);
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++) {
        const k = j * rows + i;
        const x = grid ? xs[k] : xs[j], y = grid ? ys[k] : ys[i];
        X.re[k] = x;
        Y.re[k] = y;
        Z.re[k] = 3 * (1 - x) ** 2 * Math.exp(-(x ** 2) - (y + 1) ** 2) - 10 * (x / 5 - x ** 3 - y ** 5) * Math.exp(-(x ** 2) - y ** 2) - (1 / 3) * Math.exp(-((x + 1) ** 2) - y ** 2);
      }
    return nargout >= 3 ? [X, Y, Z] : [Z];
  });
  def(I, 'diag', (a) => {
    const t = argT(a, 0);
    const k = argNum(a, 1, 0);
    if (t.rows === 1 || t.cols === 1) {
      const n = t.numel + Math.abs(k);
      const out = zeros(n, n);
      if (t.im) out.im = new Float64Array(n * n);
      for (let i = 0; i < t.numel; i++) {
        const r = k >= 0 ? i : i - k, c = k >= 0 ? i + k : i;
        out.re[c * n + r] = t.re[i];
        if (t.im) out.im![c * n + r] = t.im[i];
      }
      return out;
    }
    const vals: number[] = [];
    for (let i = 0; i < t.rows; i++) {
      const j = i + k;
      if (j >= 0 && j < t.cols) vals.push(t.re[j * t.rows + i]);
    }
    return new Tensor(vals.length, 1, Float64Array.from(vals));
  });
  def(I, 'repmat', (a) => {
    minArgs(a, 2);
    const v = a[0];
    const d = dimsArgs(a.slice(1));
    const row = Array(d.c).fill(v);
    return concat(Array.from({ length: d.r }, () => row), v.kind === 'cell' ? 'cell' : 'matrix');
  });
  def(I, 'reshape', (a) => {
    minArgs(a, 2);
    const v = a[0];
    let r: number, c: number;
    if (a.length === 2) {
      const d = toTensor(a[1]);
      r = d.re[0];
      c = d.re[1];
      for (let k = 2; k < d.numel; k++) if (d.re[k] !== 1) throw new MError('N-dimensional arrays are not supported.');
    } else {
      const dimsList = a.slice(1).map((x) => (x.kind === 'tensor' && x.numel === 0 ? NaN : toNumber(x)));
      const known = dimsList.filter((x) => !Number.isNaN(x)).reduce((p, x) => p * x, 1);
      const filled = dimsList.map((x) => (Number.isNaN(x) ? v.numel / known : x));
      r = filled[0];
      c = filled[1];
      for (let k = 2; k < filled.length; k++) if (filled[k] !== 1) throw new MError('N-dimensional arrays are not supported.');
    }
    if (r * c !== v.numel || !Number.isInteger(r) || !Number.isInteger(c)) throw new MError(`Number of elements must not change. Use [] as one of the size inputs to automatically calculate the appropriate size for that dimension.`, 'MATLAB:getReshapeDims:notSameNumel');
    if (v.kind === 'tensor') return new Tensor(r, c, v.re, v.im, v.cls);
    if (v.kind === 'cell') return new CellArray(r, c, v.data);
    if (v.kind === 'string') return new StringArray(r, c, v.data);
    if (v.kind === 'struct') return new StructArray(r, c, v.fields, v.data);
    return v;
  });
  def(I, 'cat', (a) => {
    const dim = argNum(a, 0);
    const vals = a.slice(1);
    if (dim === 1) return concat(vals.map((v) => [v]), 'matrix');
    if (dim === 2) return concat([vals], 'matrix');
    throw new MError('N-dimensional arrays are not supported.');
  });
  def(I, 'horzcat', (a) => concat([a], 'matrix'));
  def(I, 'vertcat', (a) => concat(a.map((v) => [v]), 'matrix'));
  def(I, ['meshgrid', 'ndgrid'], (a, nargout, ctx) => {
    const x = argT(a, 0);
    const y = a.length > 1 ? argT(a, 1) : x;
    const nd = ctx.name === 'ndgrid';
    const xs = Array.from(x.re), ys = Array.from(y.re);
    const r = nd ? xs.length : ys.length, c = nd ? ys.length : xs.length;
    const X = zeros(r, c), Y = zeros(r, c);
    for (let i = 0; i < r; i++)
      for (let j = 0; j < c; j++) {
        X.re[j * r + i] = nd ? xs[i] : xs[j];
        Y.re[j * r + i] = nd ? ys[j] : ys[i];
      }
    return [X, Y];
  });

  // ---------- size & type ----------
  def(I, 'size', (a, nargout) => {
    minArgs(a, 1);
    const v = a[0];
    const dims = [v.rows, v.cols];
    if (a.length > 1) {
      const d = argNum(a, 1);
      return num(d <= 2 ? dims[d - 1] : 1);
    }
    if (nargout <= 1) return rowVec(dims);
    const out: Value[] = [];
    for (let k = 0; k < nargout; k++) out.push(num(k < 2 ? (k === nargout - 1 && k === 0 ? v.numel : dims[k]) : 1));
    if (nargout === 1) return [rowVec(dims)];
    return out;
  });
  def(I, 'numel', (a) => num(a[0]?.numel ?? 0));
  def(I, 'length', (a) => num(a[0] && a[0].numel ? Math.max(a[0].rows, a[0].cols) : 0));
  def(I, 'ndims', () => num(2));
  def(I, 'isempty', (a) => bool((a[0]?.numel ?? 0) === 0));
  def(I, 'isscalar', (a) => bool(a[0]?.numel === 1));
  def(I, 'isvector', (a) => bool(!!a[0] && (a[0].rows === 1 || a[0].cols === 1) && a[0].numel >= 1));
  def(I, 'isrow', (a) => bool(a[0]?.rows === 1));
  def(I, 'iscolumn', (a) => bool(a[0]?.cols === 1));
  def(I, 'ismatrix', () => bool(true));
  def(I, 'issquare', (a) => bool(a[0]?.rows === a[0]?.cols));
  def(I, 'isnumeric', (a) => bool(a[0]?.kind === 'tensor' && a[0].cls !== 'char' && a[0].cls !== 'logical'));
  def(I, 'isfloat', (a) => bool(a[0]?.kind === 'tensor' && (a[0].cls === 'double' || a[0].cls === 'single')));
  def(I, 'isinteger', (a) => bool(a[0]?.kind === 'tensor' && a[0].cls in INT_RANGE));
  def(I, 'ischar', (a) => bool(a[0]?.kind === 'tensor' && a[0].cls === 'char'));
  def(I, 'iscell', (a) => bool(a[0]?.kind === 'cell'));
  def(I, 'isstruct', (a) => bool(a[0]?.kind === 'struct'));
  def(I, 'islogical', (a) => bool(a[0]?.kind === 'tensor' && a[0].cls === 'logical'));
  def(I, 'isstring', (a) => bool(a[0]?.kind === 'string'));
  def(I, 'isreal', (a) => bool(!(a[0]?.kind === 'tensor' && a[0].im)));
  def(I, 'is_function_handle', (a) => bool(a[0]?.kind === 'fhandle'));
  def(I, 'isa', (a) => {
    const c = argStr(a, 1);
    const k = className(a[0]);
    if (c === 'numeric') return bool(a[0].kind === 'tensor' && a[0].cls !== 'char' && a[0].cls !== 'logical');
    if (c === 'float') return bool(k === 'double' || k === 'single');
    if (c === 'integer') return bool(k in INT_RANGE);
    return bool(k === c);
  });
  def(I, 'class', (a) => str(className(a[0])));
  for (const c of ['double', 'single', 'logical', 'int8', 'int16', 'int32', 'int64', 'uint8', 'uint16', 'uint32', 'uint64'] as NumClass[]) {
    def(I, c, (a) => {
      if (!a.length) return castTo(num(0), c);
      const v = a[0];
      if (v.kind === 'string') {
        if (c !== 'double') throw new MError(`Conversion to ${c} from string is not possible.`);
        const t = zeros(v.rows, v.cols);
        v.data.forEach((s, i) => (t.re[i] = s.trim() === '' ? NaN : Number(s)));
        return t;
      }
      if (v.kind === 'cell') throw new MError(`Conversion to ${c} from cell is not possible.`);
      return castTo(toTensor(v), c);
    });
  }
  def(I, 'cast', (a) => castTo(argT(a, 0), argStr(a, 1) as NumClass));

  // ---------- output ----------
  def(I, 'disp', (a, _n, ctx) => {
    minArgs(a, 1);
    const v = a[0];
    if (v.kind === 'tensor' && v.cls === 'char') {
      ctx.interp.print(v.rows > 1 ? v.rowStrings().join('\n') + '\n' : v.toStr() + '\n');
      return;
    }
    if (v.kind === 'string') {
      ctx.interp.print(v.data.join('\n') + '\n');
      return;
    }
    if (v.kind === 'tensor' && v.numel === 0) return;
    const body = displayBody(v, { ...ctx.interp.display, compact: true });
    ctx.interp.print(body.split('\n').map((l) => (v.kind === 'tensor' && v.numel === 1 ? l.trimStart().padStart(l.trim().length + 4) : l)).join('\n') + '\n');
  });
  def(I, 'display', (a, _n, ctx) => ctx.interp.print(displayValue('ans', a[0], ctx.interp.display)));
  def(I, 'fprintf', (a, _n, ctx) => {
    if (!a.length) return;
    let args = a;
    if (a[0].kind === 'tensor' && a[0].cls !== 'char' && a[0].numel === 1 && a.length > 1 && isStringLike(a[1])) {
      const fid = toNumber(a[0]);
      args = a.slice(1);
      if (fid !== 1 && fid !== 2) {
        ctx.interp.print(formatSprintf(toStringValue(args[0]), args.slice(1)));
        return;
      }
    }
    const fmt = isStringLike(args[0]) ? toStringValue(args[0]) : '%g\n';
    const rest = isStringLike(args[0]) ? args.slice(1) : args;
    ctx.interp.print(formatSprintf(fmt, rest));
  });
  def(I, 'clc', (_a, _n, ctx) => {
    ctx.interp.print('\x1b[clear]');
  });
  def(I, 'format', (a, _n, ctx) => {
    const d = ctx.interp.display;
    if (!a.length) {
      d.format = 'short';
      d.compact = false;
      return;
    }
    for (const s of a.map((x) => toStringValue(x).toLowerCase())) {
      if (s === 'compact') d.compact = true;
      else if (s === 'loose') d.compact = false;
      else if (s === 'long') d.format = 'long';
      else if (s === 'short') d.format = 'short';
      else if (s === 'longg') d.format = 'longG';
      else if (s === 'shortg') d.format = 'shortG';
      else if (s === 'longe') d.format = 'longE';
      else if (s === 'shorte') d.format = 'shortE';
      else if (s === 'bank') d.format = 'bank';
      else if (s === 'rat') d.format = 'rat';
      else if (s === 'g') d.format = d.format === 'long' ? 'longG' : 'shortG';
      else if (s === 'e') d.format = d.format === 'long' ? 'longE' : 'shortE';
    }
  });
  def(I, 'more', () => []);
  def(I, 'beep', () => []);
  def(I, 'drawnow', () => []);
  def(I, 'pause', () => []);
  def(I, 'input', () => {
    throw new MError('input() is not supported in Quanta Studio. Define variables in the script instead.');
  });
  def(I, 'keyboard', () => []);

  // ---------- workspace ----------
  def(I, ['clear', 'clearvars'], (a, _n, ctx) => {
    const scope = ctx.scope;
    const names = a.map((x) => toStringValue(x));
    if (!names.length || names.includes('all') || names.includes('-all') || names.includes('variables')) {
      scope.vars.clear();
      if (names.includes('all') || names.includes('-all')) ctx.interp.globals.clear();
      return;
    }
    if (names[0] === 'global') {
      ctx.interp.globals.clear();
      return;
    }
    if (names[0] === 'functions') return;
    for (const n of names) {
      if (n.includes('*')) {
        const re = new RegExp('^' + n.replace(/\*/g, '.*') + '$');
        for (const k of [...scope.vars.keys()]) if (re.test(k)) scope.vars.delete(k);
      } else scope.vars.delete(n);
    }
  });
  def(I, 'who', (_a, nargout, ctx) => {
    const names = [...ctx.scope.vars.keys()].sort();
    if (nargout > 0) return cellOf(names.map((n) => str(n)), names.length, 1);
    ctx.interp.print(names.length ? `Your variables are:\n\n${names.join('  ')}\n\n` : '');
  });
  def(I, 'whos', (_a, _n, ctx) => {
    const rows = [...ctx.scope.vars.entries()].sort((x, y) => x[0].localeCompare(y[0]));
    if (!rows.length) return;
    const lines = ['  Name' + ' '.repeat(10) + 'Size' + ' '.repeat(12) + 'Bytes  Class     Attributes', ''];
    for (const [n, v] of rows) {
      const d = describeVar(v);
      lines.push(`  ${n.padEnd(14)}${d.size.padEnd(16)}${String(d.bytes).padStart(5)}  ${d.cls}`);
    }
    ctx.interp.print(lines.join('\n') + '\n\n');
  });
  def(I, 'exist', (a, _n, ctx) => {
    const n = argStr(a, 0);
    if (ctx.interp.hasVar(ctx.scope, n)) return num(1);
    if (ctx.interp.findFunction(n, ctx.scope)) return num(2);
    if (ctx.interp.builtins.has(n)) return num(5);
    return num(0);
  });
  def(I, 'isvarname', (a) => bool(/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(argStr(a, 0))));
  def(I, 'nargin', (a, _n, ctx) => {
    if (a.length) {
      const f = ctx.interp.findFunction(toStringValue(a[0]), ctx.scope);
      return num(f ? f.def.params.length : -1);
    }
    return num(ctx.scope.nargin);
  });
  def(I, 'nargout', (_a, _n, ctx) => num(ctx.scope.nargout));
  def(I, 'narginchk', (a, _n, ctx) => {
    const lo = argNum(a, 0), hi = argNum(a, 1);
    if (ctx.scope.nargin < lo) throw new MError('Not enough input arguments.', 'MATLAB:narginchk:notEnoughInputs');
    if (ctx.scope.nargin > hi) throw new MError('Too many input arguments.', 'MATLAB:narginchk:tooManyInputs');
  });
  def(I, 'nargoutchk', () => []);
  def(I, 'inputname', () => str(''));
  def(I, 'mfilename', (_a, _n, ctx) => str(ctx.scope.file?.name ?? ''));

  // ---------- time ----------
  def(I, 'tic', (_a, nargout, ctx) => {
    ctx.interp.tic = performance.now();
    if (nargout > 0) return num(ctx.interp.tic);
  });
  def(I, 'toc', (a, nargout, ctx) => {
    const start = a.length ? toNumber(a[0]) : ctx.interp.tic;
    const el = (performance.now() - start) / 1000;
    if (nargout > 0) return num(el);
    ctx.interp.print(`Elapsed time is ${el.toFixed(6)} seconds.\n`);
  });
  def(I, 'cputime', () => num(performance.now() / 1000));
  def(I, 'now', () => num(Date.now() / 86400000 + 719529));
  def(I, 'clock', () => {
    const d = new Date();
    return rowVec([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds() + d.getMilliseconds() / 1000]);
  });
  def(I, 'date', () => {
    const d = new Date();
    const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
    return str(`${String(d.getDate()).padStart(2, '0')}-${m}-${d.getFullYear()}`);
  });
  def(I, 'datestr', (a) => {
    const d = a.length ? new Date((toNumber(a[0]) - 719529) * 86400000) : new Date();
    return str(d.toISOString().replace('T', ' ').slice(0, 19));
  });
  def(I, 'version', () => str('Quanta Studio 1.0 (MATLAB-compatible language)'));
  def(I, 'computer', () => str('QUANTA64'));
  def(I, 'ver', (_a, _n, ctx) => ctx.interp.print('Quanta Studio Version 1.0\nMATLAB-compatible numerical computing engine\n'));
  def(I, ['help', 'doc', 'lookfor'], (a, _n, ctx) => {
    const n = a.length ? toStringValue(a[0]) : '';
    if (!n) {
      ctx.interp.print('Quanta Studio supports a large subset of the MATLAB language. Try: help plot, help ode45.\nUse the Claude panel to ask questions about functions and your data.\n');
      return;
    }
    const exists = ctx.interp.builtins.has(n) || !!ctx.interp.findFunction(n, ctx.scope);
    ctx.interp.print(HELP[n] ? `  ${HELP[n]}\n` : exists ? `  ${n} is a built-in function.\n` : `  ${n} not found.\n`);
  });
  def(I, ['pkg', 'warning'], (a, _n, ctx) => {
    if (ctx.name === 'pkg') return;
    if (!a.length) return;
    const first = toStringValue(a[0]);
    if (['on', 'off', 'query', 'error'].includes(first)) return;
    let msg = first;
    let rest = a.slice(1);
    if (/^[A-Za-z][\w]*(:[\w]+)+$/.test(first) && a.length > 1) {
      msg = toStringValue(a[1]);
      rest = a.slice(2);
    }
    ctx.interp.warn(rest.length ? formatSprintf(msg, rest) : msg);
  });
  def(I, 'lastwarn', (_a, _n, ctx) => str(ctx.interp.lastWarning));
  def(I, 'lasterr', (_a, _n, ctx) => str(((ctx.interp as any).lastError as MError | undefined)?.message ?? ''));

  // ---------- errors ----------
  def(I, 'error', (a) => {
    if (!a.length) return;
    if (a[0].kind === 'struct') {
      const s = a[0];
      throw new MError(toStringValue(s.getField('message')), s.fields.includes('identifier') ? toStringValue(s.getField('identifier')) : '');
    }
    const first = toStringValue(a[0]);
    if (/^[A-Za-z][\w]*(:[\w-]+)+$/.test(first) && a.length > 1) throw new MError(formatSprintf(toStringValue(a[1]), a.slice(2)), first);
    throw new MError(a.length > 1 ? formatSprintf(first, a.slice(1)) : first);
  });
  def(I, 'MException', (a) => {
    const id = argStr(a, 0);
    const msg = a.length > 1 ? formatSprintf(argStr(a, 1), a.slice(2)) : '';
    const s = StructArray.scalar([['identifier', str(id)], ['message', str(msg)], ['stack', StructArray.scalar()]]);
    (s as any).isException = true;
    return s;
  });
  def(I, ['throw', 'rethrow'], (a) => {
    const s = a[0];
    if (s?.kind !== 'struct') throw new MError('Expected an MException object.');
    throw new MError(toStringValue(s.getField('message')), toStringValue(s.getField('identifier')));
  });
  def(I, 'getReport', (a) => (a[0]?.kind === 'struct' ? a[0].getField('message') : str('')));
  def(I, 'assert', (a) => {
    minArgs(a, 1);
    const c = a[0];
    let ok: boolean;
    if (a.length >= 2 && !isStringLike(a[1])) {
      const tol = a.length >= 3 && !isStringLike(a[2]) ? toNumber(a[2]) : 0;
      if (tol) {
        const x = toTensor(a[0]), y = toTensor(a[1]);
        ok = x.numel === y.numel && Array.from(x.re).every((v, k) => Math.abs(v - y.re[k]) <= (tol < 0 ? Math.abs(tol * y.re[k]) : tol));
      } else ok = valuesEqual(a[0], a[1]);
      if (!ok) throw new MError('Assertion failed.', 'MATLAB:assertion:failed');
      return;
    }
    ok = c.kind === 'tensor' ? c.numel > 0 && Array.from(c.re).every((v) => v !== 0) : false;
    if (!ok) throw new MError(a.length > 1 ? formatSprintf(toStringValue(a[1]), a.slice(2)) : 'Assertion failed.', 'MATLAB:assertion:failed');
  });
  def(I, 'isequal', (a) => {
    minArgs(a, 2);
    for (let k = 1; k < a.length; k++) if (!looseEqual(a[0], a[k])) return bool(false);
    return bool(true);
  });
  def(I, 'isequaln', (a) => {
    minArgs(a, 2);
    for (let k = 1; k < a.length; k++) if (!looseEqual(a[0], a[k], true)) return bool(false);
    return bool(true);
  });
  def(I, 'deal', (a, nargout) => {
    const n = Math.max(1, nargout);
    if (a.length === 1) return Array(n).fill(a[0]);
    if (a.length !== n) throw new MError('The number of outputs should match the number of inputs.');
    return a;
  });

  // ---------- functions ----------
  def(I, 'feval', (a, nargout, ctx) => {
    minArgs(a, 1);
    return ctx.interp.callHandle(a[0], a.slice(1), nargout, ctx.scope);
  });
  def(I, 'func2str', (a) => str(a[0]?.kind === 'fhandle' ? a[0].toString() : toStringValue(a[0])));
  def(I, 'str2func', (a, _n, ctx) => {
    const s = argStr(a, 0).trim();
    if (s.startsWith('@')) return ctx.interp.evaluateToValue(s);
    return new FuncHandle({ name: s, src: `@${s}` });
  });
  def(I, ['eval', 'evalc'], (a, nargout, ctx) => {
    const code = argStr(a, 0);
    const interp = ctx.interp;
    let captured = '';
    const origPrint = interp.io.print;
    if (ctx.name === 'evalc') interp.io.print = (s) => (captured += s);
    try {
      if (nargout > 0 && ctx.name === 'eval') {
        try {
          return interp.evaluateToValue(code);
        } catch (e) {
          if (a.length > 1) return interp.evaluateToValue(argStr(a, 1));
          throw e;
        }
      }
      const ok = runInScope(interp, code, ctx.scope);
      if (!ok.ok && a.length > 1) runInScope(interp, argStr(a, 1), ctx.scope);
      else if (!ok.ok) throw ok.err;
    } finally {
      interp.io.print = origPrint;
    }
    if (ctx.name === 'evalc') return str(captured);
  });
  def(I, 'evalin', (a, nargout, ctx) => {
    const code = argStr(a, 1);
    if (nargout > 0) return ctx.interp.evaluateToValue(code);
    const r = runInScope(ctx.interp, code, ctx.interp.base);
    if (!r.ok) throw r.err;
  });
  def(I, 'assignin', (a, _n, ctx) => {
    ctx.interp.base.vars.set(argStr(a, 1), a[2]);
  });
  def(I, 'run', (a, _n, ctx) => {
    const name = argStr(a, 0).replace(/\.m$/, '');
    const hook = ctx.interp.builtins.get('__runscript__');
    if (!hook) throw new MError(`Undefined script '${name}'.`);
    hook([str(name)], 0, ctx);
  });
  def(I, '__getprop__', () => undefined as any);
  def(I, 'builtin', (a, nargout, ctx) => {
    const n = argStr(a, 0);
    const b = ctx.interp.builtins.get(n);
    if (!b) throw new MError(`Undefined builtin '${n}'.`);
    const r = b(a.slice(1), nargout, ctx);
    return r === undefined ? [] : r;
  });
  def(I, 'onCleanup', () => StructArray.scalar());
  def(I, 'validateattributes', () => []);
  def(I, 'inputParser', () => StructArray.scalar());
  def(I, 'isdeployed', () => bool(false));
  def(I, 'ispc', () => bool(false));
  def(I, 'isunix', () => bool(true));
  def(I, 'ismac', () => bool(false));
  def(I, 'usejava', () => bool(false));
  def(I, 'exit', () => {
    throw new MError('exit is not available inside Quanta Studio.');
  });
  def(I, 'subsref', (a, nargout) => {
    void nargout;
    return indexValue(a[0], [a[1]]);
  });
  def(I, 'struct2table', (a) => a[0]);
  def(I, 'boolT', (a) => boolT(!!toNumber(a[0])));
  def(I, '__fromRows__', () => fromRows([[0]]));
  void mapReal;
  void emptyTensor;
}

function runInScope(interp: Interpreter, code: string, scope: any): { ok: boolean; err?: MError } {
  // Run code in the given scope by temporarily swapping the base scope's variables.
  const saveBase = interp.base;
  try {
    (interp as any).base = scope;
    interp.run(code, { throwErrors: true });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, err: e instanceof MError ? e : new MError(String(e?.message ?? e)) };
  } finally {
    (interp as any).base = saveBase;
  }
}

function looseEqual(a: Value, b: Value, nanEqual = false): boolean {
  if (a.kind === 'tensor' && b.kind === 'tensor') {
    if (a.rows !== b.rows || a.cols !== b.cols) return false;
    for (let i = 0; i < a.numel; i++) {
      const x = a.re[i], y = b.re[i];
      if (x !== y && !(nanEqual && Number.isNaN(x) && Number.isNaN(y))) return false;
      if ((a.im?.[i] ?? 0) !== (b.im?.[i] ?? 0)) return false;
    }
    return true;
  }
  if (a.kind === 'cell' && b.kind === 'cell') return a.rows === b.rows && a.cols === b.cols && a.data.every((v, i) => looseEqual(v, b.data[i], nanEqual));
  if (a.kind === 'struct' && b.kind === 'struct') {
    if (a.numel !== b.numel || a.fields.length !== b.fields.length) return false;
    return a.data.every((m, i) => a.fields.every((f) => b.data[i].has(f) && looseEqual(m.get(f)!, b.data[i].get(f)!, nanEqual)));
  }
  return valuesEqual(a, b);
}

function fill(a: Value[], v: number): Tensor {
  const d = dimsArgs(a);
  const t = zeros(d.r, d.c, d.cls);
  t.re.fill(v);
  return t;
}

export function magic(n: number): Tensor {
  n = Math.floor(n);
  if (n < 1) return zeros(0, 0);
  if (n === 2) return fromRows([[4, 3], [1, 2]]);
  const M: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  if (n % 2 === 1) {
    // MATLAB's odd-order construction
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const I = i + 1, J = j + 1;
        const A = ((I + J - (n + 3) / 2) % n + n) % n;
        const B = ((I + 2 * J - 2) % n + n) % n;
        M[i][j] = n * A + B + 1;
      }
  } else if (n % 4 === 0) {
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const v = i * n + j + 1;
        const keep = ((i % 4 === 0 || i % 4 === 3) && (j % 4 === 0 || j % 4 === 3)) || ((i % 4 === 1 || i % 4 === 2) && (j % 4 === 1 || j % 4 === 2));
        M[i][j] = keep ? n * n + 1 - v : v;
      }
  } else {
    // singly even: LUX method (matches MATLAB)
    const p = n / 2;
    const A = magic(p);
    const a = (r: number, c: number) => A.re[c * p + r];
    for (let i = 0; i < p; i++)
      for (let j = 0; j < p; j++) {
        M[i][j] = a(i, j);
        M[i + p][j + p] = a(i, j) + p * p;
        M[i][j + p] = a(i, j) + 2 * p * p;
        M[i + p][j] = a(i, j) + 3 * p * p;
      }
    const k = (n - 2) / 4;
    for (let i = 0; i < p; i++) {
      const cols: number[] = [];
      for (let j = 0; j < k; j++) cols.push(j);
      for (let j = n - k + 1; j < n; j++) cols.push(j);
      for (const j of cols) {
        let jj = j;
        if (i === Math.floor(p / 2) && j < k) jj = j + 1;
        const t = M[i][jj];
        M[i][jj] = M[i + p][jj];
        M[i + p][jj] = t;
      }
    }
  }
  return fromRows(M);
}

export { describeVar };
