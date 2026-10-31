import { className, type Tensor, type Value } from './value';

export interface DisplayOptions {
  format: 'short' | 'long' | 'shortG' | 'longG' | 'shortE' | 'longE' | 'bank' | 'rat';
  compact: boolean;
  width: number;
}

export const defaultDisplay: DisplayOptions = { format: 'short', compact: false, width: 100 };

function dims(v: Value) {
  return `${v.rows}×${v.cols}`;
}

function fmtReal(x: number, mode: DisplayOptions['format']): string {
  if (Number.isNaN(x)) return 'NaN';
  if (x === Infinity) return 'Inf';
  if (x === -Infinity) return '-Inf';
  const long = mode === 'long' || mode === 'longG' || mode === 'longE';
  if (mode === 'shortE' || mode === 'longE') return x.toExponential(long ? 15 : 4).replace(/e([+-])(\d)$/, 'e$10$2');
  if (mode === 'bank') return x.toFixed(2);
  if (mode === 'rat') return rat(x);
  if (Number.isInteger(x) && Math.abs(x) < 1e15) return String(x);
  const a = Math.abs(x);
  if (mode === 'shortG' || mode === 'longG') {
    const s = x.toPrecision(long ? 15 : 5);
    return s.includes('e') ? s.replace(/\.?0+e/, 'e').replace(/e([+-])(\d)$/, 'e$10$2') : String(Number(s));
  }
  if (a >= 1e5 || a < 1e-3) return x.toExponential(long ? 15 : 4).replace(/e([+-])(\d)$/, 'e$10$2');
  return x.toFixed(long ? 15 - Math.max(0, Math.floor(Math.log10(a)) + 1) + (a < 1 ? 1 : 0) : 4);
}

function rat(x: number): string {
  if (Number.isInteger(x)) return String(x);
  let h1 = 1, h2 = 0, k1 = 0, k2 = 1, b = x;
  for (let i = 0; i < 20; i++) {
    const a = Math.floor(b);
    [h1, h2] = [a * h1 + h2, h1];
    [k1, k2] = [a * k1 + k2, k1];
    if (Math.abs(x - h1 / k1) < 1e-10 * Math.abs(x)) break;
    b = 1 / (b - a);
  }
  return `${h1}/${k1}`;
}

function allInts(t: Tensor): boolean {
  for (let i = 0; i < t.numel; i++) {
    const v = t.re[i];
    if (Number.isFinite(v) && !Number.isInteger(v)) return false;
    if (t.im && Number.isFinite(t.im[i]) && !Number.isInteger(t.im[i])) return false;
  }
  return true;
}

