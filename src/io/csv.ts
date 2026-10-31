import type { DataTable, TableKind } from '../model/types';
import { emptyDataset, newTable, rowCount, TABLE_KIND_INFO, subcolLabels } from '../model/table';

/** Parse CSV/TSV text (auto-detects delimiter, supports quoted fields). */
export function parseDelimited(text: string, delim?: string): string[][] {
  const t = text.replace(/^﻿/, '');
  if (!delim) {
    const firstLines = t.split(/\r?\n/).slice(0, 5).join('\n');
    const counts = ['\t', ',', ';', '|'].map((d) => ({ d, n: firstLines.split(d).length }));
    counts.sort((a, b) => b.n - a.n);
    delim = counts[0].n > 1 ? counts[0].d : /\s{1,}/.test(firstLines.trim()) ? ' ' : ',';
  }
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inQ) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') inQ = true;
    else if (delim === ' ' ? c === ' ' || c === '\t' : c === delim) {
      if (delim === ' ' && field === '') continue;
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

const toNum = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const v = s.trim();
  if (v === '') return null;
  const n = Number(v.replace(/,(?=\d{3}\b)/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** Build a data table from delimited text. First row is treated as headers when non-numeric. */
export function tableFromDelimited(text: string, kind: TableKind, name: string): DataTable {
  const rows = parseDelimited(text);
  if (!rows.length) return newTable(kind, name);
  const hasHeader = rows[0].some((c) => c.trim() !== '' && toNum(c) === null);
  const header = hasHeader ? rows[0] : [];
  const body = hasHeader ? rows.slice(1) : rows;
  const ncol = Math.max(...body.map((r) => r.length), header.length);
  // Is the first column textual (row titles)?
  const firstColText = body.some((r) => r[0] && r[0].trim() !== '' && toNum(r[0]) === null);
  const info = TABLE_KIND_INFO[kind];
  const t = newTable(kind, name, { datasets: 0, replicates: 1 });
  let c0 = 0;
  if (firstColText) {
    t.rowTitles = body.map((r) => r[0] ?? '');
    c0 = 1;
  }
  if (info.hasX) {
    t.xTitle = header[c0] || t.xTitle;
    t.x = body.map((r) => toNum(r[c0]));
    c0++;
  }
  for (let j = c0; j < ncol; j++) {
    const ds = emptyDataset(t, header[j]?.trim() || `Data set ${String.fromCharCode(65 + ((j - c0) % 26))}`);
    ds.cols = [body.map((r) => toNum(r[j]))];
    t.datasets.push(ds);
  }
  return t;
}

export function tableToCSV(t: DataTable): string {
  const info = TABLE_KIND_INFO[t.kind];
  const labels = subcolLabels(t);
  const header: string[] = [];
  if (t.rowTitles.some((r) => r)) header.push('');
  if (info.hasX) header.push(t.xTitle || 'X');
  for (const ds of t.datasets) ds.cols.forEach((_, s) => header.push(ds.cols.length > 1 ? `${ds.title} ${labels[s]}` : ds.title));
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [header.map(esc).join(',')];
  for (let r = 0; r < rowCount(t); r++) {
    const row: string[] = [];
    if (t.rowTitles.some((x) => x)) row.push(esc(t.rowTitles[r] ?? ''));
    if (info.hasX) row.push(t.x[r] === null || t.x[r] === undefined ? '' : String(t.x[r]));
    for (const ds of t.datasets) for (const c of ds.cols) row.push(c[r] === null || c[r] === undefined ? '' : String(c[r]));
    lines.push(row.join(','));
  }
  return lines.join('\n') + '\n';
}
