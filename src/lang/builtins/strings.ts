import { CellArray, MError, StringArray, StructArray, Tensor, bool, cellOf, charMatrix, isStringLike, num, str, strArr, toNumber, toStringValue, toTensor, zeros, rowVec, type Value } from '../value';
import { shortDesc } from '../display';
import type { Interpreter } from '../interp';
import { argNum, argStr, def, hasFlag, mapBool, minArgs, strings } from './helpers';

function escapes(s: string): string {
  return s.replace(/\\(n|t|r|\\|a|b|f|v|0|x[0-9a-fA-F]{1,2}|[0-7]{1,3})/g, (_m, c: string) => {
    switch (c[0]) {
      case 'n': return '\n';
      case 't': return '\t';
      case 'r': return '\r';
      case '\\': return '\\';
      case 'a': return '\x07';
      case 'b': return '\b';
      case 'f': return '\f';
      case 'v': return '\v';
      case 'x': return String.fromCharCode(parseInt(c.slice(1), 16));
      default: return String.fromCharCode(parseInt(c, 8));
    }
  });
}

function flattenArgs(args: Value[]): (number | string)[] {
  const out: (number | string)[] = [];
  for (const a of args) {
    if (a.kind === 'tensor') {
      if (a.cls === 'char') out.push(a.toStr());
      else for (let i = 0; i < a.numel; i++) out.push(a.re[i]);
    } else if (a.kind === 'string') out.push(...a.data);
    else if (a.kind === 'cell') {
      for (const c of a.data) out.push(...flattenArgs([c]));
    } else if (a.kind === 'fhandle') out.push(a.toString());
    else throw new MError('Only numeric, character and string arguments are supported in sprintf.');
  }
  return out;
}

function pad(s: string, width: number | undefined, left: boolean, zero: boolean): string {
  if (width === undefined || s.length >= width) return s;
  if (left) return s.padEnd(width);
  if (zero && /^[+-]?\d/.test(s)) {
    const sign = /^[+-]/.test(s) ? s[0] : '';
    return sign + s.slice(sign.length).padStart(width - sign.length, '0');
  }
  return s.padStart(width);
}

function fmtExp(x: number, prec: number, upper = false): string {
  let s = x.toExponential(prec);
  s = s.replace(/e([+-])(\d)$/, 'e$10$2');
  return upper ? s.toUpperCase() : s;
}

function fmtG(x: number, prec: number, alt: boolean, upper = false): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 'NaN' : x > 0 ? 'Inf' : '-Inf';
  if (prec === 0) prec = 1;
  if (x === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(x)));
  let s: string;
  if (e < -4 || e >= prec) {
    s = x.toExponential(prec - 1);
    if (!alt) s = s.replace(/\.?0+e/, 'e');
    s = s.replace(/e([+-])(\d)$/, 'e$10$2');
  } else {
    s = x.toFixed(Math.max(0, prec - 1 - e));
    if (!alt && s.includes('.')) s = s.replace(/\.?0+$/, '');
  }
  return upper ? s.toUpperCase() : s;
}