function formatNumericMatrix(t: Tensor, opts: DisplayOptions): string[] {
  const mode = opts.format;
  const n = t.numel;
  if (t.cls === 'logical' || (t.cls !== 'double' && t.cls !== 'single' && t.cls !== 'char')) {
    const strs = Array.from(t.re, (v) => String(v));
    const w = Math.max(...strs.map((s) => s.length)) + 2;
    return grid(t, strs, w, opts);
  }
  let scale = 1;
  let strs: string[];
  const ints = allInts(t);
  if (ints && !t.im) {
    strs = Array.from(t.re, (v) => fmtReal(v, mode === 'short' || mode === 'long' ? 'short' : mode));
    if (!strs.every((s) => s.length < 10) && (mode === 'short')) {
      // large integers → exponent display
      strs = Array.from(t.re, (v) => (Math.abs(v) >= 1e9 ? v.toExponential(4).replace(/e([+-])(\d)$/, 'e$10$2') : String(v)));
    }
  } else {
    let maxAbs = 0, minAbs = Infinity;
    for (let i = 0; i < n; i++) {
      const v = Math.abs(t.re[i]);
      if (Number.isFinite(v)) {
        maxAbs = Math.max(maxAbs, v);
        if (v > 0) minAbs = Math.min(minAbs, v);
      }
      if (t.im) {
        const w = Math.abs(t.im[i]);
        if (Number.isFinite(w)) maxAbs = Math.max(maxAbs, w);
      }
    }
    const long = mode === 'long';
    if ((mode === 'short' || mode === 'long') && n > 1 && maxAbs > 0 && (maxAbs >= 1e3 || maxAbs < 1e-3)) {
      const e = Math.floor(Math.log10(maxAbs));
      if (maxAbs / Math.max(minAbs, 1e-300) < 1e5) scale = Math.pow(10, e);
    }
    const dec = long ? 15 : 4;
    const fmt = (v: number) => {
      if (Number.isNaN(v)) return 'NaN';
      if (!Number.isFinite(v)) return v > 0 ? 'Inf' : '-Inf';
      if (mode !== 'short' && mode !== 'long') return fmtReal(v, mode);
      const s = v / scale;
      if (scale === 1 && n === 1) return fmtReal(v, mode);
      if (scale === 1 && (Math.abs(s) >= 1e5 || (Math.abs(s) < 1e-3 && s !== 0))) return v.toExponential(dec).replace(/e([+-])(\d)$/, 'e$10$2');
      return s === 0 ? '0' : s.toFixed(dec);
    };
    strs = [];
    for (let i = 0; i < n; i++) {
      let s = fmt(t.re[i]);
      if (t.im) {
        const im = t.im[i];
        const ims = fmt(Math.abs(im));
        s = `${s} ${im < 0 || Object.is(im, -0) ? '-' : '+'} ${ims}i`;
      }
      strs.push(s);
    }
  }
  const w = Math.max(...strs.map((s) => s.length)) + (ints && !t.im ? 3 : 4);
  const width = Math.max(ints && !t.im && t.numel > 0 ? 6 : 10, w);
  const lines = grid(t, strs, width, opts);
  if (scale !== 1) {
    const e = Math.round(Math.log10(scale));
    lines.unshift(`   1.0e${e >= 0 ? '+' : '-'}${String(Math.abs(e)).padStart(2, '0')} *`, ...(opts.compact ? [] : ['']));
  }
  return lines;
}

function grid(t: Tensor, strs: string[], width: number, opts: DisplayOptions): string[] {
  const perLine = Math.max(1, Math.floor(opts.width / width));
  const lines: string[] = [];
  if (t.cols <= perLine) {
    for (let r = 0; r < t.rows; r++) {
      let line = '';
      for (let c = 0; c < t.cols; c++) line += strs[c * t.rows + r].padStart(width);
      lines.push(line);
    }
    return lines;
  }
  for (let c0 = 0; c0 < t.cols; c0 += perLine) {
    const c1 = Math.min(t.cols, c0 + perLine);
    lines.push(c1 - c0 === 1 ? `  Column ${c0 + 1}` : c1 === t.cols ? `  Columns ${c0 + 1} through ${c1}` : `  Columns ${c0 + 1} through ${c1}`);
    if (!opts.compact) lines.push('');
    for (let r = 0; r < t.rows; r++) {
      let line = '';
      for (let c = c0; c < c1; c++) line += strs[c * t.rows + r].padStart(width);
      lines.push(line);
    }
    if (!opts.compact) lines.push('');
  }
  return lines;
}

/** Short inline description used inside cells and struct fields. */
export function shortDesc(v: Value, opts: DisplayOptions = defaultDisplay): string {
  switch (v.kind) {
    case 'tensor': {
      if (v.cls === 'char') return v.rows <= 1 ? `'${v.toStr()}'` : `${dims(v)} char`;
      if (v.numel === 0) return v.cls === 'double' ? '[]' : `${dims(v)} ${v.cls}`;
      if (v.numel === 1) {
        const s = formatNumericMatrix(v, { ...opts, format: opts.format === 'long' ? 'longG' : 'shortG' })[0].trim();
        return v.cls === 'logical' || v.cls === 'double' ? s : s;
      }
      if (v.rows === 1 && v.numel <= 10 && !v.im) return `[${Array.from(v.re, (x) => fmtReal(x, 'shortG')).join(' ')}]`;
      return `${dims(v)} ${v.cls}`;
    }
    case 'cell':
      return `${dims(v)} cell`;
    case 'struct':
      return `${dims(v)} struct`;
    case 'string':
      return v.numel === 1 ? `"${v.data[0]}"` : `${dims(v)} string`;
    case 'fhandle':
      return v.toString();
  }
}

