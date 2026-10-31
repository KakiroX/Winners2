import { CellArray, MError, Tensor, bool, isStringLike, num, toNumber, toStringValue, toTensor, zeros, rowVec, colVec, type Value, isIntClass, saturate, StringArray, cellOf, str } from '../value';
import type { Interpreter } from '../interp';
import { argNum, argT, cumulate, def, defaultDim, getDim, hasFlag, mapBool, mapReal, minArgs, reduce, stripFlags } from './helpers';
import { gamma as gammaFn, lgamma, erf, erfc, erfinv, betaInc, gammaP } from '../../stats/distributions';
import { percentileLinear } from '../../stats/descriptive';
import { binaryOp, cpow } from '../ops';

function mapC(t: Tensor, f: (re: number, im: number) => [number, number], realF?: (x: number) => number, needsComplex?: (x: number) => boolean): Tensor {
  if (!t.im && realF && !(needsComplex && Array.from(t.re).some(needsComplex))) {
    return mapReal(t, realF, t.cls === 'single' ? 'single' : 'double');
  }
  const out = new Tensor(t.rows, t.cols, new Float64Array(t.numel), new Float64Array(t.numel));
  for (let i = 0; i < t.numel; i++) {
    const [a, b] = f(t.re[i], t.im ? t.im[i] : 0);
    out.re[i] = a;
    out.im![i] = b;
  }
  return out.simplify();
}

const csqrt = (a: number, b: number): [number, number] => {
  if (b === 0) return a >= 0 ? [Math.sqrt(a), 0] : [0, Math.sqrt(-a)];
  const m = Math.hypot(a, b);
  const r = Math.sqrt((m + a) / 2);
  const i = Math.sign(b) * Math.sqrt((m - a) / 2);
  return [r, i];
};
const cexp = (a: number, b: number): [number, number] => {
  const m = Math.exp(a);
  return b === 0 ? [m, 0] : [m * Math.cos(b), m * Math.sin(b)];
};
const clog = (a: number, b: number): [number, number] => [Math.log(Math.hypot(a, b)), Math.atan2(b, a)];

function elementwise(I: Interpreter, name: string, f: (x: number) => number, cf?: (a: number, b: number) => [number, number], needsComplex?: (x: number) => boolean) {
  def(I, name, (a) => {
    minArgs(a, 1);
    const t = toTensor(a[0], name);
    if (cf) return mapC(t, cf, f, needsComplex);
    if (t.im) throw new MError(`${name} does not support complex input.`);
    const out = mapReal(t, f, t.cls === 'single' ? 'single' : 'double');
    return out;
  });
}

function sortKey(t: Tensor, i: number) {
  return t.im ? Math.hypot(t.re[i], t.im[i]) : t.re[i];
}

