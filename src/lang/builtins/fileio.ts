import { MError, StructArray, isStringLike, str, toStringValue, toTensor, zeros, type Value, bool } from '../value';
import type { Interpreter } from '../interp';
import { def, minArgs } from './helpers';
import { readMat, writeMat } from '../../io/mat';
import { parseDelimited } from '../../io/csv';

function io(I: Interpreter, write = false) {
  if (I.sandboxed) throw new MError('File access is disabled for code run by the assistant. Ask the user to run this command.');
  const f = write ? I.io.writeFile : I.io.readFile;
  if (!f) throw new MError('File access is only available in the desktop app.');
  return I.io;
}

function readText(I: Interpreter, path: string): string {
  const data = io(I).readFile!(path);
  if (!data) throw new MError(`Unable to find or open '${path}'. Check the path and filename or file permissions.`);
  return new TextDecoder().decode(data);
}

export function registerFileIO(I: Interpreter) {
  def(I, 'load', (a, nargout, ctx) => {
    minArgs(a, 1);
    let path = toStringValue(a[0]);
    const names = a.slice(1).map((x) => toStringValue(x)).filter((n) => !n.startsWith('-'));
    const asAscii = a.some((x) => isStringLike(x) && toStringValue(x) === '-ascii') || /\.(txt|csv|dat)$/i.test(path);
    if (!/\.[A-Za-z0-9]+$/.test(path)) path += '.mat';
    if (asAscii) {
      const rows = parseDelimited(readText(ctx.interp, path)).filter((r) => r.length);
      const nr = rows.length, nc = Math.max(...rows.map((r) => r.length));
      const t = zeros(nr, nc);
      rows.forEach((r, i) => r.forEach((v, j) => (t.re[j * nr + i] = Number(v))));
      if (nargout > 0) return t;
      ctx.scope.vars.set(path.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_]/g, '_'), t);
      return;
    }
    const data = io(ctx.interp).readFile!(path);
    if (!data) throw new MError(`Unable to find file or directory '${path}'.`);
    const vars = readMat(data);
    const sel = names.length ? [...vars.entries()].filter(([n]) => names.includes(n)) : [...vars.entries()];
    if (nargout > 0) return StructArray.scalar(sel);
    for (const [n, v] of sel) ctx.scope.vars.set(n, v);
  });
  def(I, 'save', (a, _n, ctx) => {
    let path = a.length ? toStringValue(a[0]) : 'matlab.mat';
    if (!/\.[A-Za-z0-9]+$/.test(path)) path += '.mat';
    const flags = a.slice(1).map((x) => toStringValue(x));
    const names = flags.filter((n) => !n.startsWith('-'));
    const vars: [string, Value][] = names.length
      ? names.map((n) => {
          const v = ctx.interp.getVar(ctx.scope, n);
          if (!v) throw new MError(`Variable '${n}' not found.`);
          return [n, v] as [string, Value];
        })
      : [...ctx.scope.vars.entries()].filter(([, v]) => v.kind !== 'fhandle');
    if (flags.includes('-ascii')) {
      const t = toTensor(vars[0][1]);
      const lines: string[] = [];
      for (let i = 0; i < t.rows; i++) lines.push(Array.from({ length: t.cols }, (_, j) => t.re[j * t.rows + i].toExponential(7)).join('   '));
      io(ctx.interp, true).writeFile!(path, lines.join('\n') + '\n');
      return;
    }
    io(ctx.interp, true).writeFile!(path, writeMat(vars, !flags.includes('-v6')));
  });
  def(I, ['readmatrix', 'csvread', 'dlmread', 'importdata'], (a, _n, ctx) => {
    const path = toStringValue(a[0]);
    const rows = parseDelimited(readText(ctx.interp, path));
    // skip header rows that are non-numeric
    const numeric = rows.filter((r) => r.some((c) => c.trim() !== '' && Number.isFinite(Number(c))));
    const nr = numeric.length, nc = Math.max(0, ...numeric.map((r) => r.length));
    const t = zeros(nr, nc);
    numeric.forEach((r, i) => r.forEach((v, j) => (t.re[j * nr + i] = v.trim() === '' ? NaN : Number(v))));
    return t;
  });
  def(I, ['writematrix', 'csvwrite', 'dlmwrite'], (a, _n, ctx) => {
    const first = isStringLike(a[0]) ? 1 : 0;
    const t = toTensor(a[first === 1 ? 1 : 0]);
    const path = toStringValue(a[first === 1 ? 0 : 1]);
    const lines: string[] = [];
    for (let i = 0; i < t.rows; i++) lines.push(Array.from({ length: t.cols }, (_, j) => String(t.re[j * t.rows + i])).join(','));
    io(ctx.interp, true).writeFile!(path, lines.join('\n') + '\n');
  });
  def(I, 'fileread', (a, _n, ctx) => str(readText(ctx.interp, toStringValue(a[0]))));
  def(I, 'isfile', (a, _n, ctx) => {
    try {
      return bool(!!io(ctx.interp).readFile!(toStringValue(a[0])));
    } catch {
      return bool(false);
    }
  });
  def(I, ['fopen', 'fclose', 'fgetl', 'fgets', 'fscanf', 'textscan'], (_a, _n, ctx) => {
    throw new MError(`${ctx.name} is not supported. Use fileread, readmatrix, load or save instead.`);
  });
  def(I, 'pwd', () => str('.'));
  def(I, ['cd', 'mkdir', 'addpath', 'rmpath', 'savepath'], () => []);
  def(I, ['ls', 'dir'], (_a, _n, ctx) => ctx.interp.print('Directory listing is not available. Use the Files panel or the Import dialog.\n'));
}