export function displayValue(name: string, v: Value, opts: DisplayOptions = defaultDisplay): string {
  const blank = opts.compact ? '' : '\n';
  const body = displayBody(v, opts);
  const header = `${name} =`;
  if (v.kind === 'tensor' && v.numel === 1 && v.cls !== 'char' && !body.includes('\n')) return `${header}${blank ? '\n\n' : '\n'}${body}\n${blank}`;
  return `${header}${blank ? '\n\n' : '\n'}${body}\n${blank}`;
}

export function displayBody(v: Value, opts: DisplayOptions = defaultDisplay): string {
  const blank = opts.compact ? '' : '\n';
  switch (v.kind) {
    case 'tensor': {
      if (v.cls === 'char') {
        if (v.numel === 0) return `  0×0 empty char array`;
        return v.rowStrings().map((s) => `    '${s}'`).join('\n');
      }
      if (v.numel === 0) return v.rows === 0 && v.cols === 0 ? '     []' : `  ${dims(v)} empty ${v.cls} ${v.rows === 1 || v.rows === 0 && v.cols > 0 ? (v.rows === 1 ? 'row vector' : 'matrix') : v.cols === 1 ? 'column vector' : 'matrix'}`;
      const lines = formatNumericMatrix(v, opts);
      const header = v.cls === 'logical' && v.numel > 1 ? `  ${dims(v)} logical array\n${blank}` : v.cls !== 'double' && v.cls !== 'logical' && v.numel > 1 ? `  ${dims(v)} ${v.cls} matrix\n${blank}` : '';
      return header + lines.join('\n');
    }
    case 'string':
      if (v.numel === 1) return `    "${v.data[0]}"`;
      return `  ${dims(v)} string array\n${blank}` + Array.from({ length: v.rows }, (_, r) => '    ' + Array.from({ length: v.cols }, (_, c) => `"${v.data[c * v.rows + r]}"`).join('    ')).join('\n');
    case 'cell': {
      if (v.numel === 0) return `  ${dims(v)} empty cell array`;
      const cells = v.data.map((x) => (x.kind === 'cell' ? `{${dims(x)} cell}` : `{${x.kind === 'tensor' && x.cls !== 'char' && x.numel === 1 ? '[' + shortDesc(x, opts) + ']' : x.kind === 'tensor' && x.cls !== 'char' && x.numel > 1 ? shortDesc(x, opts).startsWith('[') ? shortDesc(x, opts) : `${dims(x)} ${x.cls}` : shortDesc(x, opts)}}`));
      const w = Math.max(...cells.map((c) => c.length)) + 4;
      const lines = [`  ${dims(v)} cell array`, ...(opts.compact ? [] : [''])];
      for (let r = 0; r < v.rows; r++) {
        let l = '    ';
        for (let c = 0; c < v.cols; c++) l += cells[c * v.rows + r].padEnd(w);
        lines.push(l.trimEnd());
      }
      return lines.join('\n');
    }
    case 'struct': {
      if (v.numel !== 1) {
        return `  ${dims(v)} struct array with fields:\n${blank}` + v.fields.map((f) => `    ${f}`).join('\n');
      }
      if (!v.fields.length) return '  struct with no fields.';
      const w = Math.max(...v.fields.map((f) => f.length));
      return `  struct with fields:\n${blank}` + v.fields.map((f) => `    ${f.padStart(w)}: ${shortDesc(v.data[0].get(f)!, opts)}`).join('\n');
    }
    case 'fhandle':
      return `  function_handle with value:\n${blank}    ${v.toString()}`;
  }
}

export function describeVar(v: Value): { size: string; cls: string; preview: string; bytes: number } {
  const cls = className(v);
  let bytes = 8 * v.numel;
  if (v.kind === 'tensor') bytes = v.cls === 'char' ? 2 * v.numel : v.cls === 'logical' ? v.numel : 8 * v.numel * (v.im ? 2 : 1);
  return { size: dims(v), cls, preview: shortDesc(v), bytes };
}