export function registerMath(I: Interpreter) {
  elementwise(I, 'sqrt', Math.sqrt, csqrt, (x) => x < 0);
  elementwise(I, 'exp', Math.exp, cexp);
  elementwise(I, 'log', Math.log, clog, (x) => x < 0);
  elementwise(I, 'log10', Math.log10, (a, b) => {
    const [r, i] = clog(a, b);
    return [r / Math.LN10, i / Math.LN10];
  }, (x) => x < 0);
  elementwise(I, 'log2', Math.log2, (a, b) => {
    const [r, i] = clog(a, b);
    return [r / Math.LN2, i / Math.LN2];
  }, (x) => x < 0);
  elementwise(I, 'log1p', Math.log1p);
  elementwise(I, 'expm1', Math.expm1);
  elementwise(I, 'sin', Math.sin, (a, b) => [Math.sin(a) * Math.cosh(b), Math.cos(a) * Math.sinh(b)]);
  elementwise(I, 'cos', Math.cos, (a, b) => [Math.cos(a) * Math.cosh(b), -Math.sin(a) * Math.sinh(b)]);
  elementwise(I, 'tan', Math.tan);
  elementwise(I, 'asin', Math.asin);
  elementwise(I, 'acos', Math.acos);
  elementwise(I, 'atan', Math.atan);
  elementwise(I, 'sinh', Math.sinh);
  elementwise(I, 'cosh', Math.cosh);
  elementwise(I, 'tanh', Math.tanh);
  elementwise(I, 'asinh', Math.asinh);
  elementwise(I, 'acosh', Math.acosh);
  elementwise(I, 'atanh', Math.atanh);
  elementwise(I, 'sec', (x) => 1 / Math.cos(x));
  elementwise(I, 'csc', (x) => 1 / Math.sin(x));
  elementwise(I, 'cot', (x) => 1 / Math.tan(x));
  elementwise(I, 'sind', (x) => (x % 180 === 0 ? 0 : Math.sin((x * Math.PI) / 180)));
  elementwise(I, 'cosd', (x) => ((x - 90) % 180 === 0 ? 0 : Math.cos((x * Math.PI) / 180)));
  elementwise(I, 'tand', (x) => Math.tan((x * Math.PI) / 180));
  elementwise(I, 'asind', (x) => (Math.asin(x) * 180) / Math.PI);
  elementwise(I, 'acosd', (x) => (Math.acos(x) * 180) / Math.PI);
  elementwise(I, 'atand', (x) => (Math.atan(x) * 180) / Math.PI);
  elementwise(I, 'deg2rad', (x) => (x * Math.PI) / 180);
  elementwise(I, 'rad2deg', (x) => (x * 180) / Math.PI);
  elementwise(I, 'gamma', gammaFn);
  elementwise(I, 'gammaln', lgamma);
  elementwise(I, 'erf', erf);
  elementwise(I, 'erfc', erfc);
  elementwise(I, 'erfinv', erfinv);
  elementwise(I, 'erfcinv', (y) => erfinv(1 - y));
  elementwise(I, 'factorial', (n) => (n < 0 || !Number.isInteger(n) ? NaN : n > 170 ? Infinity : Math.round(gammaFn(n + 1))));
  elementwise(I, 'nthroot_1', (x) => x);
  elementwise(I, 'cbrt', Math.cbrt);
  elementwise(I, 'sign', Math.sign);
  elementwise(I, 'fix', Math.trunc);

  for (const [name, f] of [['floor', Math.floor], ['ceil', Math.ceil]] as const) {
    def(I, name, (a) => {
      const t = argT(a, 0, name);
      const out = mapReal(t, f, isIntClass(t.cls) ? t.cls : t.cls === 'single' ? 'single' : 'double');
      if (t.im) out.im = t.im.map(f);
      return out;
    });
  }
  def(I, 'round', (a) => {
    const t = argT(a, 0, 'round');
    const d = a.length > 1 && !isStringLike(a[1]) ? toNumber(a[1]) : 0;
    const sig = a.length > 2 && toStringValue(a[2]) === 'significant';
    const r = (x: number) => {
      if (!Number.isFinite(x)) return x;
      if (sig) {
        if (x === 0) return 0;
        const p = d - Math.ceil(Math.log10(Math.abs(x)));
        const m = Math.pow(10, p);
        return Math.sign(x) * Math.round(Math.abs(x) * m) / m;
      }
      const m = Math.pow(10, d);
      return (Math.sign(x) * Math.round(Math.abs(x) * m)) / m;
    };
    const out = mapReal(t, r, isIntClass(t.cls) ? t.cls : 'double');
    if (t.im) out.im = t.im.map(r);
    return out;
  });
  def(I, 'abs', (a) => {
    const t = argT(a, 0, 'abs');
    if (t.im) {
      const out = zeros(t.rows, t.cols);
      for (let i = 0; i < t.numel; i++) out.re[i] = Math.hypot(t.re[i], t.im[i]);
      return out;
    }
    return mapReal(t, Math.abs, isIntClass(t.cls) || t.cls === 'single' ? t.cls : 'double');
  });
  def(I, 'real', (a) => {
    const t = argT(a, 0);
    return new Tensor(t.rows, t.cols, Float64Array.from(t.re), null, t.cls === 'char' || t.cls === 'logical' ? 'double' : t.cls);
  });
  def(I, 'imag', (a) => {
    const t = argT(a, 0);
    return new Tensor(t.rows, t.cols, t.im ? Float64Array.from(t.im) : new Float64Array(t.numel));
  });
  def(I, 'conj', (a) => {
    const t = argT(a, 0);
    return new Tensor(t.rows, t.cols, Float64Array.from(t.re), t.im ? t.im.map((v) => -v) : null, t.cls);
  });
  def(I, ['angle', 'arg'], (a) => {
    const t = argT(a, 0);
    const out = zeros(t.rows, t.cols);
    for (let i = 0; i < t.numel; i++) out.re[i] = Math.atan2(t.im ? t.im[i] : 0, t.re[i]);
    return out;
  });
  def(I, 'complex', (a) => {
    const re = argT(a, 0), im = a.length > 1 ? argT(a, 1) : zeros(re.rows, re.cols);
    const n = Math.max(re.numel, im.numel);
    const out = new Tensor(re.numel >= im.numel ? re.rows : im.rows, re.numel >= im.numel ? re.cols : im.cols, new Float64Array(n), new Float64Array(n));
    for (let i = 0; i < n; i++) {
      out.re[i] = re.re[re.numel === 1 ? 0 : i];
      out.im![i] = im.re[im.numel === 1 ? 0 : i];
    }
    return out;
  });
  def(I, 'isreal', (a) => bool(!(a[0].kind === 'tensor' && a[0].im)));
  def(I, 'isnan', (a) => {
    const t = argT(a, 0);
    return mapBool(t, (x, i) => Number.isNaN(x) || (!!t.im && Number.isNaN(t.im[i])));
  });
  def(I, 'isinf', (a) => mapBool(argT(a, 0), (x) => x === Infinity || x === -Infinity));
  def(I, 'isfinite', (a) => mapBool(argT(a, 0), (x) => Number.isFinite(x)));
  def(I, 'isprime', (a) => mapBool(argT(a, 0), isPrime));
  def(I, 'primes', (a) => {
    const n = argNum(a, 0);
    const out: number[] = [];
    for (let k = 2; k <= n; k++) if (isPrime(k)) out.push(k);
    return rowVec(out);
  });
  def(I, 'factor', (a) => {
    let n = argNum(a, 0);
    const f: number[] = [];
    for (let p = 2; p * p <= n; p++) while (n % p === 0) {
      f.push(p);
      n /= p;
    }
    if (n > 1) f.push(n);
    return rowVec(f);
  });
  def(I, 'gcd', (a) => binaryWith(a, (x, y) => {
    x = Math.abs(x);
    y = Math.abs(y);
    while (y) [x, y] = [y, x % y];
    return x;
  }));
  def(I, 'lcm', (a) => binaryWith(a, (x, y) => {
    let g = Math.abs(x), h = Math.abs(y);
    while (h) [g, h] = [h, g % h];
    return g ? Math.abs(x * y) / g : 0;
  }));
  def(I, 'nchoosek', (a) => {
    const nT = argT(a, 0);
    const k = argNum(a, 1);
    if (nT.numel === 1) {
      const n = nT.re[0];
      let r = 1;
      for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
      return num(Math.round(r));
    }
    const items = Array.from(nT.re);
    const combos: number[][] = [];
    const rec = (start: number, cur: number[]) => {
      if (cur.length === k) {
        combos.push([...cur]);
        return;
      }
      for (let i = start; i < items.length; i++) {
        cur.push(items[i]);
        rec(i + 1, cur);
        cur.pop();
      }
    };
    rec(0, []);
    const out = zeros(combos.length, k);
    combos.forEach((c, i) => c.forEach((v, j) => (out.re[j * combos.length + i] = v)));
    return out;
  });
  def(I, 'perms', (a) => {
    const v = Array.from(argT(a, 0).re);
    const res: number[][] = [];
    const rec = (arr: number[], cur: number[]) => {
      if (!arr.length) {
        res.push(cur);
        return;
      }
      for (let i = arr.length - 1; i >= 0; i--) rec([...arr.slice(0, i), ...arr.slice(i + 1)], [...cur, arr[i]]);
    };
    rec(v, []);
    const out = zeros(res.length, v.length);
    res.forEach((r, i) => r.forEach((x, j) => (out.re[j * res.length + i] = x)));
    return out;
  });
  def(I, 'mod', (a) => binaryWith(a, (x, y) => (y === 0 ? x : x - Math.floor(x / y) * y), true));
  def(I, 'rem', (a) => binaryWith(a, (x, y) => (y === 0 ? NaN : x - Math.trunc(x / y) * y), true));
  def(I, 'atan2', (a) => binaryWith(a, Math.atan2));
  def(I, 'atan2d', (a) => binaryWith(a, (y, x) => (Math.atan2(y, x) * 180) / Math.PI));
  def(I, 'hypot', (a) => binaryWith(a, Math.hypot));
  def(I, 'power', (a) => binaryOp('.^', a[0], a[1]));
  def(I, 'nthroot', (a) => binaryWith(a, (x, n) => (x < 0 && n % 2 === 1 ? -Math.pow(-x, 1 / n) : Math.pow(x, 1 / n))));
  def(I, 'realsqrt', (a) => mapReal(argT(a, 0), Math.sqrt));
  def(I, 'reallog', (a) => mapReal(argT(a, 0), Math.log));
  def(I, 'beta', (a) => binaryWith(a, (x, y) => Math.exp(lgamma(x) + lgamma(y) - lgamma(x + y))));
  def(I, 'betainc', (a) => {
    const x = argT(a, 0), p = argNum(a, 1), q = argNum(a, 2);
    return mapReal(x, (v) => betaInc(v, p, q));
  });
  def(I, 'gammainc', (a) => {
    const x = argT(a, 0), s = argNum(a, 1);
    const upper = a.length > 2 && toStringValue(a[2]) === 'upper';
    return mapReal(x, (v) => (upper ? 1 - gammaP(s, v) : gammaP(s, v)));
  });
  def(I, ['plus', 'minus', 'times', 'rdivide', 'ldivide', 'mtimes', 'mrdivide', 'mldivide', 'mpower', 'eq', 'ne', 'lt', 'le', 'gt', 'ge', 'and', 'or'], (a, _n, ctx) => {
    const ops: Record<string, string> = { plus: '+', minus: '-', times: '.*', rdivide: './', ldivide: '.\\', mtimes: '*', mrdivide: '/', mldivide: '\\', mpower: '^', eq: '==', ne: '~=', lt: '<', le: '<=', gt: '>', ge: '>=', and: '&', or: '|' };
    minArgs(a, 2);
    return binaryOp(ops[ctx.name], a[0], a[1]);
  });
  def(I, 'not', (a) => mapBool(argT(a, 0), (x) => x === 0));
  def(I, 'xor', (a) => {
    const r = binaryWith(a, (x, y) => ((x !== 0) !== (y !== 0) ? 1 : 0));
    return r.withClass('logical');
  });
  def(I, 'uminus', (a) => mapReal(argT(a, 0), (x) => -x));
  def(I, 'uplus', (a) => a[0]);

  // ---------- reductions ----------
  def(I, 'sum', (a) => {
    const t = argT(a, 0, 'sum');
    const omit = hasFlag(a, 'omitnan');
    const dim = getDim(stripFlags(a, ['omitnan', 'includenan', 'double', 'native', 'default']), 1, t);
    if (t.im) return complexReduce(t, dim, (vr, vi) => [vr.reduce((s, x) => s + x, 0), vi.reduce((s, x) => s + x, 0)]);
    const out = reduce(t, dim, (v) => {
      let s = 0;
      for (const x of v) if (!(omit && Number.isNaN(x))) s += x;
      return s;
    });
    if (isIntClass(t.cls)) return out.withClass(t.cls);
    return out;
  });
  def(I, 'prod', (a) => {
    const t = argT(a, 0, 'prod');
    const dim = getDim(a, 1, t);
    return reduce(t, dim, (v) => v.reduce((p, x) => p * x, 1));
  });
  def(I, 'mean', (a) => {
    const t = argT(a, 0, 'mean');
    const omit = hasFlag(a, 'omitnan');
    if (hasFlag(a, 'all')) return num(meanOf(Array.from(t.re), omit));
    const dim = getDim(stripFlags(a, ['omitnan', 'includenan', 'all']), 1, t);
    if (t.im) return complexReduce(t, dim, (vr, vi) => [vr.reduce((s, x) => s + x, 0) / vr.length, vi.reduce((s, x) => s + x, 0) / vi.length]);
    return reduce(t, dim, (v) => meanOf(v, omit));
  });
  def(I, 'median', (a) => {
    const t = argT(a, 0, 'median');
    const omit = hasFlag(a, 'omitnan');
    if (hasFlag(a, 'all')) return num(medianOf(Array.from(t.re), omit));
    const dim = getDim(stripFlags(a, ['omitnan', 'includenan', 'all']), 1, t);
    return reduce(t, dim, (v) => medianOf(v, omit));
  });
  def(I, 'mode', (a) => {
    const t = argT(a, 0, 'mode');
    const dim = getDim(a, 1, t);
    return reduce(t, dim, (v) => {
      if (!v.length) return NaN;
      const counts = new Map<number, number>();
      for (const x of v) counts.set(x, (counts.get(x) ?? 0) + 1);
      let best = Infinity, bc = 0;
      for (const [x, c] of counts) if (c > bc || (c === bc && x < best)) {
        best = x;
        bc = c;
      }
      return best;
    });
  });
  for (const name of ['std', 'var']) {
    def(I, name, (a) => {
      const t = argT(a, 0, name);
      const omit = hasFlag(a, 'omitnan');
      const rest = stripFlags(a, ['omitnan', 'includenan', 'all']);
      const w = rest.length > 1 && rest[1].numel ? toNumber(rest[1]) : 0;
      if (hasFlag(a, 'all')) {
        const v = varOf(Array.from(t.re), w, omit);
        return num(name === 'std' ? Math.sqrt(v) : v);
      }
      const dim = rest.length > 2 ? toNumber(rest[2]) : defaultDim(t);
      return reduce(t, dim, (v) => {
        const x = varOf(v, w, omit);
        return name === 'std' ? Math.sqrt(x) : x;
      });
    });
  }
  for (const name of ['min', 'max']) {
    const better = name === 'min' ? (x: number, y: number) => x < y : (x: number, y: number) => x > y;
    def(I, name, (a, nargout) => {
      minArgs(a, 1);
      if (a.length >= 2 && a[1].numel > 0) {
        // elementwise two-argument form
        const x = toTensor(a[0]), y = toTensor(a[1]);
        return binaryWithT(x, y, (p, q) => (Number.isNaN(p) ? q : Number.isNaN(q) ? p : better(p, q) ? p : q));
      }
      const t = argT(a, 0, name);
      if (hasFlag(a, 'all')) {
        let bi = -1;
        for (let i = 0; i < t.numel; i++) if (!Number.isNaN(t.re[i]) && (bi < 0 || better(sortKey(t, i), sortKey(t, bi)))) bi = i;
        return [bi < 0 ? num(NaN) : num(t.re[bi]), num(bi + 1)];
      }
      const dim = a.length > 2 ? toNumber(a[2]) : defaultDim(t);
      if (t.numel === 0) return [zeros(0, 0), zeros(0, 0)];
      const vals = reduce(t, dim, () => 0);
      const idx = reduce(t, dim, () => 0);
      const slices = dim === 1 ? t.cols : t.rows;
      const len = dim === 1 ? t.rows : t.cols;
      for (let s = 0; s < slices; s++) {
        let bi = -1;
        for (let k = 0; k < len; k++) {
          const i = dim === 1 ? s * t.rows + k : k * t.rows + s;
          if (Number.isNaN(t.re[i])) continue;
          if (bi < 0 || better(sortKey(t, i), sortKey(t, bi))) bi = i;
        }
        vals.re[s] = bi < 0 ? NaN : t.re[bi];
        idx.re[s] = bi < 0 ? 1 : (dim === 1 ? bi - s * t.rows : Math.floor(bi / t.rows)) + 1;
        if (t.im && bi >= 0) {
          vals.im = vals.im ?? new Float64Array(vals.numel);
          vals.im[s] = t.im[bi];
        }
      }
      const outVals = isIntClass(t.cls) || t.cls === 'single' ? vals.withClass(t.cls) : vals;
      return nargout > 1 ? [outVals, idx] : [outVals];
    });
  }
  def(I, 'bounds', (a) => {
    const t = argT(a, 0);
    const v = Array.from(t.re).filter((x) => !Number.isNaN(x));
    return [num(Math.min(...v)), num(Math.max(...v))];
  });
  def(I, 'range', (a) => {
    const t = argT(a, 0);
    const dim = getDim(a, 1, t);
    return reduce(t, dim, (v) => Math.max(...v) - Math.min(...v));
  });
  def(I, 'any', (a) => {
    const t = argT(a, 0);
    if (hasFlag(a, 'all')) return bool(Array.from(t.re).some((x) => x !== 0 && !Number.isNaN(x)));
    if (t.numel === 0) return bool(false);
    const dim = getDim(a, 1, t);
    return reduce(t, dim, (v) => (v.some((x) => x !== 0 && !Number.isNaN(x)) ? 1 : 0), 'logical');
  });
  def(I, 'all', (a) => {
    const t = argT(a, 0);
    if (hasFlag(a, 'all')) return bool(Array.from(t.re).every((x) => x !== 0));
    if (t.numel === 0) return bool(true);
    const dim = getDim(a, 1, t);
    return reduce(t, dim, (v) => (v.every((x) => x !== 0) ? 1 : 0), 'logical');
  });
  def(I, 'nnz', (a) => num(Array.from(argT(a, 0).re).filter((x) => x !== 0).length));
  def(I, 'cumsum', (a) => {
    const t = argT(a, 0);
    const dim = getDim(stripFlags(a, ['reverse', 'forward', 'omitnan']), 1, t);
    const rev = hasFlag(a, 'reverse');
    return cumulate(t, dim, (v) => {
      const w = rev ? [...v].reverse() : v;
      let s = 0;
      const r = w.map((x) => (s += x));
      return rev ? r.reverse() : r;
    });
  });
  def(I, 'cumprod', (a) => {
    const t = argT(a, 0);
    const dim = getDim(a, 1, t);
    return cumulate(t, dim, (v) => {
      let p = 1;
      return v.map((x) => (p *= x));
    });
  });
  def(I, ['cummax', 'cummin'], (a, _n, ctx) => {
    const t = argT(a, 0);
    const dim = getDim(a, 1, t);
    const mx = ctx.name === 'cummax';
    return cumulate(t, dim, (v) => {
      let m = mx ? -Infinity : Infinity;
      return v.map((x) => (m = mx ? Math.max(m, x) : Math.min(m, x)));
    });
  });
  def(I, 'diff', (a) => {
    let t = argT(a, 0);
    const n = argNum(a, 1, 1);
    for (let k = 0; k < n; k++) {
      const dim = a.length > 2 ? toNumber(a[2]) : defaultDim(t);
      if (dim === 1) {
        if (t.rows < 2) return zeros(0, t.cols);
        const out = zeros(t.rows - 1, t.cols);
        for (let j = 0; j < t.cols; j++) for (let i = 0; i < t.rows - 1; i++) out.re[j * (t.rows - 1) + i] = t.re[j * t.rows + i + 1] - t.re[j * t.rows + i];
        t = out;
      } else {
        if (t.cols < 2) return zeros(t.rows, 0);
        const out = zeros(t.rows, t.cols - 1);
        for (let j = 0; j < t.cols - 1; j++) for (let i = 0; i < t.rows; i++) out.re[j * t.rows + i] = t.re[(j + 1) * t.rows + i] - t.re[j * t.rows + i];
        t = out;
      }
    }
    return t;
  });
  def(I, 'gradient', (a, nargout) => {
    const t = argT(a, 0);
    const h = a.length > 1 ? toNumber(a[1]) : 1;
    const g1 = (v: number[], hh: number) => v.map((_, i) => (v.length < 2 ? 0 : i === 0 ? (v[1] - v[0]) / hh : i === v.length - 1 ? (v[i] - v[i - 1]) / hh : (v[i + 1] - v[i - 1]) / (2 * hh)));
    if (t.rows === 1 || t.cols === 1) {
      const r = g1(Array.from(t.re), h);
      return new Tensor(t.rows, t.cols, Float64Array.from(r));
    }
    const gx = cumulate(t, 2, (v) => g1(v, h));
    const gy = cumulate(t, 1, (v) => g1(v, a.length > 2 ? toNumber(a[2]) : h));
    return nargout > 1 ? [gx, gy] : [gx];
  });
  def(I, 'trapz', (a) => {
    if (a.length === 1) {
      const t = argT(a, 0);
      return reduce(t, defaultDim(t), (v) => trap(v.map((_, i) => i + 1), v));
    }
    const x = argT(a, 0), y = argT(a, 1);
    if (y.rows === 1 || y.cols === 1) return num(trap(Array.from(x.re), Array.from(y.re)));
    return reduce(y, 1, (v) => trap(Array.from(x.re), v));
  });
  def(I, 'cumtrapz', (a) => {
    const x = a.length > 1 ? Array.from(argT(a, 0).re) : null;
    const y = argT(a, a.length > 1 ? 1 : 0);
    return cumulate(y, defaultDim(y), (v) => {
      const xs = x ?? v.map((_, i) => i + 1);
      let s = 0;
      return v.map((val, i) => (i === 0 ? 0 : (s += ((val + v[i - 1]) / 2) * (xs[i] - xs[i - 1]))));
    });
  });
  def(I, 'dot', (a) => {
    const x = argT(a, 0), y = argT(a, 1);
    if (x.numel !== y.numel) throw new MError('A and B must be same size.');
    if ((x.rows === 1 || x.cols === 1)) {
      let s = 0;
      for (let i = 0; i < x.numel; i++) s += x.re[i] * y.re[i];
      return num(s);
    }
    const out = zeros(1, x.cols);
    for (let j = 0; j < x.cols; j++) for (let i = 0; i < x.rows; i++) out.re[j] += x.re[j * x.rows + i] * y.re[j * x.rows + i];
    return out;
  });
  def(I, 'cross', (a) => {
    const x = argT(a, 0), y = argT(a, 1);
    if (x.numel !== 3 || y.numel !== 3) throw new MError('A and B must be of length 3.');
    const [a1, a2, a3] = x.re, [b1, b2, b3] = y.re;
    const r = [a2 * b3 - a3 * b2, a3 * b1 - a1 * b3, a1 * b2 - a2 * b1];
    return x.rows === 1 ? rowVec(r) : colVec(r);
  });
  def(I, 'kron', (a) => {
    const A = argT(a, 0), B = argT(a, 1);
    const out = zeros(A.rows * B.rows, A.cols * B.cols);
    for (let i = 0; i < A.rows; i++) for (let j = 0; j < A.cols; j++) for (let k = 0; k < B.rows; k++) for (let l = 0; l < B.cols; l++)
      out.re[(j * B.cols + l) * out.rows + i * B.rows + k] = A.re[j * A.rows + i] * B.re[l * B.rows + k];
    return out;
  });

  // ---------- reshaping ----------
  def(I, 'fliplr', (a) => flipCols(a[0]));
  def(I, 'flipud', (a) => flipRows(a[0]));
  def(I, 'flip', (a) => {
    const v = a[0];
    const dim = a.length > 1 ? toNumber(a[1]) : v.rows === 1 ? 2 : 1;
    return dim === 1 ? flipRows(v) : flipCols(v);
  });
  def(I, 'rot90', (a) => {
    let t = argT(a, 0);
    let k = ((argNum(a, 1, 1) % 4) + 4) % 4;
    while (k-- > 0) {
      const out = zeros(t.cols, t.rows, t.cls);
      for (let i = 0; i < t.rows; i++) for (let j = 0; j < t.cols; j++) out.re[i * t.cols + (t.cols - 1 - j)] = t.re[j * t.rows + i];
      t = out;
    }
    return t;
  });
  def(I, 'circshift', (a) => {
    const t = argT(a, 0);
    const kT = argT(a, 1);
    let kr = 0, kc = 0;
    if (kT.numel >= 2) {
      kr = kT.re[0];
      kc = kT.re[1];
    } else {
      const dim = a.length > 2 ? toNumber(a[2]) : t.rows === 1 ? 2 : 1;
      if (dim === 1) kr = kT.re[0];
      else kc = kT.re[0];
    }
    const out = zeros(t.rows, t.cols, t.cls);
    for (let i = 0; i < t.rows; i++) for (let j = 0; j < t.cols; j++) {
      const ni = (((i + kr) % t.rows) + t.rows) % t.rows, nj = (((j + kc) % t.cols) + t.cols) % t.cols;
      out.re[nj * t.rows + ni] = t.re[j * t.rows + i];
    }
    return out;
  });
  def(I, ['triu', 'tril'], (a, _n, ctx) => {
    const t = argT(a, 0);
    const k = argNum(a, 1, 0);
    const out = t.clone();
    for (let i = 0; i < t.rows; i++) for (let j = 0; j < t.cols; j++) {
      const keep = ctx.name === 'triu' ? j - i >= k : j - i <= k;
      if (!keep) out.re[j * t.rows + i] = 0;
    }
    return out;
  });
  def(I, 'squeeze', (a) => a[0]);
  def(I, 'permute', (a) => {
    const order = Array.from(argT(a, 1).re);
    if (order[0] === 2 && order[1] === 1) return transposeValue(a[0]);
    return a[0];
  });
  def(I, 'transpose', (a) => transposeValue(a[0], false));
  def(I, 'ctranspose', (a) => transposeValue(a[0], true));
  def(I, 'vec', (a) => {
    const t = argT(a, 0);
    return new Tensor(t.numel, 1, t.re, t.im, t.cls);
  });

  // ---------- sorting & searching ----------
  def(I, 'sort', (a, nargout) => {
    const v = a[0];
    const desc = hasFlag(a, 'descend');
    if (v.kind === 'cell' || v.kind === 'string') {
      const s = v.kind === 'cell' ? v.data.map((x) => toStringValue(x)) : v.data;
      const idx = s.map((_, i) => i).sort((x, y) => (s[x] < s[y] ? -1 : s[x] > s[y] ? 1 : x - y) * (desc ? -1 : 1));
      const sorted = idx.map((i) => s[i]);
      const out = v.kind === 'cell' ? new CellArray(v.rows, v.cols, sorted.map((x) => str(x))) : new StringArray(v.rows, v.cols, sorted);
      return nargout > 1 ? [out, new Tensor(v.rows, v.cols, Float64Array.from(idx, (i) => i + 1))] : [out];
    }
    const t = argT(a, 0);
    const dim = getDim(stripFlags(a, ['ascend', 'descend']), 1, t);
    const out = t.clone();
    const idx = zeros(t.rows, t.cols);
    const slices = dim === 1 ? t.cols : t.rows, len = dim === 1 ? t.rows : t.cols;
    for (let s = 0; s < slices; s++) {
      const pos = Array.from({ length: len }, (_, k) => (dim === 1 ? s * t.rows + k : k * t.rows + s));
      const order = pos.map((_, k) => k).sort((x, y) => {
        const p = sortKey(t, pos[x]), q = sortKey(t, pos[y]);
        if (Number.isNaN(p) && Number.isNaN(q)) return x - y;
        if (Number.isNaN(p)) return 1;
        if (Number.isNaN(q)) return -1;
        const c = desc ? q - p : p - q;
        return c !== 0 ? c : x - y;
      });
      order.forEach((k, r) => {
        out.re[pos[r]] = t.re[pos[k]];
        if (t.im) out.im![pos[r]] = t.im[pos[k]];
        idx.re[pos[r]] = k + 1;
      });
    }
    return nargout > 1 ? [out, idx] : [out];
  });
  def(I, 'sortrows', (a, nargout) => {
    const t = argT(a, 0);
    let colSpec = a.length > 1 && !isStringLike(a[1]) ? Array.from(toTensor(a[1]).re) : Array.from({ length: t.cols }, (_, j) => j + 1);
    if (hasFlag(a, 'descend')) colSpec = colSpec.map((c) => -Math.abs(c));
    const rows = Array.from({ length: t.rows }, (_, i) => i);
    rows.sort((x, y) => {
      for (const c of colSpec) {
        const j = Math.abs(c) - 1;
        const d = t.re[j * t.rows + x] - t.re[j * t.rows + y];
        if (d !== 0) return c > 0 ? d : -d;
      }
      return x - y;
    });
    const out = zeros(t.rows, t.cols, t.cls);
    rows.forEach((r, i) => {
      for (let j = 0; j < t.cols; j++) out.re[j * t.rows + i] = t.re[j * t.rows + r];
    });
    return nargout > 1 ? [out, colVec(rows.map((r) => r + 1))] : [out];
  });
  def(I, 'unique', (a, nargout) => {
    const v = a[0];
    const stable = hasFlag(a, 'stable');
    if (v.kind === 'cell' || v.kind === 'string') {
      const s = v.kind === 'cell' ? v.data.map((x) => toStringValue(x)) : v.data;
      const first = new Map<string, number>();
      s.forEach((x, i) => {
        if (!first.has(x)) first.set(x, i);
      });
      let keys = [...first.keys()];
      if (!stable) keys = keys.sort();
      const out = v.kind === 'cell' ? new CellArray(keys.length, 1, keys.map((k) => str(k))) : new StringArray(keys.length, 1, keys);
      const ia = colVec(keys.map((k) => first.get(k)! + 1));
      const ic = colVec(s.map((x) => keys.indexOf(x) + 1));
      return [out, ia, ic].slice(0, Math.max(1, nargout));
    }
    const t = argT(a, 0);
    if (hasFlag(a, 'rows')) {
      const keyOf = (i: number) => Array.from({ length: t.cols }, (_, j) => t.re[j * t.rows + i]).join(',');
      const first = new Map<string, number>();
      for (let i = 0; i < t.rows; i++) if (!first.has(keyOf(i))) first.set(keyOf(i), i);
      let rowsU = [...first.values()];
      if (!stable) rowsU.sort((x, y) => {
        for (let j = 0; j < t.cols; j++) {
          const d = t.re[j * t.rows + x] - t.re[j * t.rows + y];
          if (d) return d;
        }
        return 0;
      });
      const out = zeros(rowsU.length, t.cols);
      rowsU.forEach((r, i) => {
        for (let j = 0; j < t.cols; j++) out.re[j * rowsU.length + i] = t.re[j * t.rows + r];
      });
      return [out, colVec(rowsU.map((r) => r + 1)), colVec(Array.from({ length: t.rows }, (_, i) => rowsU.findIndex((r) => keyOf(r) === keyOf(i)) + 1))].slice(0, Math.max(1, nargout));
    }
    const vals = Array.from(t.re);
    const first = new Map<number, number>();
    const last = new Map<number, number>();
    vals.forEach((x, i) => {
      const key = Number.isNaN(x) ? NaN : x;
      if (Number.isNaN(key)) return;
      if (!first.has(key)) first.set(key, i);
      last.set(key, i);
    });
    let keys = [...first.keys()];
    if (!stable) keys.sort((x, y) => x - y);
    const nans = vals.filter((x) => Number.isNaN(x)).length;
    const outVals = [...keys, ...Array(nans).fill(NaN)];
    const out = t.rows === 1 ? new Tensor(1, outVals.length, Float64Array.from(outVals), null, t.cls) : new Tensor(outVals.length, 1, Float64Array.from(outVals), null, t.cls);
    const pos = new Map(keys.map((k, i) => [k, i + 1]));
    const ia = colVec(keys.map((k) => (hasFlag(a, 'last') ? last.get(k)! : first.get(k)!) + 1));
    const ic = colVec(vals.map((x) => pos.get(x) ?? NaN));
    return [out, ia, ic].slice(0, Math.max(1, nargout));
  });
  def(I, 'find', (a, nargout) => {
    const t = argT(a, 0);
    const k = a.length > 1 ? toNumber(a[1]) : Infinity;
    const lastDir = a.length > 2 && toStringValue(a[2]) === 'last';
    const idx: number[] = [];
    if (lastDir) {
      for (let i = t.numel - 1; i >= 0 && idx.length < k; i--) if (t.re[i] !== 0 || (t.im && t.im[i] !== 0)) idx.unshift(i);
    } else for (let i = 0; i < t.numel && idx.length < k; i++) if (t.re[i] !== 0 || (t.im && t.im[i] !== 0)) idx.push(i);
    if (nargout <= 1) {
      const vals = idx.map((i) => i + 1);
      return t.rows === 1 && t.cols !== 1 ? (vals.length ? rowVec(vals) : zeros(1, 0)) : vals.length ? colVec(vals) : t.numel === 0 ? zeros(0, 0) : zeros(0, 1);
    }
    const r = colVec(idx.map((i) => (i % t.rows) + 1)), c = colVec(idx.map((i) => Math.floor(i / t.rows) + 1));
    return [r, c, colVec(idx.map((i) => t.re[i]))].slice(0, nargout);
  });
  def(I, ['ismember'], (a, nargout) => {
    const x = a[0], s = a[1];
    if (isStringLike(x) || x.kind === 'cell' || x.kind === 'string') {
      const set = (s.kind === 'cell' ? s.data.map((v) => toStringValue(v)) : s.kind === 'string' ? s.data : [toStringValue(s)]);
      const items = x.kind === 'cell' ? x.data.map((v) => toStringValue(v)) : x.kind === 'string' ? x.data : [toStringValue(x)];
      const tf = zeros(x.kind === 'cell' || x.kind === 'string' ? x.rows : 1, x.kind === 'cell' || x.kind === 'string' ? x.cols : 1, 'logical');
      const loc = zeros(tf.rows, tf.cols);
      items.forEach((it, i) => {
        const k = set.indexOf(it);
        tf.re[i] = k >= 0 ? 1 : 0;
        loc.re[i] = k + 1;
      });
      return nargout > 1 ? [tf, loc] : [tf];
    }
    const xt = toTensor(x), st = toTensor(s);
    const pos = new Map<number, number>();
    for (let i = st.numel - 1; i >= 0; i--) pos.set(st.re[i], i + 1);
    const tf = zeros(xt.rows, xt.cols, 'logical'), loc = zeros(xt.rows, xt.cols);
    for (let i = 0; i < xt.numel; i++) {
      const k = pos.get(xt.re[i]);
      tf.re[i] = k ? 1 : 0;
      loc.re[i] = k ?? 0;
    }
    return nargout > 1 ? [tf, loc] : [tf];
  });
  for (const op of ['union', 'intersect', 'setdiff', 'setxor']) {
    def(I, op, (a) => {
      const x = a[0], y = a[1];
      if (x.kind === 'cell' || y.kind === 'cell') {
        const xs = x.kind === 'cell' ? x.data.map((v) => toStringValue(v)) : [toStringValue(x)];
        const ys = y.kind === 'cell' ? y.data.map((v) => toStringValue(v)) : [toStringValue(y)];
        const r = setOp(op, xs, ys).sort();
        return cellOf(r.map((s) => str(s)));
      }
      const xv = Array.from(toTensor(x).re), yv = Array.from(toTensor(y).re);
      const r = setOp(op, xv, yv).sort((p, q) => p - q);
      const asCol = x.cols === 1 && x.rows > 1;
      return asCol ? colVec(r) : rowVec(r);
    });
  }
  def(I, 'histcounts', (a, nargout) => {
    const x = Array.from(argT(a, 0).re).filter((v) => Number.isFinite(v));
    let edges: number[];
    if (a.length > 1 && a[1].numel > 1) edges = Array.from(toTensor(a[1]).re);
    else {
      const nb = a.length > 1 ? toNumber(a[1]) : Math.max(1, Math.ceil(Math.sqrt(x.length)));
      const lo = Math.min(...x), hi = Math.max(...x);
      edges = Array.from({ length: nb + 1 }, (_, i) => lo + ((hi - lo || 1) * i) / nb);
    }
    const counts = new Array(edges.length - 1).fill(0);
    for (const v of x) {
      for (let b = 0; b < counts.length; b++) {
        if (v >= edges[b] && (v < edges[b + 1] || (b === counts.length - 1 && v <= edges[b + 1]))) {
          counts[b]++;
          break;
        }
      }
    }
    return nargout > 1 ? [rowVec(counts), rowVec(edges)] : [rowVec(counts)];
  });
  def(I, ['prctile', 'quantile'], (a, _n, ctx) => {
    const t = argT(a, 0);
    const p = Array.from(argT(a, 1).re).map((v) => (ctx.name === 'prctile' ? v / 100 : v));
    const col = (v: number[]) => {
      const s = v.filter((x) => !Number.isNaN(x)).sort((x, y) => x - y);
      const n = s.length;
      // MATLAB's method: midpoint interpolation (Hazen)
      return p.map((q) => {
        if (!n) return NaN;
        const h = n * q + 0.5;
        if (h <= 1) return s[0];
        if (h >= n) return s[n - 1];
        const lo = Math.floor(h);
        return s[lo - 1] + (h - lo) * (s[lo] - s[lo - 1]);
      });
    };
    if (t.rows === 1 || t.cols === 1) {
      const r = col(Array.from(t.re));
      return t.rows === 1 ? rowVec(r) : colVec(r);
    }
    const out = zeros(p.length, t.cols);
    for (let j = 0; j < t.cols; j++) col(Array.from(t.re.subarray(j * t.rows, (j + 1) * t.rows))).forEach((v, i) => (out.re[j * p.length + i] = v));
    return out;
  });
  def(I, 'iqr', (a) => {
    const t = argT(a, 0);
    return reduce(t, defaultDim(t), (v) => {
      const s = [...v].sort((x, y) => x - y);
      const q = (p: number) => {
        const n = s.length, h = n * p + 0.5;
        if (h <= 1) return s[0];
        if (h >= n) return s[n - 1];
        const lo = Math.floor(h);
        return s[lo - 1] + (h - lo) * (s[lo] - s[lo - 1]);
      };
      return q(0.75) - q(0.25);
    });
  });
  def(I, 'zscore', (a) => {
    const t = argT(a, 0);
    return cumulate(t, defaultDim(t), (v) => {
      const m = meanOf(v), s = Math.sqrt(varOf(v, 0));
      return v.map((x) => (x - m) / s);
    });
  });
  def(I, 'normalize', (a) => {
    const t = argT(a, 0);
    return cumulate(t, defaultDim(t), (v) => {
      const m = meanOf(v), s = Math.sqrt(varOf(v, 0));
      return v.map((x) => (x - m) / s);
    });
  });
  def(I, 'rescale', (a) => {
    const t = argT(a, 0);
    const lo = a.length > 1 ? toNumber(a[1]) : 0, hi = a.length > 2 ? toNumber(a[2]) : 1;
    const v = Array.from(t.re);
    const mn = Math.min(...v), mx = Math.max(...v);
    return mapReal(t, (x) => lo + ((x - mn) * (hi - lo)) / (mx - mn || 1));
  });
  def(I, 'cov', (a) => {
    if (a.length > 1 && a[1].numel > 1) {
      const x = Array.from(argT(a, 0).re), y = Array.from(argT(a, 1).re);
      return covMatrix([x, y]);
    }
    const t = argT(a, 0);
    if (t.rows === 1 || t.cols === 1) return num(varOf(Array.from(t.re), 0));
    return covMatrix(Array.from({ length: t.cols }, (_, j) => Array.from(t.re.subarray(j * t.rows, (j + 1) * t.rows))));
  });
  def(I, ['corrcoef', 'corr'], (a, nargout, ctx) => {
    let cols: number[][];
    if (a.length > 1 && !isStringLike(a[1])) {
      const x = argT(a, 0), y = argT(a, 1);
      if (ctx.name === 'corr' && x.cols > 1) {
        const xc = Array.from({ length: x.cols }, (_, j) => Array.from(x.re.subarray(j * x.rows, (j + 1) * x.rows)));
        const yc = Array.from({ length: y.cols }, (_, j) => Array.from(y.re.subarray(j * y.rows, (j + 1) * y.rows)));
        const out = zeros(xc.length, yc.length);
        xc.forEach((u, i) => yc.forEach((w, j) => (out.re[j * xc.length + i] = pearsonR(u, w))));
        return out;
      }
      cols = [Array.from(x.re), Array.from(y.re)];
      if (ctx.name === 'corr') {
        const r = pearsonR(cols[0], cols[1]);
        return num(r);
      }
    } else {
      const t = argT(a, 0);
      cols = Array.from({ length: t.cols }, (_, j) => Array.from(t.re.subarray(j * t.rows, (j + 1) * t.rows)));
    }
    const spearman = a.some((x) => isStringLike(x) && toStringValue(x).toLowerCase() === 'spearman');
    if (spearman) cols = cols.map(rankArr);
    const k = cols.length;
    const R = zeros(k, k), P = zeros(k, k);
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
      const r = i === j ? 1 : pearsonR(cols[i], cols[j]);
      R.re[j * k + i] = r;
      const n = cols[i].length;
      const tt = (r * Math.sqrt(n - 2)) / Math.sqrt(Math.max(1e-300, 1 - r * r));
      P.re[j * k + i] = i === j ? 1 : 2 * (1 - studentT(Math.abs(tt), n - 2));
    }
    return nargout > 1 ? [R, P] : [R];
  });
  def(I, ['movmean', 'movsum', 'movmedian', 'movmax', 'movmin', 'movstd'], (a, _n, ctx) => {
    const t = argT(a, 0);
    const kT = argT(a, 1);
    const kb = kT.numel > 1 ? kT.re[0] : Math.floor((kT.re[0] - 1) / 2) + (kT.re[0] % 2 === 0 ? 1 : 0) * 0;
    const kf = kT.numel > 1 ? kT.re[1] : kT.re[0] - 1 - Math.floor((kT.re[0] - 1) / 2);
    const agg: Record<string, (v: number[]) => number> = { movmean: (v) => meanOf(v), movsum: (v) => v.reduce((s, x) => s + x, 0), movmedian: (v) => medianOf(v), movmax: (v) => Math.max(...v), movmin: (v) => Math.min(...v), movstd: (v) => Math.sqrt(varOf(v, 0)) };
    return cumulate(t, defaultDim(t), (v) => v.map((_, i) => agg[ctx.name](v.slice(Math.max(0, i - kb), Math.min(v.length, i + kf + 1)))));
  });
  def(I, 'accumarray', (a) => {
    const subs = argT(a, 0), vals = argT(a, 1);
    const n = Math.max(...Array.from(subs.re.subarray(0, subs.rows)));
    const out = zeros(n, 1);
    for (let i = 0; i < subs.rows; i++) out.re[subs.re[i] - 1] += vals.numel === 1 ? vals.re[0] : vals.re[i];
    return out;
  });
  def(I, ['nansum', 'nanmean', 'nanmax', 'nanmin', 'nanstd', 'nanmedian'], (a, _n, ctx) => {
    const t = argT(a, 0);
    const f: Record<string, (v: number[]) => number> = {
      nansum: (v) => v.reduce((s, x) => s + x, 0), nanmean: meanOf, nanmax: (v) => Math.max(...v), nanmin: (v) => Math.min(...v), nanstd: (v) => Math.sqrt(varOf(v, 0)), nanmedian: (v) => medianOf(v),
    };
    return reduce(t, getDim(a, 1, t), (v) => f[ctx.name](v.filter((x) => !Number.isNaN(x))));
  });
  def(I, ['skewness', 'kurtosis'], (a, _n, ctx) => {
    const t = argT(a, 0);
    const flag = a.length > 1 && a[1].numel ? toNumber(a[1]) : 1;
    return reduce(t, defaultDim(t), (v) => {
      const n = v.length, m = meanOf(v);
      let m2 = 0, m3 = 0, m4 = 0;
      for (const x of v) {
        const d = x - m;
        m2 += d * d;
        m3 += d * d * d;
        m4 += d * d * d * d;
      }
      m2 /= n; m3 /= n; m4 /= n;
      if (ctx.name === 'skewness') {
        const g = m3 / Math.pow(m2, 1.5);
        return flag === 0 ? (g * Math.sqrt(n * (n - 1))) / (n - 2) : g;
      }
      const k = m4 / (m2 * m2);
      return flag === 0 ? 3 + ((n - 1) / ((n - 2) * (n - 3))) * ((n + 1) * k - 3 * (n - 1)) : k;
    });
  });
  def(I, 'mad', (a) => {
    const t = argT(a, 0);
    const useMedian = a.length > 1 && toNumber(a[1]) === 1;
    return reduce(t, defaultDim(t), (v) => {
      const c = useMedian ? medianOf(v) : meanOf(v);
      const d = v.map((x) => Math.abs(x - c));
      return useMedian ? medianOf(d) : meanOf(d);
    });
  });
  def(I, 'cummean_internal', () => num(0));
  void percentileLinear;
  void cpow;
}

