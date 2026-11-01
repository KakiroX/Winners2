import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, EyeOff, Eye, Eraser, ArrowUpToLine, Copy, ClipboardPaste } from 'lucide-react';
import type { DataTable, Cell } from '../model/types';
import { useStore } from '../state/store';
import { datasetLetter, emptyDataset, rowCount, subcolLabels, TABLE_KIND_INFO, defaultDatasetTitle, subcolCount } from '../model/table';
import { useContextMenu } from './common';

type ColDesc = { kind: 'rowTitle' } | { kind: 'x' } | { kind: 'y'; ds: number; sub: number };
const ROW_H = 25;

interface Pos {
  r: number;
  c: number;
}

function fmt(v: Cell | undefined, round = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '';
  if (round && !Number.isInteger(v)) return String(Number(v.toPrecision(6)));
  return String(v);
}

function parseNum(s: string): Cell {
  const t = s.trim().replace(/\s/g, '');
  if (t === '') return null;
  const n = Number(t.replace(/,(\d{3})(?!\d)/g, '$1'));
  if (Number.isFinite(n)) return n;
  const n2 = Number(t.replace(',', '.'));
  return Number.isFinite(n2) ? n2 : null;
}

export function DataGrid({ table, readOnly }: { table: DataTable; readOnly?: boolean }) {
  const st = useStore();
  const info = TABLE_KIND_INFO[table.kind];
  const cols: ColDesc[] = useMemo(() => {
    const c: ColDesc[] = [];
    if (info.hasRowTitles) c.push({ kind: 'rowTitle' });
    if (info.hasX) c.push({ kind: 'x' });
    table.datasets.forEach((ds, i) => ds.cols.forEach((_, s) => c.push({ kind: 'y', ds: i, sub: s })));
    return c;
  }, [table, info]);
  const nData = rowCount(table);
  const nRows = Math.max(nData + 25, 40);
  const [anchor, setAnchor] = useState<Pos>({ r: 0, c: info.hasRowTitles ? 1 : 0 });
  const [focus, setFocus] = useState<Pos>({ r: 0, c: info.hasRowTitles ? 1 : 0 });
  const [editing, setEditing] = useState<{ pos: Pos; text: string } | null>(null);
  const [editTitle, setEditTitle] = useState<number | 'x' | null>(null);
  const [scroll, setScroll] = useState({ top: 0, height: 600 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const ctx = useContextMenu();

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScroll((s) => ({ ...s, height: el.clientHeight })));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sel = {
    r0: Math.min(anchor.r, focus.r), r1: Math.max(anchor.r, focus.r),
    c0: Math.min(anchor.c, focus.c), c1: Math.max(anchor.c, focus.c),
  };

  const getText = useCallback((r: number, c: number): string => {
    const cd = cols[c];
    if (!cd) return '';
    if (cd.kind === 'rowTitle') return table.rowTitles[r] ?? '';
    if (cd.kind === 'x') return fmt(table.x[r], readOnly);
    return fmt(table.datasets[cd.ds]?.cols[cd.sub]?.[r], readOnly);
  }, [cols, table, readOnly]);

  /** Apply a block of text values starting at (r0, c0); extends data sets as needed. */
  const writeBlock = useCallback((r0: number, c0: number, block: string[][]) => {
    if (readOnly) return;
    st.update((p) => {
      const t = p.tables.find((x) => x.id === table.id);
      if (!t) return;
      const kinfo = TABLE_KIND_INFO[t.kind];
      const lead = (kinfo.hasRowTitles ? 1 : 0) + (kinfo.hasX ? 1 : 0);
      const sub = subcolCount(t);
      const maxCol = c0 + Math.max(...block.map((r) => r.length)) - 1;
      // add data sets when pasting beyond the last column
      let curCols = lead + t.datasets.reduce((s, d) => s + d.cols.length, 0);
      while (maxCol >= curCols) {
        t.datasets.push(emptyDataset(t, defaultDatasetTitle(t.kind, t.datasets.length)));
        curCols += sub;
      }
      const map: ColDesc[] = [];
      if (kinfo.hasRowTitles) map.push({ kind: 'rowTitle' });
      if (kinfo.hasX) map.push({ kind: 'x' });
      t.datasets.forEach((ds, i) => ds.cols.forEach((_, s) => map.push({ kind: 'y', ds: i, sub: s })));
      block.forEach((rowVals, dr) => rowVals.forEach((text, dc) => {
        const r = r0 + dr, cd = map[c0 + dc];
        if (!cd) return;
        if (cd.kind === 'rowTitle') {
          while (t.rowTitles.length <= r) t.rowTitles.push('');
          t.rowTitles[r] = text;
        } else if (cd.kind === 'x') {
          while (t.x.length <= r) t.x.push(null);
          t.x[r] = parseNum(text);
        } else {
          const col = t.datasets[cd.ds].cols[cd.sub];
          while (col.length <= r) col.push(null);
          col[r] = parseNum(text);
        }
      }));
      // trim trailing empty cells
      const trim = (a: any[]) => {
        while (a.length && (a[a.length - 1] === null || a[a.length - 1] === '')) a.pop();
      };
      trim(t.x);
      trim(t.rowTitles);
      t.datasets.forEach((d) => d.cols.forEach(trim));
    });
  }, [readOnly, st, table.id]);

  const clearSelection = () => {
    const block: string[][] = [];
    for (let r = sel.r0; r <= sel.r1; r++) block.push(Array(sel.c1 - sel.c0 + 1).fill(''));
    writeBlock(sel.r0, sel.c0, block);
  };

  const copySelection = async (cut = false) => {
    const lines: string[] = [];
    for (let r = sel.r0; r <= sel.r1; r++) {
      const vals: string[] = [];
      for (let c = sel.c0; c <= sel.c1; c++) vals.push(getText(r, c));
      lines.push(vals.join('\t'));
    }
    await navigator.clipboard.writeText(lines.join('\n'));
    if (cut) clearSelection();
  };

  const pasteText = (text: string) => {
    const rows = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
    if (rows.length === 1 && rows[0].length === 1 && (sel.r1 > sel.r0 || sel.c1 > sel.c0)) {
      // fill selection with a single value
      const block: string[][] = [];
      for (let r = sel.r0; r <= sel.r1; r++) block.push(Array(sel.c1 - sel.c0 + 1).fill(rows[0][0]));
      writeBlock(sel.r0, sel.c0, block);
      return;
    }
    writeBlock(sel.r0, sel.c0, rows);
    setAnchor({ r: sel.r0, c: sel.c0 });
    setFocus({ r: sel.r0 + rows.length - 1, c: sel.c0 + Math.max(...rows.map((r) => r.length)) - 1 });
  };

  const commitEdit = (move?: Pos) => {
    if (!editing) return;
    writeBlock(editing.pos.r, editing.pos.c, [[editing.text]]);
    setEditing(null);
    if (move) {
      setAnchor(move);
      setFocus(move);
    }
    wrapRef.current?.focus();
  };

  const moveTo = (p: Pos, extend = false) => {
    const q = { r: Math.max(0, Math.min(nRows - 1, p.r)), c: Math.max(0, Math.min(cols.length - 1, p.c)) };
    setFocus(q);
    if (!extend) setAnchor(q);
    const el = wrapRef.current;
    if (el) {
      const y = q.r * ROW_H + 52;
      if (y < el.scrollTop + 52) el.scrollTop = y - 52;
      else if (y + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = y + ROW_H - el.clientHeight;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing || editTitle !== null) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      copySelection();
      return;
    }
    if (mod && e.key.toLowerCase() === 'x') {
      e.preventDefault();
      copySelection(true);
      return;
    }
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setAnchor({ r: 0, c: 0 });
      setFocus({ r: Math.max(0, nData - 1), c: cols.length - 1 });
      return;
    }
    if (mod && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) return;
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); moveTo({ r: focus.r + 1, c: focus.c }, e.shiftKey); return;
      case 'ArrowUp': e.preventDefault(); moveTo({ r: focus.r - 1, c: focus.c }, e.shiftKey); return;
      case 'ArrowLeft': e.preventDefault(); moveTo({ r: focus.r, c: focus.c - 1 }, e.shiftKey); return;
      case 'ArrowRight': e.preventDefault(); moveTo({ r: focus.r, c: focus.c + 1 }, e.shiftKey); return;
      case 'Tab': e.preventDefault(); moveTo({ r: focus.r, c: focus.c + (e.shiftKey ? -1 : 1) }); return;
      case 'Enter': e.preventDefault(); if (!readOnly) setEditing({ pos: focus, text: getText(focus.r, focus.c) }); return;
      case 'F2': e.preventDefault(); if (!readOnly) setEditing({ pos: focus, text: getText(focus.r, focus.c) }); return;
      case 'PageDown': e.preventDefault(); moveTo({ r: focus.r + 20, c: focus.c }, e.shiftKey); return;
      case 'PageUp': e.preventDefault(); moveTo({ r: focus.r - 20, c: focus.c }, e.shiftKey); return;
      case 'Home': e.preventDefault(); moveTo({ r: mod ? 0 : focus.r, c: 0 }, e.shiftKey); return;
      case 'Delete':
      case 'Backspace': e.preventDefault(); clearSelection(); return;
    }
    if (!readOnly && e.key.length === 1 && !mod && !e.altKey) {
      e.preventDefault();
      setAnchor(focus);
      setEditing({ pos: focus, text: e.key });
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (editing || readOnly) return;
    e.preventDefault();
    pasteText(e.clipboardData.getData('text/plain'));
  };

  const toggleExclude = () => {
    st.update((p) => {
      const t = p.tables.find((x) => x.id === table.id);
      if (!t) return;
      const keys: string[] = [];
      for (let r = sel.r0; r <= sel.r1; r++) for (let c = sel.c0; c <= sel.c1; c++) {
        const cd = cols[c];
        if (cd?.kind === 'y') keys.push(`${t.datasets[cd.ds].id}:${cd.sub}:${r}`);
      }
      const allExcluded = keys.every((k) => t.excluded.includes(k));
      t.excluded = allExcluded ? t.excluded.filter((k) => !keys.includes(k)) : [...new Set([...t.excluded, ...keys])];
    });
  };

  const insertRows = (at: number, count: number, remove = false) => {
    st.update((p) => {
      const t = p.tables.find((x) => x.id === table.id);
      if (!t) return;
      const op = (a: any[]) => {
        if (remove) a.splice(at, count);
        else if (a.length > at) a.splice(at, 0, ...Array(count).fill(a === t.rowTitles ? '' : null));
      };
      op(t.x);
      op(t.rowTitles);
      t.datasets.forEach((d) => d.cols.forEach(op));
      t.excluded = [];
    });
  };

  const addDataset = () => st.update((p) => {
    const t = p.tables.find((x) => x.id === table.id);
    if (t) t.datasets.push(emptyDataset(t, defaultDatasetTitle(t.kind, t.datasets.length)));
  });

  const deleteDataset = (i: number) => st.update((p) => {
    const t = p.tables.find((x) => x.id === table.id);
    if (!t) return;
    const id = t.datasets[i].id;
    t.datasets.splice(i, 1);
    t.excluded = t.excluded.filter((k) => !k.startsWith(id + ':'));
  });

  const renameDataset = (i: number | 'x', name: string) => st.update((p) => {
    const t = p.tables.find((x) => x.id === table.id);
    if (!t) return;
    if (i === 'x') t.xTitle = name;
    else t.datasets[i].title = name;
  });

  const openMenu = (e: React.MouseEvent) => {
    const cd = cols[focus.c];
    ctx.open(e, [
      { label: 'Copy', icon: <Copy size={14} />, onClick: () => copySelection() },
      { label: 'Paste', icon: <ClipboardPaste size={14} />, disabled: readOnly, onClick: async () => pasteText(await navigator.clipboard.readText()) },
      { label: 'Clear', icon: <Eraser size={14} />, disabled: readOnly, onClick: clearSelection },
      { sep: true, label: '' },
      { label: 'Exclude / include values', icon: table.excluded.length ? <Eye size={14} /> : <EyeOff size={14} />, disabled: readOnly, onClick: toggleExclude },
      { label: `Insert ${sel.r1 - sel.r0 + 1} row(s) above`, icon: <ArrowUpToLine size={14} />, disabled: readOnly, onClick: () => insertRows(sel.r0, sel.r1 - sel.r0 + 1) },
      { label: `Delete ${sel.r1 - sel.r0 + 1} row(s)`, icon: <Trash2 size={14} />, disabled: readOnly, onClick: () => insertRows(sel.r0, sel.r1 - sel.r0 + 1, true) },
      { sep: true, label: '' },
      { label: 'Add data set', icon: <Plus size={14} />, disabled: readOnly, onClick: addDataset },
      ...(cd?.kind === 'y' ? [{ label: `Delete data set "${table.datasets[cd.ds].title}"`, icon: <Trash2 size={14} />, danger: true, disabled: readOnly, onClick: () => deleteDataset(cd.ds) }] : []),
    ]);
  };

  const first = Math.max(0, Math.floor((scroll.top - 52) / ROW_H) - 5);
  const last = Math.min(nRows, first + Math.ceil(scroll.height / ROW_H) + 12);
  const labels = subcolLabels(table);
  const colWidth = (cd: ColDesc) => (cd.kind === 'rowTitle' ? (table.kind === 'column' || table.kind === 'multi' ? 110 : 140) : cd.kind === 'x' ? 96 : table.datasets[cd.ds].cols.length > 1 ? 82 : 104);

  return (
    <>
      <div
        className="grid-wrap"
        ref={wrapRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
        onMouseUp={() => (dragging.current = false)}
      >
        <table className="grid" style={{ width: 44 + cols.reduce((s, c) => s + colWidth(c), 0) + (readOnly ? 0 : 34) }}>
          <colgroup>
            <col style={{ width: 44 }} />
            {cols.map((c, i) => <col key={i} style={{ width: colWidth(c) }} />)}
            {!readOnly && <col style={{ width: 34 }} />}
          </colgroup>
          <thead>
            <tr>
              <th className="rowhead" rowSpan={2}>#</th>
              {info.hasRowTitles && <th className="ds-title" rowSpan={2} style={{ textAlign: 'left' }}>Row title</th>}
              {info.hasX && (
                <th className="ds-title x-col" onDoubleClick={() => !readOnly && setEditTitle('x')} title="Double-click to rename">
                  {editTitle === 'x' ? (
                    <input className="ds-title-input" autoFocus defaultValue={table.xTitle} onBlur={(e) => {
                      renameDataset('x', e.target.value);
                      setEditTitle(null);
                    }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                  ) : (
                    <><span className="letter">X</span>{table.xTitle}</>
                  )}
                </th>
              )}
              {table.datasets.map((ds, i) => (
                <th key={ds.id} className="ds-title" colSpan={ds.cols.length} onDoubleClick={() => !readOnly && setEditTitle(i)} title="Double-click to rename"
                  onContextMenu={(e) => !readOnly && ctx.open(e, [
                    { label: 'Rename', onClick: () => setEditTitle(i) },
                    { label: 'Add data set', icon: <Plus size={14} />, onClick: addDataset },
                    { label: 'Delete data set', icon: <Trash2 size={14} />, danger: true, onClick: () => deleteDataset(i) },
                  ])}>
                  {editTitle === i ? (
                    <input className="ds-title-input" autoFocus defaultValue={ds.title} onBlur={(e) => {
                      renameDataset(i, e.target.value);
                      setEditTitle(null);
                    }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                  ) : (
                    <><span className="letter">{table.kind === 'xy' || table.kind === 'grouped' || table.kind === 'survival' ? 'Y' : ''}{datasetLetter(i)}</span>{ds.title}</>
                  )}
                </th>
              ))}
              {!readOnly && <th className="add-ds" rowSpan={2} onClick={addDataset} title="Add data set"><Plus size={15} /></th>}
            </tr>
            <tr>
              {info.hasX && <th style={{ textAlign: 'center' }}>{table.kind === 'survival' ? 'Time' : 'X'}</th>}
              {table.datasets.map((ds) => ds.cols.map((_, s) => <th key={`${ds.id}${s}`} style={{ textAlign: 'center' }}>{table.kind === 'survival' ? 'Event (1/0)' : table.kind === 'contingency' ? 'Count' : labels[s] || ''}</th>))}
            </tr>
          </thead>
          <tbody>
            {first > 0 && <tr style={{ height: first * ROW_H }}><td colSpan={cols.length + 2} style={{ border: 'none' }} /></tr>}
            {Array.from({ length: last - first }, (_, k) => {
              const r = first + k;
              return (
                <tr key={r}>
                  <td className="rowhead">{r + 1}</td>
                  {cols.map((cd, c) => {
                    const isSel = r >= sel.r0 && r <= sel.r1 && c >= sel.c0 && c <= sel.c1;
                    const isFocus = r === focus.r && c === focus.c;
                    const excluded = cd.kind === 'y' && table.excluded.includes(`${table.datasets[cd.ds].id}:${cd.sub}:${r}`);
                    const cls = [cd.kind === 'rowTitle' ? 'rowtitle' : '', cd.kind === 'x' ? 'xcell' : '', isSel ? 'sel' : '', isFocus ? 'focus' : '', excluded ? 'excluded' : ''].join(' ');
                    if (editing && editing.pos.r === r && editing.pos.c === c)
                      return (
                        <td key={c} className="edit">
                          <input
                            autoFocus
                            value={editing.text}
                            style={{ textAlign: cd.kind === 'rowTitle' ? 'left' : 'right' }}
                            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                            onBlur={() => commitEdit()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitEdit({ r: r + (e.shiftKey ? -1 : 1), c });
                              } else if (e.key === 'Tab') {
                                e.preventDefault();
                                commitEdit({ r, c: c + (e.shiftKey ? -1 : 1) });
                              } else if (e.key === 'Escape') {
                                setEditing(null);
                                wrapRef.current?.focus();
                              } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.shiftKey) {
                                e.preventDefault();
                                commitEdit({ r: r + (e.key === 'ArrowDown' ? 1 : -1), c });
                              }
                            }}
                          />
                        </td>
                      );
                    return (
                      <td
                        key={c}
                        className={cls}
                        onMouseDown={(e) => {
                          if (e.button === 2 && isSel) return;
                          wrapRef.current?.focus();
                          dragging.current = true;
                          if (e.shiftKey) setFocus({ r, c });
                          else {
                            setAnchor({ r, c });
                            setFocus({ r, c });
                          }
                        }}
                        onMouseEnter={() => dragging.current && setFocus({ r, c })}
                        onDoubleClick={() => !readOnly && setEditing({ pos: { r, c }, text: getText(r, c) })}
                        onContextMenu={openMenu}
                      >
                        {getText(r, c)}
                      </td>
                    );
                  })}
                  {!readOnly && <td style={{ background: 'var(--panel-2)' }} />}
                </tr>
              );
            })}
            {last < nRows && <tr style={{ height: (nRows - last) * ROW_H }}><td colSpan={cols.length + 2} style={{ border: 'none' }} /></tr>}
          </tbody>
        </table>
      </div>
      <div className="grid-hint">
        {readOnly ? 'This table is generated by an analysis and updates automatically.' : 'Type to enter values · Enter/Tab to move · Paste from Excel with Ctrl+V · Right-click to exclude values or insert rows · Double-click a header to rename'}
        {sel.r1 > sel.r0 || sel.c1 > sel.c0 ? ` · Selection: ${sel.r1 - sel.r0 + 1}×${sel.c1 - sel.c0 + 1}` : ''}
      </div>
      {ctx.element}
    </>
  );
}