export function formatSprintf(fmtIn: string, args: Value[]): string {
  const fmt = escapes(fmtIn);
  const vals = flattenArgs(args);
  const spec = /%([-+ 0#]*)(\*|\d+)?(?:\.(\*|\d+))?([lhL]?)([diouxXfFeEgGcs%])/g;
  const hasSpecs = /%(?!%)/.test(fmt.replace(/%%/g, ''));
  let out = '';
  let vi = 0;
  const render = (): boolean => {
    // returns false if we ran out of values mid-format
    let last = 0;
    spec.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = spec.exec(fmt))) {
      out += fmt.slice(last, m.index);
      last = spec.lastIndex;
      const [, flags, wS, pS, , conv] = m;
      if (conv === '%') {
        out += '%';
        continue;
      }
      let width = wS === '*' ? Number(vals[vi++]) : wS ? Number(wS) : undefined;
      let prec = pS === '*' ? Number(vals[vi++]) : pS !== undefined ? Number(pS) : undefined;
      if (vi >= vals.length) {
        if (vals.length === 0 && vi === 0) {
          // No arguments: output literal text up to the first conversion
          return false;
        }
        return false;
      }
      const v = vals[vi++];
      const left = flags.includes('-'), zero = flags.includes('0'), plus = flags.includes('+'), space = flags.includes(' '), alt = flags.includes('#');
      let s: string;
      const sign = (x: number, body: string) => (x >= 0 && !Object.is(x, -0) ? (plus ? '+' : space ? ' ' : '') : '') + body;
      if (conv === 's') {
        s = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : fmtG(v, 15, false).replace(/e([+-])0(\d)$/, 'e$1$2')) : v;
        if (prec !== undefined) s = s.slice(0, prec);
      } else if (conv === 'c') {
        s = typeof v === 'number' ? String.fromCharCode(v) : v;
      } else {
        if (typeof v === 'string') {
          // character data printed with a numeric conversion: print chars as codes for %d, string otherwise
          if (conv === 'd' || conv === 'i' || conv === 'u') {
            out += v;
            continue;
          }
          s = v;
          out += pad(s, width, left, false);
          continue;
        }
        const x = v;
        switch (conv) {
          case 'd':
          case 'i':
          case 'u':
            if (!Number.isInteger(x)) {
              s = Number.isFinite(x) ? sign(x, fmtExp(x, prec ?? 6)) : Number.isNaN(x) ? 'NaN' : x > 0 ? 'Inf' : '-Inf';
            } else s = sign(x, String(Math.abs(x) >= 1e21 ? x.toExponential() : x));
            break;
          case 'f':
          case 'F':
            s = Number.isFinite(x) ? sign(x, x.toFixed(prec ?? 6)) : Number.isNaN(x) ? 'NaN' : x > 0 ? 'Inf' : '-Inf';
            break;
          case 'e':
          case 'E':
            s = Number.isFinite(x) ? sign(x, fmtExp(x, prec ?? 6, conv === 'E')) : Number.isNaN(x) ? 'NaN' : x > 0 ? 'Inf' : '-Inf';
            break;
          case 'g':
          case 'G':
            s = sign(x, fmtG(x, prec ?? 6, alt, conv === 'G'));
            break;
          case 'x':
          case 'X':
            s = Number.isInteger(x) ? Math.trunc(x).toString(16) : fmtExp(x, 6);
            if (conv === 'X') s = s.toUpperCase();
            if (alt) s = '0x' + s;
            break;
          case 'o':
            s = Number.isInteger(x) ? Math.trunc(x).toString(8) : fmtExp(x, 6);
            break;
          default:
            s = String(x);
        }
      }
      out += pad(s, width, left, zero && !left && conv !== 's' && conv !== 'c');
      width = undefined;
      prec = undefined;
    }
    out += fmt.slice(last);
    return true;
  };
  if (!hasSpecs) {
    out = fmt.replace(/%%/g, '%');
    return out;
  }
  if (vals.length === 0) {
    // print up to first conversion spec
    const idx = fmt.search(/%(?!%)/);
    return fmt.slice(0, idx).replace(/%%/g, '%');
  }
  let guard = 0;
  while (vi < vals.length && guard++ < 1e6) {
    const before = vi;
    const savedLen = out.length;
    const complete = render();
    if (!complete) {
      // trim output after the last consumed conversion
      const partial = out;
      out = partial;
      break;
    }
    if (vi === before) break;
    void savedLen;
  }
  return out;
}