function setOp<T>(op: string, x: T[], y: T[]): T[] {
  const sx = new Set(x), sy = new Set(y);
  switch (op) {
    case 'union': return [...new Set([...x, ...y])];
    case 'intersect': return [...sx].filter((v) => sy.has(v));
    case 'setdiff': return [...sx].filter((v) => !sy.has(v));
    default: return [...[...sx].filter((v) => !sy.has(v)), ...[...sy].filter((v) => !sx.has(v))];
  }
}

function studentT(t: number, df: number): number {
  // CDF via incomplete beta
  const x = df / (df + t * t);
  return 1 - 0.5 * betaInc(x, df / 2, 0.5);
}

function rankArr(v: number[]): number[] {
  const idx = v.map((_, i) => i).sort((a, b) => v[a] - v[b]);
  const r = new Array(v.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && v[idx[j + 1]] === v[idx[i]]) j++;
    for (let k = i; k <= j; k++) r[idx[k]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}

function pearsonR(x: number[], y: number[]): number {
  const n = x.length;
  const mx = meanOf(x), my = meanOf(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

function covMatrix(cols: number[][]): Tensor {
  const k = cols.length, n = cols[0].length;
  const m = cols.map((c) => meanOf(c));
  const out = zeros(k, k);
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
    let s = 0;
    for (let r = 0; r < n; r++) s += (cols[i][r] - m[i]) * (cols[j][r] - m[j]);
    out.re[j * k + i] = s / (n - 1);
  }
  return out;
}

function trap(x: number[], y: number[]): number {
  let s = 0;
  for (let i = 1; i < y.length; i++) s += ((y[i] + y[i - 1]) / 2) * (x[i] - x[i - 1]);
  return s;
}

export function meanOf(v: number[], omit = false): number {
  let s = 0, n = 0;
  for (const x of v) {
    if (omit && Number.isNaN(x)) continue;
    s += x;
    n++;
  }
  return n ? s / n : NaN;
}

export function medianOf(v: number[], omit = false): number {
  const s = (omit ? v.filter((x) => !Number.isNaN(x)) : v).slice().sort((a, b) => a - b);
  if (!omit && s.some((x) => Number.isNaN(x))) return NaN;
  const n = s.length;
  if (!n) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export function varOf(v: number[], w = 0, omit = false): number {
  const x = omit ? v.filter((y) => !Number.isNaN(y)) : v;
  const n = x.length;
  if (n === 1) return 0;
  const m = meanOf(x);
  let s = 0;
  for (const y of x) s += (y - m) ** 2;
  return s / (w === 1 ? n : n - 1);
}

function complexReduce(t: Tensor, dim: number, f: (re: number[], im: number[]) => [number, number]): Tensor {
  const re = reduce(t, dim, () => 0);
  re.im = new Float64Array(re.numel);
  const slices = dim === 1 ? t.cols : t.rows, len = dim === 1 ? t.rows : t.cols;
  for (let s = 0; s < slices; s++) {
    const vr: number[] = [], vi: number[] = [];
    for (let k = 0; k < len; k++) {
      const i = dim === 1 ? s * t.rows + k : k * t.rows + s;
      vr.push(t.re[i]);
      vi.push(t.im![i]);
    }
    const [x, y] = f(vr, vi);
    re.re[s] = x;
    re.im[s] = y;
  }
  return re.simplify();
}

function isPrime(n: number): boolean {
  if (!Number.isInteger(n) || n < 2) return false;
  if (n < 4) return true;
  if (n % 2 === 0) return false;
  for (let k = 3; k * k <= n; k += 2) if (n % k === 0) return false;
  return true;
}

function binaryWith(a: Value[], f: (x: number, y: number) => number, keepInt = false): Tensor {
  minArgs(a, 2);
  const x = toTensor(a[0]), y = toTensor(a[1]);
  const r = binaryWithT(x, y, f);
  if (keepInt && isIntClass(x.cls)) {
    for (let i = 0; i < r.numel; i++) r.re[i] = saturate(r.re[i], x.cls);
    return r.withClass(x.cls);
  }
  return r;
}

function binaryWithT(x: Tensor, y: Tensor, f: (x: number, y: number) => number): Tensor {
  const r = x.numel === 1 ? y.rows : x.rows === y.rows || y.rows === 1 ? x.rows : y.numel === 1 ? x.rows : -1;
  const c = x.numel === 1 ? y.cols : x.cols === y.cols || y.cols === 1 ? x.cols : y.numel === 1 ? x.cols : -1;
  if (x.numel === 1 && y.numel === 1) return num(f(x.re[0], y.re[0]));
  const rr = Math.max(x.rows === 1 ? y.rows : x.rows, 0), cc = Math.max(x.cols === 1 ? y.cols : x.cols, 0);
  if (r < 0 || c < 0 || (x.rows !== y.rows && x.rows !== 1 && y.rows !== 1) || (x.cols !== y.cols && x.cols !== 1 && y.cols !== 1)) throw new MError('Arrays have incompatible sizes for this operation.');
  const out = zeros(rr, cc);
  for (let j = 0; j < cc; j++) for (let i = 0; i < rr; i++) {
    const xi = (x.cols === 1 ? 0 : j) * x.rows + (x.rows === 1 ? 0 : i);
    const yi = (y.cols === 1 ? 0 : j) * y.rows + (y.rows === 1 ? 0 : i);
    out.re[j * rr + i] = f(x.re[xi], y.re[yi]);
  }
  return out;
}

function flipCols(v: Value): Value {
  if (v.kind === 'tensor') {
    const out = v.clone();
    for (let j = 0; j < v.cols; j++) for (let i = 0; i < v.rows; i++) {
      out.re[(v.cols - 1 - j) * v.rows + i] = v.re[j * v.rows + i];
      if (v.im) out.im![(v.cols - 1 - j) * v.rows + i] = v.im[j * v.rows + i];
    }
    return out;
  }
  if (v.kind === 'cell') {
    const d = new Array(v.numel);
    for (let j = 0; j < v.cols; j++) for (let i = 0; i < v.rows; i++) d[(v.cols - 1 - j) * v.rows + i] = v.data[j * v.rows + i];
    return new CellArray(v.rows, v.cols, d);
  }
  if (v.kind === 'string') return new StringArray(v.rows, v.cols, [...v.data].reverse());
  return v;
}

function flipRows(v: Value): Value {
  if (v.kind === 'tensor') {
    const out = v.clone();
    for (let j = 0; j < v.cols; j++) for (let i = 0; i < v.rows; i++) {
      out.re[j * v.rows + (v.rows - 1 - i)] = v.re[j * v.rows + i];
      if (v.im) out.im![j * v.rows + (v.rows - 1 - i)] = v.im[j * v.rows + i];
    }
    return out;
  }
  if (v.kind === 'cell') {
    const d = new Array(v.numel);
    for (let j = 0; j < v.cols; j++) for (let i = 0; i < v.rows; i++) d[j * v.rows + (v.rows - 1 - i)] = v.data[j * v.rows + i];
    return new CellArray(v.rows, v.cols, d);
  }
  return v;
}

function transposeValue(v: Value, conj = true): Value {
  // local import avoidance
  if (v.kind === 'tensor') {
    const out = new Tensor(v.cols, v.rows, new Float64Array(v.numel), v.im ? new Float64Array(v.numel) : null, v.cls);
    for (let i = 0; i < v.rows; i++) for (let j = 0; j < v.cols; j++) {
      out.re[i * v.cols + j] = v.re[j * v.rows + i];
      if (v.im) out.im![i * v.cols + j] = conj ? -v.im[j * v.rows + i] : v.im[j * v.rows + i];
    }
    return out;
  }
  if (v.kind === 'cell') {
    const d = new Array(v.numel);
    for (let i = 0; i < v.rows; i++) for (let j = 0; j < v.cols; j++) d[i * v.cols + j] = v.data[j * v.rows + i];
    return new CellArray(v.cols, v.rows, d);
  }
  return v;
}
