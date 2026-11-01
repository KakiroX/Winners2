// Import/export of Prism XML project files (.pzfx), the documented XML format used by GraphPad Prism
// for data tables and info sheets. Graphs/analyses in .pzfx are stored in a binary template section
// that is not documented, so only data tables and notes are exchanged.
import type { DataTable, InfoSheet, TableKind, YFormat, Cell } from '../model/types';
import { emptyDataset, newTable, rowCount, subcolCount, uid } from '../model/table';
import { child, children, encodeXml, parseXml, textOf, type XNode } from './xml';

const TYPE_TO_KIND: Record<string, TableKind> = {
  XY: 'xy', OneWay: 'column', TwoWay: 'grouped', Contingency: 'contingency', Survival: 'survival', PartsOfWhole: 'parts', MultipleVariables: 'multi', Nested: 'column',
};
const KIND_TO_TYPE: Record<TableKind, string> = { xy: 'XY', column: 'OneWay', grouped: 'TwoWay', contingency: 'Contingency', survival: 'Survival', parts: 'PartsOfWhole', multi: 'MultipleVariables' };
const YFMT_IN: Record<string, YFormat> = { replicates: 'replicates', SD: 'meanSD', SE: 'meanSEM', SDN: 'meanSDN', SEN: 'meanSEMN' };
const YFMT_OUT: Record<YFormat, string> = { replicates: 'replicates', meanSD: 'SD', meanSEM: 'SE', meanSDN: 'SDN', meanSEMN: 'SEN' };

function parseCell(d: XNode): { v: Cell; excluded: boolean; text: string } {
  const t = textOf(d).replace(/\*$/, '');
  const excluded = d.attrs.Excluded === '1';
  if (t === '') return { v: null, excluded, text: '' };
  const n = Number(t.replace(',', '.'));
  return { v: Number.isFinite(n) ? n : null, excluded, text: t };
}

function columnData(col: XNode): { title: string; subs: { v: Cell; excluded: boolean; text: string }[][] } {
  return {
    title: textOf(child(col, 'Title')),
    subs: children(col, 'Subcolumn').map((s) => children(s, 'd').map(parseCell)),
  };
}

export function readPzfx(text: string): { tables: DataTable[]; infos: InfoSheet[]; warnings: string[] } {
  const doc = parseXml(text);
  const root = doc.children.find((c) => c.name.endsWith('GraphPadPrismFile'));
  if (!root) throw new Error('Not a Prism XML (.pzfx) file.');
  const warnings: string[] = [];
  const tables: DataTable[] = [];
  const tableNodes = root.children.filter((c) => c.name === 'Table' || c.name.endsWith(':Table') || c.name === 'HugeTable');
  for (const tn of tableNodes) {
    const typ = tn.attrs.TableType ?? (tn.attrs.XFormat && tn.attrs.XFormat !== 'none' ? 'XY' : 'OneWay');
    const kind = TYPE_TO_KIND[typ] ?? 'column';
    if (!TYPE_TO_KIND[typ]) warnings.push(`Table type '${typ}' imported as a column table.`);
    const yfmt = YFMT_IN[tn.attrs.YFormat ?? 'replicates'] ?? 'replicates';
    if (tn.attrs.YFormat && !YFMT_IN[tn.attrs.YFormat]) warnings.push(`Y format '${tn.attrs.YFormat}' imported as replicate values.`);
    const reps = Number(tn.attrs.Replicates ?? '1') || 1;
    const t = newTable(kind, textOf(child(tn, 'Title')) || `Data ${tables.length + 1}`, { datasets: 0, replicates: kind === 'xy' || kind === 'grouped' ? reps : 1, yFormat: kind === 'xy' || kind === 'grouped' ? yfmt : 'replicates' });
    const rowTitles = child(tn, 'RowTitlesColumn');
    if (rowTitles) t.rowTitles = (columnData(rowTitles).subs[0] ?? []).map((c) => c.text);
    const xcol = child(tn, 'XColumn') ?? child(tn, 'XAdvancedColumn');
    if (xcol) {
      const xd = columnData(xcol);
      t.xTitle = xd.title || t.xTitle;
      t.x = (xd.subs[0] ?? []).map((c) => c.v);
    }
    const ycols = tn.children.filter((c) => c.name === 'YColumn' || c.name === 'YAdvancedColumn');
    for (const yc of ycols) {
      const yd = columnData(yc);
      const ds = emptyDataset(t, yd.title || `Data set ${t.datasets.length + 1}`);
      const nsub = subcolCount(t);
      ds.cols = Array.from({ length: nsub }, (_, s) => (yd.subs[s] ?? []).map((c) => c.v));
      yd.subs.forEach((sub, s) => sub.forEach((c, r) => {
        if (c.excluded) t.excluded.push(`${ds.id}:${s}:${r}`);
      }));
      if (yd.subs.length > nsub && kind !== 'xy' && kind !== 'grouped') {
        // Column-type tables in Prism always have one subcolumn; extra subcolumns become extra data sets
        for (let s = 1; s < yd.subs.length; s++) {
          const extra = emptyDataset(t, `${ds.title} (${s + 1})`);
          extra.cols = [yd.subs[s].map((c) => c.v)];
          t.datasets.push(extra);
        }
      }
      t.datasets.push(ds);
    }
    const notes = textOf(child(tn, 'Notes'));
    if (notes) t.notes = notes;
    tables.push(t);
  }
  const infos: InfoSheet[] = root.children.filter((c) => c.name === 'Info').map((inf, k) => {
    const constants = children(inf, 'Constant').map((c) => `${textOf(child(c, 'Name'))}: ${textOf(child(c, 'Value'))}`);
    return { id: uid('info'), type: 'info', name: textOf(child(inf, 'Title')) || `Project info ${k + 1}`, text: [textOf(child(inf, 'Notes')), ...constants].filter(Boolean).join('\n') };
  });
  return { tables, infos, warnings };
}