export function num2str(v: Value, arg?: Value): string {
  if (v.kind === 'tensor' && v.cls === 'char') return v.toStr();
  if (v.kind === 'string') return v.data[0];
  const t = toTensor(v);
  if (arg && isStringLike(arg)) {
    const f = toStringValue(arg);
    const lines: string[] = [];
    for (let i = 0; i < t.rows; i++) {
      const vals: Value[] = [];
      for (let j = 0; j < t.cols; j++) vals.push(num(t.re[j * t.rows + i]));
      lines.push(formatSprintf(f, vals));
    }
    return lines.join('\n');
  }
  const prec = arg ? toNumber(arg) : undefined;
  const fmt1 = (x: number, im?: number) => {
    const one = (y: number) => {
      if (Number.isNaN(y)) return 'NaN';
      if (!Number.isFinite(y)) return y > 0 ? 'Inf' : '-Inf';
      if (prec !== undefined) return fmtG(y, prec, false);
      if (Number.isInteger(y)) return String(y);
      return fmtG(y, Math.max(5, Math.floor(Math.log10(Math.abs(y))) + 5), false);
    };
    if (im === undefined || im === 0) return one(x);
    return `${one(x)}${im < 0 ? '-' : '+'}${one(Math.abs(im))}i`;
  };
  if (t.numel === 1) return fmt1(t.re[0], t.im?.[0]);
  const strs = Array.from(t.re, (x, i) => fmt1(x, t.im?.[i]));
  const w = Math.max(...strs.map((s) => s.length));
  const lines: string[] = [];
  for (let i = 0; i < t.rows; i++) {
    const parts: string[] = [];
    for (let j = 0; j < t.cols; j++) parts.push(strs[j * t.rows + i].padStart(w));
    lines.push(parts.join('  '));
  }
  // remove common leading whitespace
  const minLead = Math.min(...lines.map((l) => l.length - l.trimStart().length));
  return lines.map((l) => l.slice(minLead)).join('\n');
}

export function mat2str(v: Value, prec = 15): string {
  if (v.kind === 'tensor' && v.cls === 'char') return `'${v.toStr()}'`;
  const t = toTensor(v);
  const f = (x: number, i: number) => {
    let s = Number.isInteger(x) ? String(x) : Number.isNaN(x) ? 'NaN' : !Number.isFinite(x) ? (x > 0 ? 'Inf' : '-Inf') : String(Number(x.toPrecision(prec)));
    if (t.im) {
      const im = t.im[i];
      s += (im < 0 ? '-' : '+') + String(Number(Math.abs(im).toPrecision(prec))) + 'i';
    }
    return t.cls === 'logical' ? (x ? 'true' : 'false') : s;
  };
  if (t.numel === 1) return f(t.re[0], 0);
  const rows: string[] = [];
  for (let i = 0; i < t.rows; i++) {
    const r: string[] = [];
    for (let j = 0; j < t.cols; j++) r.push(f(t.re[j * t.rows + i], j * t.rows + i));
    rows.push(r.join(' '));
  }
  return `[${rows.join(';')}]`;
}

function translateRegex(p: string): string {
  // MATLAB regex is close to JS; translate (?<name>...) is the same; \< \> word boundaries
  return p.replace(/\\</g, '\\b').replace(/\\>/g, '\\b');
}

function strOrCellMap(v: Value, f: (s: string) => string): Value {
  if (v.kind === 'cell') return new CellArray(v.rows, v.cols, v.data.map((x) => strOrCellMap(x, f)));
  if (v.kind === 'string') return new StringArray(v.rows, v.cols, v.data.map(f));
  if (v.kind === 'tensor' && v.cls === 'char' && v.rows > 1) return charMatrix(v.rowStrings().map(f));
  return str(f(toStringValue(v)));
}

function strOrCellTest(v: Value, f: (s: string) => boolean): Value {
  if (v.kind === 'cell' || v.kind === 'string') {
    const data = v.kind === 'cell' ? v.data.map((x) => toStringValue(x)) : v.data;
    const t = zeros(v.rows, v.cols, 'logical');
    data.forEach((s, i) => (t.re[i] = f(s) ? 1 : 0));
    return t;
  }
  return bool(f(toStringValue(v)));
}

