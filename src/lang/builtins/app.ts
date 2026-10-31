import { CellArray, MError, StructArray, Tensor, cellOf, isStringLike, num, str, toNumber, toStringValue, toTensor, zeros, colVec, type Value, cellStrings } from '../value';
import type { Interpreter } from '../interp';
import { def, minArgs, nameValues } from './helpers';

function bridge(I: Interpreter) {
  const b = I.io.app;
  if (!b) throw new MError('Project tables are not available in this context.');
  return b;
}

export function registerApp(I: Interpreter) {
  def(I, 'listtables', (_a, nargout, ctx) => {
    const t = bridge(ctx.interp).listTables();
    if (nargout > 0) return cellOf(t.map((x) => str(x.name)), t.length, 1);
    ctx.interp.print(t.length ? t.map((x) => `  ${x.name}  (${x.kind}, ${x.rows} rows, data sets: ${x.datasets.join(', ')})`).join('\n') + '\n' : '  (no data tables)\n');
  });
  def(I, 'gettable', (a, _n, ctx) => {
    minArgs(a, 1);
    const name = toStringValue(a[0]);
    const t = bridge(ctx.interp).getTable(name);
    if (!t) throw new MError(`No data table named '${name}'. Use listtables to see available tables.`);
    const nrows = Math.max(t.x.length, t.rowTitles.length, ...t.datasets.flatMap((d) => d.cols.map((c) => c.length)), 0);
    const toCol = (c: (number | null)[]) => {
      const out = zeros(nrows, 1);
      for (let i = 0; i < nrows; i++) out.re[i] = c[i] === null || c[i] === undefined ? NaN : (c[i] as number);
      return out;
    };
    const allCols = t.datasets.flatMap((d) => d.cols);
    const Y = zeros(nrows, allCols.length);
    allCols.forEach((c, j) => {
      for (let i = 0; i < nrows; i++) Y.re[j * nrows + i] = c[i] === null || c[i] === undefined ? NaN : (c[i] as number);
    });
    const data = new CellArray(1, t.datasets.length, t.datasets.map((d) => {
      const m = zeros(nrows, d.cols.length);
      d.cols.forEach((c, j) => {
        for (let i = 0; i < nrows; i++) m.re[j * nrows + i] = c[i] === null || c[i] === undefined ? NaN : (c[i] as number);
      });
      return m;
    }));
    return StructArray.scalar([
      ['name', str(name)],
      ['kind', str(t.kind)],
      ['x', toCol(t.x)],
      ['y', Y],
      ['names', cellOf(t.datasets.map((d) => str(d.title)))],
      ['data', data],
      ['rowTitles', new CellArray(nrows, 1, Array.from({ length: nrows }, (_, i) => str(t.rowTitles[i] ?? '')))],
    ]);
  });
  def(I, 'puttable', (a, nargout, ctx) => {
    minArgs(a, 2);
    const name = toStringValue(a[0]);
    const posEnd = a.findIndex((v, i) => i > 0 && isStringLike(v) && ['kind', 'names', 'rowtitles', 'replicates', 'xtitle'].includes(toStringValue(v).toLowerCase()));
    const pos = a.slice(1, posEnd < 0 ? undefined : posEnd);
    const nv = nameValues(a, posEnd < 0 ? a.length : posEnd);
    let kind = nv.has('kind') ? toStringValue(nv.get('kind')!).toLowerCase() : pos.length >= 2 ? 'xy' : 'column';
    const map: Record<string, string> = { column: 'column', xy: 'xy', grouped: 'grouped', contingency: 'contingency', survival: 'survival', parts: 'parts', multi: 'multi', multiple: 'multi', 'parts of whole': 'parts' };
    kind = map[kind] ?? kind;
    let X: Tensor | null = null;
    let Y: Value;
    if (pos.length >= 2) {
      X = toTensor(pos[0]);
      Y = pos[1];
    } else Y = pos[0];
    const reps = nv.has('replicates') ? toNumber(nv.get('replicates')!) : 1;
    let cols: (number | null)[][];
    if (Y.kind === 'cell') cols = Y.data.map((v) => Array.from(toTensor(v).re, (x) => (Number.isNaN(x) ? null : x)));
    else {
      const t = toTensor(Y);
      const m = t.rows === 1 && !X ? new Tensor(t.cols, 1, t.re) : t.rows === 1 && X && X.numel === t.cols ? new Tensor(t.cols, 1, t.re) : t;
      cols = Array.from({ length: m.cols }, (_, j) => Array.from(m.re.subarray(j * m.rows, (j + 1) * m.rows), (x) => (Number.isNaN(x) ? null : x)));
    }
    const names = nv.has('names') ? cellStrings(nv.get('names')!) : [];
    const datasets: { title: string; cols: (number | null)[][] }[] = [];
    for (let k = 0; k < cols.length; k += reps) datasets.push({ title: names[datasets.length] ?? `Data set ${String.fromCharCode(65 + (datasets.length % 26))}`, cols: cols.slice(k, k + reps) });
    bridge(ctx.interp).putTable({
      name, kind, x: X ? Array.from(X.re) : undefined, datasets,
      rowTitles: nv.has('rowtitles') ? cellStrings(nv.get('rowtitles')!) : undefined,
      ...(nv.has('xtitle') ? { xTitle: toStringValue(nv.get('xtitle')!) } : {}),
    } as any);
    if (nargout > 0) return str(name);
    ctx.interp.print(`Data table '${name}' (${kind}) written to the project.\n`);
  });
  def(I, 'analyze', (a, nargout, ctx) => {
    minArgs(a, 2);
    const b = bridge(ctx.interp);
    if (!b.runAnalysis) throw new MError('Analyses are not available here.');
    const params: Record<string, any> = {};
    for (let i = 2; i + 1 < a.length; i += 2) {
      const v = a[i + 1];
      params[toStringValue(a[i])] = isStringLike(v) ? toStringValue(v) : v.kind === 'tensor' && v.numel === 1 ? (v.cls === 'logical' ? !!v.re[0] : v.re[0]) : v.kind === 'tensor' ? Array.from(v.re) : null;
    }
    const text = b.runAnalysis(toStringValue(a[0]), toStringValue(a[1]), params);
    if (nargout > 0) return str(text);
    ctx.interp.print(text + '\n');
  });
  def(I, 'prismgraph', (a, nargout, ctx) => {
    const b = bridge(ctx.interp);
    if (!b.makeGraph) throw new MError('Graphs are not available here.');
    const msg = b.makeGraph(toStringValue(a[0]), a.length > 1 ? toStringValue(a[1]) : '');
    if (nargout > 0) return str(msg);
    ctx.interp.print(msg + '\n');
  });
  void colVec;
}
