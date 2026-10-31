import { useEffect, useMemo, useRef, useState } from 'react';
import { FlaskConical, BarChart3, Settings2, Download, Copy, ZoomIn, ZoomOut, Maximize2, Play, Save, Square, Sigma, AlertTriangle, Sparkles, ClipboardCopy } from 'lucide-react';
import { useStore, tableFor, graphCtx } from '../state/store';
import type { Analysis, DataTable, Figure, Graph, InfoSheet, Script } from '../model/types';
import { DataGrid } from './DataGrid';
import { analysisDef, runAnalysis, resultsToText } from '../analysis/registry';
import { compileGraph } from '../graph/compile';
import { renderFigure } from '../graph/render';
import { CHART_LABELS, chartsFor, reformatTable, TABLE_KIND_INFO } from '../model/table';
import { copyGraphToClipboard } from '../graph/export';
import { runScript, saveScriptToDisk, stopExecution } from '../state/actions';
import { CodeEditor } from './CodeEditor';
import { SvgView } from './common';

// ---------------- Table ----------------
export function TableView({ table }: { table: DataTable }) {
  const st = useStore();
  const info = TABLE_KIND_INFO[table.kind];
  const readOnly = !!table.derivedFrom;
  return (
    <>
      <div className="toolbar">
        <input className="title-input" value={table.name} disabled={readOnly} onChange={(e) => st.renameItem(table.id, e.target.value)} />
        <span className="pill accent">{info.label}</span>
        {info.allowFormats && !readOnly && (
          <>
            <span className="sep" />
            <label className="small muted">Subcolumns</label>
            <select className="select" value={table.yFormat} onChange={(e) => st.update((p) => {
              const i = p.tables.findIndex((t) => t.id === table.id);
              p.tables[i] = reformatTable(p.tables[i], e.target.value as any, p.tables[i].replicates);
            })}>
              <option value="replicates">Replicate values</option>
              <option value="meanSD">Mean, SD</option>
              <option value="meanSEM">Mean, SEM</option>
              <option value="meanSDN">Mean, SD, N</option>
              <option value="meanSEMN">Mean, SEM, N</option>
            </select>
            {table.yFormat === 'replicates' && (
              <>
                <label className="small muted">Replicates</label>
                <input className="input" type="number" min={1} max={50} style={{ width: 60 }} value={table.replicates} onChange={(e) => {
                  const n = Math.max(1, Math.min(50, Number(e.target.value) || 1));
                  st.update((p) => {
                    const i = p.tables.findIndex((t) => t.id === table.id);
                    p.tables[i] = reformatTable(p.tables[i], 'replicates', n);
                  });
                }} />
              </>
            )}
          </>
        )}
        <span className="grow" />
        <button className="btn small" onClick={() => st.setDialog({ kind: 'analyze', tableId: table.id })}><FlaskConical size={14} /> Analyze</button>
        <button className="btn small" onClick={() => st.setDialog({ kind: 'newGraph', tableId: table.id })}><BarChart3 size={14} /> Graph</button>
        <button className="btn small" onClick={() => st.setDialog({ kind: 'analyze', tableId: table.id, presetKind: 'descriptive' })}><Sigma size={14} /> Stats</button>
      </div>
      <DataGrid table={table} readOnly={readOnly} />
    </>
  );
}

// ---------------- Results ----------------
function cellClass(header: string, value: string) {
  if (/summary/i.test(header) && /^\*+$/.test(value)) return 'stars';
  if (value === 'Yes') return 'sig-yes';
  return '';
}