function fmtD(v: Cell | undefined, excluded: boolean): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '<d/>';
  return excluded ? `<d Excluded="1">${v}</d>` : `<d>${v}</d>`;
}

export function writePzfx(tables: DataTable[], infos: InfoSheet[] = []): string {
  const now = new Date().toISOString();
  const L: string[] = [];
  L.push('<?xml version="1.0" encoding="UTF-8"?>');
  L.push('<GraphPadPrismFile PrismXMLVersion="5.00">');
  L.push('<Created>');
  L.push(`<OriginalVersion CreatedByProgram="Quanta Studio" CreatedByVersion="1.0" Login="" DateTime="${now}"/>`);
  L.push('</Created>');
  L.push('<InfoSequence>');
  infos.forEach((_, i) => L.push(`<Ref ID="Info${i}"${i === 0 ? ' Selected="1"' : ''}/>`));
  L.push('</InfoSequence>');
  infos.forEach((inf, i) => {
    L.push(`<Info ID="Info${i}">`);
    L.push(`<Title>${encodeXml(inf.name)}</Title>`);
    L.push(`<Notes>${encodeXml(inf.text)}</Notes>`);
    L.push('</Info>');
  });
  L.push('<TableSequence>');
  tables.forEach((_, i) => L.push(`<Ref ID="Table${i}"${i === 0 ? ' Selected="1"' : ''}/>`));
  L.push('</TableSequence>');
  tables.forEach((t, i) => {
    const n = rowCount(t);
    const hasX = t.kind === 'xy' || t.kind === 'survival';
    const yf = t.kind === 'xy' || t.kind === 'grouped' ? YFMT_OUT[t.yFormat] : 'replicates';
    const reps = t.kind === 'xy' || t.kind === 'grouped' ? (t.yFormat === 'replicates' ? t.replicates : 1) : 1;
    L.push(`<Table ID="Table${i}" XFormat="${hasX ? 'numbers' : 'none'}" YFormat="${yf}" Replicates="${reps}" TableType="${KIND_TO_TYPE[t.kind]}" EVFormat="AsteriskAfterNumber">`);
    L.push(`<Title>${encodeXml(t.name)}</Title>`);
    if (t.rowTitles.some((r) => r)) {
      L.push('<RowTitlesColumn Width="81">');
      L.push('<Subcolumn>');
      for (let r = 0; r < n; r++) L.push(t.rowTitles[r] ? `<d>${encodeXml(t.rowTitles[r])}</d>` : '<d/>');
      L.push('</Subcolumn>');
      L.push('</RowTitlesColumn>');
    }
    if (hasX) {
      L.push('<XColumn Width="81" Subcolumns="1" Decimals="2">');
      L.push(`<Title>${encodeXml(t.xTitle)}</Title>`);
      L.push('<Subcolumn>');
      for (let r = 0; r < n; r++) L.push(fmtD(t.x[r], false));
      L.push('</Subcolumn>');
      L.push('</XColumn>');
    }
    for (const ds of t.datasets) {
      L.push(`<YColumn Width="${81 * ds.cols.length}" Decimals="2" Subcolumns="${ds.cols.length}">`);
      L.push(`<Title>${encodeXml(ds.title)}</Title>`);
      ds.cols.forEach((c, s) => {
        L.push('<Subcolumn>');
        for (let r = 0; r < n; r++) L.push(fmtD(c[r], t.excluded.includes(`${ds.id}:${s}:${r}`)));
        L.push('</Subcolumn>');
      });
      L.push('</YColumn>');
    }
    L.push('</Table>');
  });
  L.push('</GraphPadPrismFile>');
  return L.join('\n') + '\n';
}
