import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Pencil, Copy, Trash2, BarChart3, FlaskConical, Download, Play } from 'lucide-react';
import { useStore } from '../state/store';
import type { AnyItem, ItemType } from '../model/types';
import { ItemIcon, useContextMenu, type MenuItem } from './common';
import { exportTable, runScript } from '../state/actions';
import { TABLE_KIND_INFO } from '../model/table';

function SectionHead({ label, count, open, toggle, onAdd }: { label: string; count: number; open: boolean; toggle: () => void; onAdd?: () => void }) {
  return (
    <div className="nav-section-head" onClick={toggle}>
      {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      {label}
      {onAdd && (
        <button className="nav-add" title={`New ${label.toLowerCase()}`} onClick={(e) => {
          e.stopPropagation();
          onAdd();
        }}>
          <Plus size={14} />
        </button>
      )}
      <span className="count">{count}</span>
    </div>
  );
}

export function Navigator() {
  const st = useStore();
  const p = st.project;
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const ctx = useContextMenu();
  const toggle = (k: string) => setClosed({ ...closed, [k]: !closed[k] });

  const menuFor = (type: ItemType, it: AnyItem): MenuItem[] => {
    const items: MenuItem[] = [{ label: 'Rename', icon: <Pencil size={14} />, onClick: () => setRenaming(it.id) }];
    if (type === 'table') {
      items.push(
        { label: 'Analyze…', icon: <FlaskConical size={14} />, onClick: () => st.setDialog({ kind: 'analyze', tableId: it.id }) },
        { label: 'New graph…', icon: <BarChart3 size={14} />, onClick: () => st.setDialog({ kind: 'newGraph', tableId: it.id }) },
        { label: 'Export as CSV', icon: <Download size={14} />, onClick: () => exportTable(it.id, 'csv') },
        { label: 'Export as Prism XML (.pzfx)', icon: <Download size={14} />, onClick: () => exportTable(it.id, 'pzfx') },
      );
    }
    if (type === 'script') items.push({ label: 'Run', icon: <Play size={14} />, onClick: () => runScript(it.id) });
    if (type !== 'figure') items.push({ label: 'Duplicate', icon: <Copy size={14} />, onClick: () => st.duplicateItem(it.id) });
    items.push({ sep: true, label: '' }, {
      label: 'Delete', icon: <Trash2 size={14} />, danger: true, onClick: () => {
        const dependents = type === 'table' ? p.analyses.filter((a) => a.tableId === it.id).length + p.graphs.filter((g) => g.tableId === it.id).length : 0;
        st.setDialog({ kind: 'confirm', title: `Delete "${it.name}"?`, message: dependents ? `This also deletes ${dependents} linked analysis/graph sheet(s).` : 'This cannot be undone except with Undo.', okLabel: 'Delete', onOk: () => st.deleteItem(it.id) });
      },
    });
    return items;
  };

  const row = (type: ItemType, it: AnyItem, child = false, extra?: React.ReactNode) => (
    <div
      key={it.id}
      className={`nav-item ${child ? 'child' : ''} ${st.activeId === it.id ? 'active' : ''}`}
      onClick={() => st.open(it.id)}
      onDoubleClick={() => setRenaming(it.id)}
      onContextMenu={(e) => ctx.open(e, menuFor(type, it))}
      title={it.name}
    >
      <ItemIcon type={type} />
      {renaming === it.id ? (
        <input
          className="input"
          autoFocus
          defaultValue={it.name}
          style={{ padding: '1px 4px', height: 22, flex: 1 }}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            if (e.target.value.trim()) st.renameItem(it.id, e.target.value.trim());
            setRenaming(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setRenaming(null);
          }}
        />
      ) : (
        <span className="label">{it.name}</span>
      )}
      {extra}
    </div>
  );

  const tables = p.tables;
  return (
    <div className="nav" style={{ width: st.navWidth }}>
      <div className="nav-head">
        <div className="nav-title" title={p.name}>{p.name}{st.dirty ? ' •' : ''}</div>
      </div>
      <div className="nav-scroll">
        <div className="nav-section">
          <SectionHead label="Data tables" count={tables.length} open={!closed.tables} toggle={() => toggle('tables')} onAdd={() => st.setDialog({ kind: 'newTable' })} />
          {!closed.tables && (tables.length ? tables.map((t) => (
            <div key={t.id}>
              {row('table', t, false, <span className="kind">{TABLE_KIND_INFO[t.kind].label}</span>)}
              {p.analyses.filter((a) => a.tableId === t.id).map((a) => row('analysis', a, true))}
              {p.graphs.filter((g) => g.tableId === t.id).map((g) => row('graph', g, true))}
            </div>
          )) : <div className="nav-empty">No tables yet</div>)}
        </div>
        <div className="nav-section">
          <SectionHead label="Results" count={p.analyses.length} open={!closed.results} toggle={() => toggle('results')} />
          {!closed.results && (p.analyses.length ? p.analyses.map((a) => row('analysis', a)) : <div className="nav-empty">Analyze a table to see results</div>)}
        </div>
        <div className="nav-section">
          <SectionHead label="Graphs" count={p.graphs.length} open={!closed.graphs} toggle={() => toggle('graphs')} />
          {!closed.graphs && (p.graphs.length ? p.graphs.map((g) => row('graph', g)) : <div className="nav-empty">No graphs yet</div>)}
        </div>
        <div className="nav-section">
          <SectionHead label="Scripts" count={p.scripts.length} open={!closed.scripts} toggle={() => toggle('scripts')} onAdd={() => st.addScript()} />
          {!closed.scripts && (p.scripts.length ? p.scripts.map((s) => row('script', s)) : <div className="nav-empty">MATLAB-compatible scripts</div>)}
        </div>
        <div className="nav-section">
          <SectionHead label="Figures" count={p.figures.length} open={!closed.figures} toggle={() => toggle('figures')} />
          {!closed.figures && (p.figures.length ? p.figures.map((f) => row('figure', f)) : <div className="nav-empty">Plots from code appear here</div>)}
        </div>
        <div className="nav-section">
          <SectionHead label="Notes" count={p.infos.length} open={!closed.infos} toggle={() => toggle('infos')} onAdd={() => st.addInfo()} />
          {!closed.infos && p.infos.map((i) => row('info', i))}
        </div>
      </div>
      {ctx.element}
    </div>
  );
}