export function ResultsView({ analysis }: { analysis: Analysis }) {
  const st = useStore();
  const table = tableFor(st.project, analysis.tableId);
  const res = useMemo(() => (table ? runAnalysis(table, analysis) : null), [table, analysis]);
  const def = analysisDef(analysis.kind);
  if (!table || !res) return <div className="empty-state">The data table for this analysis was deleted.</div>;
  return (
    <>
      <div className="toolbar">
        <input className="title-input" value={analysis.name} onChange={(e) => st.renameItem(analysis.id, e.target.value)} />
        <span className="pill">{def.name}</span>
        <span className="small muted">of</span>
        <button className="btn ghost small" onClick={() => st.open(table.id)}>{table.name}</button>
        <span className="grow" />
        <button className="btn small" onClick={() => st.setDialog({ kind: 'analyze', tableId: table.id, analysisId: analysis.id })}><Settings2 size={14} /> Parameters</button>
        {res.derivedTable && (
          <>
            <button className="btn small" onClick={() => st.addGraph(analysis.tableId, undefined, { analysisId: analysis.id })}><BarChart3 size={14} /> Graph results</button>
          </>
        )}
        {(analysis.kind === 'nonlin' || analysis.kind === 'linreg') && <button className="btn small" onClick={() => {
          const g = st.project.graphs.find((x) => x.tableId === table.id && x.chart === 'xy');
          if (g) {
            st.update((p) => {
              const x = p.graphs.find((y) => y.id === g.id)!;
              if (!x.fitAnalysisIds.includes(analysis.id)) x.fitAnalysisIds.push(analysis.id);
            });
            st.open(g.id);
          } else st.addGraph(table.id, 'xy');
        }}><BarChart3 size={14} /> Graph with fit</button>}
        <button className="btn small" onClick={() => navigator.clipboard.writeText(resultsToText(res, 10000)).then(() => st.toast('Results copied as text'))}><ClipboardCopy size={14} /> Copy</button>
        <button className="btn small" onClick={() => {
          st.set({ rightPanel: 'claude' });
          window.dispatchEvent(new CustomEvent('quanta:ask', { detail: `Interpret the results of the analysis "${analysis.name}" (id ${analysis.id}) in plain language for a paper's results section.` }));
        }}><Sparkles size={14} color="#d97757" /> Explain</button>
      </div>
      <div className="results">
        {res.warnings.map((w, i) => <div key={i} className="warn-box"><AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />{w}</div>)}
        {res.summary && res.tables.length > 0 && <div className="summary-box">{res.summary}</div>}
        {res.tables.map((tb, i) => (
          <div className="result-block" key={i}>
            <h3>{tb.title}</h3>
            <table className="rtable">
              {tb.header.some((h) => h) && (
                <thead>
                  <tr>{tb.header.map((h, j) => <th key={j}>{h}</th>)}</tr>
                </thead>
              )}
              <tbody>
                {tb.rows.map((r, j) => {
                  const isSection = r.length > 1 && r.slice(1).every((c) => c === '') && r[0] !== '';
                  return (
                    <tr key={j} className={isSection ? 'section' : ''}>
                      {r.map((c, k) => <td key={k} className={cellClass(r[0], c)}>{c}</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
        {res.derivedTable && (
          <div className="result-block">
            <h3>Results table <button className="btn small" onClick={() => st.addGraph(analysis.tableId, undefined, { analysisId: analysis.id })}><BarChart3 size={13} /> Graph it</button></h3>
            <div style={{ height: 320, display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <DataGrid table={res.derivedTable} readOnly />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------- Graph / Figure ----------------
export function GraphView({ id, graph, figure }: { id: string; graph?: Graph; figure?: Figure }) {
  const st = useStore();
  const [zoom, setZoom] = useState(1.25);
  const spec = useMemo(() => (graph ? compileGraph(graph, graphCtx(st.project)) : figure!.spec), [graph, figure, st.project]);
  const svg = useMemo(() => renderFigure(spec, { interactive: !!graph }), [spec, graph]);
  const t = graph ? tableFor(st.project, graph.analysisId ? `derived:${graph.analysisId}` : graph.tableId) ?? tableFor(st.project, graph.tableId) : undefined;
  const canvasRef = useRef<HTMLDivElement>(null);
  const fit = () => {
    const el = canvasRef.current;
    if (!el) return;
    setZoom(Math.max(0.3, Math.min(3, Math.min((el.clientWidth - 60) / spec.width, (el.clientHeight - 60) / spec.height))));
  };
  return (
    <>
      <div className="toolbar">
        <input className="title-input" value={(graph ?? figure)!.name} onChange={(e) => st.renameItem(id, e.target.value)} />
        {graph && t && (
          <div className="chart-picker">
            {chartsFor(t.kind).map((c) => (
              <button key={c} className={`chart-chip ${graph.chart === c ? 'on' : ''}`} onClick={() => st.update((p) => {
                const g = p.graphs.find((x) => x.id === graph.id);
                if (g) g.chart = c;
              })}>{CHART_LABELS[c]}</button>
            ))}
          </div>
        )}
        {figure && <span className="pill">Figure {figure.number}</span>}
        <span className="grow" />
        <button className="iconbtn" title="Zoom out" onClick={() => setZoom(Math.max(0.3, zoom / 1.15))}><ZoomOut size={16} /></button>
        <span className="small muted" style={{ width: 40, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <button className="iconbtn" title="Zoom in" onClick={() => setZoom(Math.min(4, zoom * 1.15))}><ZoomIn size={16} /></button>
        <button className="iconbtn" title="Fit to window" onClick={fit}><Maximize2 size={16} /></button>
        <span className="sep" />
        <button className="btn small" onClick={() => copyGraphToClipboard(renderFigure(spec), spec.width, spec.height).then(() => st.toast('Graph copied to clipboard'), (e) => st.toast(e.message, 'error'))}><Copy size={14} /> Copy</button>
        <button className="btn small primary" onClick={() => st.setDialog({ kind: 'export', itemId: id })}><Download size={14} /> Export</button>
      </div>
      <div className="graph-canvas" ref={canvasRef}>
        <div className="graph-page" style={{ width: spec.width * zoom, height: spec.height * zoom }}>
          <SvgView
            svg={svg}
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', width: spec.width, height: spec.height }}
            onClick={(e) => {
              const s = (e.target as Element).closest('[data-series]');
              st.set({ rightPanel: 'format', selectedSeries: s ? s.getAttribute('data-series') : null });
            }}
          />
        </div>
      </div>
    </>
  );
}

// ---------------- Script ----------------
export function ScriptView({ script }: { script: Script }) {
  const st = useStore();
  const selRef = useRef<() => string>(() => '');
  return (
    <>
      <div className="toolbar">
        <input className="title-input" value={script.name} onChange={(e) => st.renameItem(script.id, e.target.value)} />
        <span className="pill">MATLAB</span>
        <span className="grow" />
        {st.engineBusy ? (
          <button className="btn small danger" onClick={stopExecution}><Square size={14} /> Stop</button>
        ) : (
          <>
            <button className="btn small" title="Run selection (F9)" onClick={() => {
              const sel = selRef.current();
              if (sel.trim()) runScript(script.id, sel);
            }}>Run selection</button>
            <button className="btn small primary" title="Run (F5)" onClick={() => runScript(script.id)}><Play size={14} /> Run</button>
          </>
        )}
        <button className="btn small" onClick={() => saveScriptToDisk(script.id)}><Save size={14} /> Save .m</button>
        <button className="btn small" onClick={() => {
          st.set({ rightPanel: 'claude' });
          window.dispatchEvent(new CustomEvent('quanta:ask', { detail: `Review the script "${script.name}" and explain what it does; suggest improvements.` }));
        }}><Sparkles size={14} color="#d97757" /> Ask Claude</button>
      </div>
      <div className="editor-wrap">
        <CodeEditor
          key={script.id}
          value={script.code}
          dark={st.settings.theme === 'dark'}
          onChange={(code) => st.update((p) => {
            const s = p.scripts.find((x) => x.id === script.id);
            if (s) s.code = code;
          }, { undoable: false })}
          onRun={() => runScript(script.id)}
          onRunSelection={(sel) => runScript(script.id, sel)}
          selectionRef={selRef}
        />
      </div>
    </>
  );
}

// ---------------- Notes ----------------
export function InfoView({ info }: { info: InfoSheet }) {
  const st = useStore();
  const [text, setText] = useState(info.text);
  useEffect(() => setText(info.text), [info.id]);
  return (
    <>
      <div className="toolbar">
        <input className="title-input" value={info.name} onChange={(e) => st.renameItem(info.id, e.target.value)} />
        <span className="pill">Notes</span>
      </div>
      <div className="info-editor">
        <textarea value={text} placeholder="Experiment notes, protocol details, constants…" onChange={(e) => setText(e.target.value)} onBlur={() => st.update((p) => {
          const i = p.infos.find((x) => x.id === info.id);
          if (i) i.text = text;
        })} />
      </div>
    </>
  );
}