export function registerStrings(I: Interpreter) {
  def(I, 'sprintf', (a) => {
    minArgs(a, 1);
    const s = formatSprintf(toStringValue(a[0]), a.slice(1));
    return a[0].kind === 'string' ? StringArray.scalar(s) : str(s);
  });
  def(I, 'compose', (a) => StringArray.scalar(formatSprintf(toStringValue(a[0]), a.slice(1))));
  def(I, 'num2str', (a) => {
    const s = num2str(a[0], a[1]);
    return s.includes('\n') ? charMatrix(s.split('\n')) : str(s);
  });
  def(I, 'int2str', (a) => str(num2str(new Tensor(a[0].rows, a[0].cols, Float64Array.from(toTensor(a[0]).re, (x) => Math.round(x))))));
  def(I, 'mat2str', (a) => str(mat2str(a[0], a.length > 1 ? argNum(a, 1) : 15)));
  def(I, 'str2num', (a, _n, ctx) => {
    const s = argStr(a, 0);
    try {
      return ctx.interp.evaluateToValue(s.includes('[') ? s : `[${s}]`);
    } catch {
      return zeros(0, 0);
    }
  });
  def(I, 'str2double', (a) => {
    const v = a[0];
    const conv = (s: string) => {
      const t = s.trim().replace(/,/g, '');
      if (/^[+-]?inf$/i.test(t)) return t.startsWith('-') ? -Infinity : Infinity;
      if (/^nan$/i.test(t)) return NaN;
      if (!/^[+-]?(\d+\.?\d*|\.\d+)([eEdD][+-]?\d+)?$/.test(t)) return NaN;
      return Number(t.replace(/[dD]/, 'e'));
    };
    if (v.kind === 'cell' || v.kind === 'string') {
      const data = v.kind === 'cell' ? v.data.map((x) => (isStringLike(x) ? toStringValue(x) : '')) : v.data;
      const t = zeros(v.rows, v.cols);
      data.forEach((s, i) => (t.re[i] = conv(s)));
      return t;
    }
    if (v.kind === 'tensor' && v.cls !== 'char') return num(NaN);
    return num(conv(toStringValue(v)));
  });
  def(I, 'string', (a) => {
    const v = a[0];
    if (!v) return StringArray.scalar('');
    if (v.kind === 'string') return v;
    if (v.kind === 'cell') return new StringArray(v.rows, v.cols, v.data.map((x) => toStringValue(x)));
    if (v.kind === 'tensor' && v.cls === 'char') return v.rows > 1 ? new StringArray(v.rows, 1, v.rowStrings()) : StringArray.scalar(v.toStr());
    const t = toTensor(v);
    return new StringArray(t.rows, t.cols, Array.from(t.re, (x) => (t.cls === 'logical' ? (x ? 'true' : 'false') : num2str(num(x)))));
  });
  def(I, 'char', (a) => {
    if (!a.length) return str('');
    if (a.length > 1 || a[0].kind === 'cell' || (a[0].kind === 'string' && a[0].numel > 1)) {
      const lines = a.flatMap((x) => (x.kind === 'cell' ? x.data.map((y) => toStringValue(y)) : x.kind === 'string' ? x.data : [toStringValue(x)]));
      return charMatrix(lines);
    }
    const v = a[0];
    if (v.kind === 'string') return str(v.data[0]);
    const t = toTensor(v);
    return new Tensor(t.rows, t.cols, Float64Array.from(t.re), null, 'char');
  });
  def(I, 'cellstr', (a) => {
    const v = a[0];
    if (v.kind === 'cell') return v;
    if (v.kind === 'string') return new CellArray(v.rows, v.cols, v.data.map((s) => str(s)));
    const t = toTensor(v);
    const rows = t.rows ? t.rowStrings().map((s) => str(s.trimEnd())) : [str('')];
    return new CellArray(rows.length, 1, rows);
  });
  def(I, 'blanks', (a) => str(' '.repeat(argNum(a, 0))));
  def(I, 'newline', () => str('\n'));
  def(I, 'deblank', (a) => strOrCellMap(a[0], (s) => s.replace(/[\s\0]+$/, '')));
  def(I, 'strtrim', (a) => strOrCellMap(a[0], (s) => s.trim()));
  def(I, 'upper', (a) => strOrCellMap(a[0], (s) => s.toUpperCase()));
  def(I, 'lower', (a) => strOrCellMap(a[0], (s) => s.toLowerCase()));
  def(I, 'fliplr_str', (a) => strOrCellMap(a[0], (s) => [...s].reverse().join('')));
  def(I, 'strcat', (a) => {
    if (a.some((x) => x.kind === 'cell')) {
      const n = Math.max(...a.map((x) => (x.kind === 'cell' ? x.numel : 1)));
      const shape = a.find((x) => x.kind === 'cell')!;
      const data = Array.from({ length: n }, (_, i) => str(a.map((x) => (x.kind === 'cell' ? toStringValue(x.data[x.numel === 1 ? 0 : i]) : toStringValue(x))).join('')));
      return new CellArray(shape.rows, shape.cols, data);
    }
    if (a.some((x) => x.kind === 'string')) return StringArray.scalar(a.map((x) => toStringValue(x)).join(''));
    return str(a.map((x) => (x.kind === 'tensor' && x.cls === 'char' ? toStringValue(x).replace(/\s+$/, '') : toStringValue(x))).join(''));
  });
  def(I, 'strvcat', (a) => charMatrix(a.flatMap((x) => strings(x)).filter((s) => s.length)));
  def(I, ['strcmp', 'strcmpi', 'strncmp', 'strncmpi'], (a, _n, ctx) => {
    minArgs(a, 2);
    const ci = ctx.name.endsWith('i');
    const nlim = ctx.name.startsWith('strn') ? argNum(a, 2) : Infinity;
    const norm = (s: string) => {
      const t = ci ? s.toLowerCase() : s;
      return nlim === Infinity ? t : t.slice(0, nlim);
    };
    const cmp = (x: Value, y: Value): boolean => {
      if (!isStringLike(x) || !isStringLike(y)) {
        if (x.kind === 'tensor' && x.cls === 'char' && y.kind === 'tensor' && y.cls === 'char') return norm(x.toStr()) === norm(y.toStr());
        return false;
      }
      const sx = toStringValue(x), sy = toStringValue(y);
      if (nlim !== Infinity && (sx.length < nlim || sy.length < nlim)) return false;
      return norm(sx) === norm(sy);
    };
    const [x, y] = a;
    const isArr = (v: Value) => v.kind === 'cell' || (v.kind === 'string' && v.numel > 1);
    const items = (v: Value): Value[] => (v.kind === 'cell' ? v.data : v.kind === 'string' ? v.data.map((s) => StringArray.scalar(s)) : [v]);
    if (isArr(x) || isArr(y)) {
      const xi = items(x), yi = items(y);
      const shape = isArr(x) ? x : y;
      const n = Math.max(xi.length, yi.length);
      if (xi.length !== 1 && yi.length !== 1 && xi.length !== yi.length) throw new MError('Inputs must be the same size or either one can be a scalar.');
      const t = zeros(shape.rows, shape.cols, 'logical');
      for (let i = 0; i < n; i++) t.re[i] = cmp(xi[xi.length === 1 ? 0 : i], yi[yi.length === 1 ? 0 : i]) ? 1 : 0;
      return t;
    }
    return bool(cmp(x, y));
  });
  def(I, 'strfind', (a) => {
    const s = argStr(a, 0), p = argStr(a, 1);
    const idx: number[] = [];
    if (p.length) for (let i = s.indexOf(p); i >= 0; i = s.indexOf(p, i + 1)) idx.push(i + 1);
    return idx.length ? rowVec(idx) : zeros(1, 0);
  });
  def(I, 'strrep', (a) => {
    const from = argStr(a, 1), to = argStr(a, 2);
    return strOrCellMap(a[0], (s) => (from ? s.split(from).join(to) : s));
  });
  def(I, ['replace', 'erase'], (a, _n, ctx) => {
    const to = ctx.name === 'erase' ? '' : argStr(a, 2);
    const pats = strings(a[1]);
    return strOrCellMap(a[0], (s) => pats.reduce((acc, p) => acc.split(p).join(to), s));
  });
  def(I, ['strsplit', 'split'], (a, _n, ctx) => {
    const s = argStr(a, 0);
    const delims = a.length > 1 && isStringLike(a[1]) || (a[1]?.kind === 'cell') ? strings(a[1]).map(escapes) : [' ', '\t', '\n'];
    const re = new RegExp(delims.map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + (a.length <= 1 ? '+' : ''));
    const parts = s.split(re);
    if (ctx.name === 'split') return new StringArray(parts.length, 1, parts);
    return cellOf(parts.map((p) => str(p)));
  });
  def(I, ['strjoin', 'join'], (a) => {
    const parts = strings(a[0]);
    const d = a.length > 1 ? escapes(argStr(a, 1)) : ' ';
    const s = parts.join(d);
    return a[0].kind === 'string' ? StringArray.scalar(s) : str(s);
  });
  def(I, 'strtok', (a, nargout) => {
    const s = argStr(a, 0);
    const delims = a.length > 1 ? argStr(a, 1) : ' \t\n\r\f\v';
    let i = 0;
    while (i < s.length && delims.includes(s[i])) i++;
    let j = i;
    while (j < s.length && !delims.includes(s[j])) j++;
    return nargout > 1 ? [str(s.slice(i, j)), str(s.slice(j))] : str(s.slice(i, j));
  });
  def(I, ['contains', 'startsWith', 'endsWith'], (a, _n, ctx) => {
    const pats = strings(a[1]);
    const ignore = a.length > 3 && toStringValue(a[2]).toLowerCase() === 'ignorecase' && !!toNumber(a[3]);
    const f = (s: string) => pats.some((p) => {
      const x = ignore ? s.toLowerCase() : s, y = ignore ? p.toLowerCase() : p;
      return ctx.name === 'contains' ? x.includes(y) : ctx.name === 'startsWith' ? x.startsWith(y) : x.endsWith(y);
    });
    return strOrCellTest(a[0], f);
  });
  def(I, 'strlength', (a) => {
    const v = a[0];
    if (v.kind === 'string' || v.kind === 'cell') {
      const d = strings(v);
      const t = zeros(v.rows, v.cols);
      d.forEach((s, i) => (t.re[i] = s.length));
      return t;
    }
    return num(toStringValue(v).length);
  });
  def(I, ['extractBefore', 'extractAfter'], (a, _n, ctx) => {
    const p = a[1];
    return strOrCellMap(a[0], (s) => {
      if (isStringLike(p)) {
        const ps = toStringValue(p);
        const i = s.indexOf(ps);
        if (i < 0) return '';
        return ctx.name === 'extractBefore' ? s.slice(0, i) : s.slice(i + ps.length);
      }
      const k = toNumber(p);
      return ctx.name === 'extractBefore' ? s.slice(0, k - 1) : s.slice(k);
    });
  });
  def(I, 'extractBetween', (a) => {
    const s = argStr(a, 0), l = argStr(a, 1), r = argStr(a, 2);
    const i = s.indexOf(l);
    if (i < 0) return str('');
    const j = s.indexOf(r, i + l.length);
    return str(j < 0 ? '' : s.slice(i + l.length, j));
  });
  def(I, 'pad', (a) => {
    const w = a.length > 1 && !isStringLike(a[1]) ? argNum(a, 1) : undefined;
    return strOrCellMap(a[0], (s) => (w !== undefined ? s.padEnd(w) : s));
  });
  def(I, 'reverse', (a) => strOrCellMap(a[0], (s) => [...s].reverse().join('')));
  def(I, ['isspace', 'isletter', 'isstrprop'], (a, _n, ctx) => {
    const t = toTensor(a[0]);
    let test: (c: string) => boolean;
    const kind = ctx.name === 'isstrprop' ? argStr(a, 1) : ctx.name === 'isspace' ? 'wspace' : 'alpha';
    switch (kind) {
      case 'wspace': test = (c) => /\s/.test(c); break;
      case 'digit': test = (c) => /\d/.test(c); break;
      case 'alphanum': test = (c) => /[A-Za-z0-9]/.test(c); break;
      case 'upper': test = (c) => /[A-Z]/.test(c); break;
      case 'lower': test = (c) => /[a-z]/.test(c); break;
      case 'punct': test = (c) => /[!-\/:-@[-`{-~]/.test(c); break;
      default: test = (c) => /[A-Za-z]/.test(c);
    }
    return mapBool(t, (x) => test(String.fromCharCode(x)));
  });
  def(I, ['regexp', 'regexpi'], (a, nargout, ctx) => {
    const s = argStr(a, 0);
    const flags = ctx.name === 'regexpi' || hasFlag(a.slice(2), 'ignorecase') ? 'gi' : 'g';
    const re = new RegExp(translateRegex(argStr(a, 1)), flags);
    const opts = a.slice(2).filter(isStringLike).map((x) => toStringValue(x));
    const once = opts.includes('once');
    const matches = [...s.matchAll(re)];
    const results: Record<string, Value> = {};
    const use = once ? matches.slice(0, 1) : matches;
    const asOut = (vals: Value[]) => (once ? vals[0] ?? str('') : cellOf(vals));
    results.match = asOut(use.map((m) => str(m[0])));
    results.tokens = once ? cellOf((use[0] ? use[0].slice(1) : []).map((t) => str(t ?? ''))) : cellOf(use.map((m) => cellOf(m.slice(1).map((t) => str(t ?? '')))));
    results.start = once ? (use[0] ? num(use[0].index! + 1) : zeros(1, 0)) : use.length ? rowVec(use.map((m) => m.index! + 1)) : zeros(1, 0);
    results.end = once ? (use[0] ? num(use[0].index! + use[0][0].length) : zeros(1, 0)) : use.length ? rowVec(use.map((m) => m.index! + m[0].length)) : zeros(1, 0);
    results.split = cellOf(s.split(new RegExp(translateRegex(argStr(a, 1)), flags.replace('g', ''))).map((p) => str(p)));
    const names = use[0]?.groups ? Object.keys(use[0].groups) : [];
    results.names = StructArray.scalar(names.map((n) => [n, str(use[0]?.groups?.[n] ?? '')] as [string, Value]));
    const order = ['start', 'end', 'tokenExtents', 'match', 'tokens', 'names', 'split'];
    const requested = opts.filter((o) => order.includes(o) || o === 'tokenExtents');
    if (requested.length) return requested.slice(0, Math.max(1, nargout)).map((o) => results[o] ?? zeros(0, 0));
    return order.slice(0, Math.max(1, nargout)).map((o) => results[o] ?? zeros(0, 0));
  });
  def(I, ['regexprep'], (a) => {
    const flags = hasFlag(a.slice(3), 'ignorecase') ? 'gi' : hasFlag(a.slice(3), 'once') ? '' : 'g';
    const re = new RegExp(translateRegex(argStr(a, 1)), flags);
    const rep = argStr(a, 2).replace(/\$(\d)/g, '$$$1');
    return strOrCellMap(a[0], (s) => s.replace(re, rep));
  });
  def(I, 'validatestring', (a) => {
    const s = argStr(a, 0).toLowerCase();
    const opts = strings(a[1]);
    const m = opts.find((o) => o.toLowerCase().startsWith(s));
    if (!m) throw new MError(`Expected input to match one of these values: ${opts.join(', ')}`);
    return str(m);
  });
  def(I, 'num2cell', (a) => {
    const v = a[0];
    if (v.kind === 'cell') return v;
    if (v.kind === 'tensor') return new CellArray(v.rows, v.cols, Array.from(v.re, (x, i) => {
      const t = new Tensor(1, 1, Float64Array.of(x), v.im ? Float64Array.of(v.im[i]) : null, v.cls);
      return t;
    }));
    if (v.kind === 'string') return new CellArray(v.rows, v.cols, v.data.map((s) => StringArray.scalar(s)));
    return cellOf([v]);
  });
  def(I, 'dec2bin', (a) => str(Math.trunc(argNum(a, 0)).toString(2).padStart(a.length > 1 ? argNum(a, 1) : 0, '0')));
  def(I, 'bin2dec', (a) => num(parseInt(argStr(a, 0), 2)));
  def(I, 'dec2hex', (a) => str(Math.trunc(argNum(a, 0)).toString(16).toUpperCase().padStart(a.length > 1 ? argNum(a, 1) : 0, '0')));
  def(I, 'hex2dec', (a) => num(parseInt(argStr(a, 0), 16)));
  def(I, 'dec2base', (a) => str(Math.trunc(argNum(a, 0)).toString(argNum(a, 1)).toUpperCase()));
  def(I, 'base2dec', (a) => num(parseInt(argStr(a, 0), argNum(a, 1))));
  def(I, 'disp_short', (a) => str(shortDesc(a[0])));
  def(I, 'sprintf_internal', () => str(''));
  def(I, 'unicode2native', (a) => rowVec([...new TextEncoder().encode(argStr(a, 0))]));
  def(I, 'native2unicode', (a) => str(new TextDecoder().decode(Uint8Array.from(toTensor(a[0]).re))));
  def(I, 'strArr', (a) => strArr(a.map((x) => toStringValue(x))));
}

