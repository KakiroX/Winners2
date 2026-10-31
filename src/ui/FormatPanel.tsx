import { Palette, Ruler, Sigma, Type, Layers, Star, Eye, EyeOff, Trash2, Plus, Info } from 'lucide-react';
import { useStore, findItem, tableFor } from '../state/store';
import type { Graph, GraphOptions, AxisOptions, MarkerShape } from '../model/types';
import { selectedDatasets, CHART_LABELS, chartsFor, TABLE_KIND_INFO, rowCount } from '../model/table';
import { PALETTES, paletteColor } from '../graph/spec';
import { Section, NumberInput } from './common';
import { runAnalysis, analysisDef } from '../analysis/registry';
import { significanceAnnotations } from '../graph/compile';

const MARKERS: MarkerShape[] = ['circle', 'square', 'triangle', 'diamond', 'triangleDown', 'cross', 'plus', 'star', 'none'];

export function FormatPanel() {
  const st = useStore();
  const found = st.activeId ? findItem(st.project, st.activeId) : null;
  if (!found) return <div className="chat-empty">Select a graph to format it, or a table/result to see details.</div>;
  if (found.type === 'graph') return <GraphFormat graph={found.item as Graph} />;
  if (found.type === 'table') {
    const t = found.item as any;
    const p = st.project;
    return (
      <div style={{ padding: 14 }}>
        <div className="field-label">Table type</div>
        <p style={{ marginTop: 4 }}><b>{TABLE_KIND_INFO[t.kind as keyof typeof TABLE_KIND_INFO].label}</b> — {TABLE_KIND_INFO[t.kind as keyof typeof TABLE_KIND_INFO].description}</p>
        <div className="field-label">Size</div>
        <p style={{ marginTop: 4 }}>{rowCount(t)} rows · {t.datasets.length} data sets{t.excluded.length ? ` · ${t.excluded.length} excluded values` : ''}</p>
        <div className="field-label">Linked sheets</div>
        <ul style={{ paddingLeft: 18, marginTop: 4 }}>
          {p.analyses.filter((a) => a.tableId === t.id).map((a) => <li key={a.id}><a href="#" onClick={(e) => (e.preventDefault(), st.open(a.id))}>{a.name}</a></li>)}
          {p.graphs.filter((g) => g.tableId === t.id).map((g) => <li key={g.id}><a href="#" onClick={(e) => (e.preventDefault(), st.open(g.id))}>{g.name}</a></li>)}
        </ul>
        <div className="field-label" style={{ marginTop: 10 }}>Notes</div>
        <textarea className="input" style={{ width: '100%', minHeight: 100, marginTop: 4 }} defaultValue={t.notes} onBlur={(e) => st.update((pp) => {
          const x = pp.tables.find((y) => y.id === t.id);
          if (x) x.notes = e.target.value;
        })} />
      </div>
    );
  }
  if (found.type === 'analysis') {
    const a = found.item as any;
    const def = analysisDef(a.kind);
    return (
      <div style={{ padding: 14 }}>
        <div className="field-label">Analysis</div>
        <p style={{ marginTop: 4 }}><b>{def.name}</b></p>
        <p className="muted small">{def.description}</p>
        <button className="btn" onClick={() => st.setDialog({ kind: 'analyze', tableId: a.tableId, analysisId: a.id })}>Change parameters…</button>
        <p className="muted small" style={{ marginTop: 14 }}><Info size={12} style={{ verticalAlign: -2 }} /> Results update automatically when you edit the data table.</p>
      </div>
    );
  }
  if (found.type === 'figure') return <div className="chat-empty">Figures are created by plotting commands. Change them by editing and re-running the code, e.g. <code>title('...')</code>, <code>xlim([0 10])</code>, <code>legend(...)</code>, or ask Claude.</div>;
  return <div className="chat-empty">Nothing to format for this sheet.</div>;
}

function AxisEditor({ axis, onChange, isCategory }: { axis: AxisOptions; onChange: (a: Partial<AxisOptions>) => void; isCategory?: boolean }) {
  return (
    <div className="fgrid">
      <label>Title</label>
      <input className="input" value={axis.title} onChange={(e) => onChange({ title: e.target.value })} />
      {!isCategory && (
        <>
          <label>Scale</label>
          <select className="select" value={axis.scale} onChange={(e) => onChange({ scale: e.target.value as any })}>
            <option value="linear">Linear</option>
            <option value="log10">Log 10</option>
          </select>
          <label>Range</label>
          <div className="row">
            <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={axis.auto} onChange={(e) => onChange({ auto: e.target.checked })} /> Auto</label>
          </div>
          {!axis.auto && (
            <>
              <label>Min / Max</label>
              <div className="row">
                <NumberInput value={axis.min} onChange={(v) => onChange({ min: v })} style={{ width: '50%' }} />
                <NumberInput value={axis.max} onChange={(v) => onChange({ max: v })} style={{ width: '50%' }} />
              </div>
              <label>Tick interval</label>
              <NumberInput value={axis.tickInterval} onChange={(v) => onChange({ tickInterval: v })} placeholder="auto" />
            </>
          )}
          <label>Numbers</label>
          <select className="select" value={axis.format ?? 'auto'} onChange={(e) => onChange({ format: e.target.value as any })}>
            <option value="auto">Automatic</option>
            <option value="decimal">Decimal</option>
            <option value="scientific">Scientific</option>
            <option value="percent">Percent</option>
          </select>
        </>
      )}
      <label>Gridlines</label>
      <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={axis.gridlines} onChange={(e) => onChange({ gridlines: e.target.checked })} /> Show</label>
    </div>
  );
}

function GraphFormat({ graph }: { graph: Graph }) {
  const st = useStore();
  const p = st.project;
  const t = tableFor(p, graph.analysisId ? `derived:${graph.analysisId}` : graph.tableId) ?? tableFor(p, graph.tableId);
  const o = graph.options;
  const set = (patch: Partial<GraphOptions>) => st.update((d) => {
    const g = d.graphs.find((x) => x.id === graph.id);
    if (g) g.options = { ...g.options, ...patch };
  });
  const setG = (fn: (g: Graph) => void) => st.update((d) => {
    const g = d.graphs.find((x) => x.id === graph.id);
    if (g) fn(g);
  });
  if (!t) return <div className="chat-empty">The data for this graph was deleted.</div>;
  const idxAll = t.datasets.map((_, i) => i);
  const selected = new Set(selectedDatasets(t, graph.datasetIds));
  const isColumnChart = ['scatter', 'bar', 'box', 'violin', 'meanError', 'beforeAfter'].includes(graph.chart);
  const comparisonSources = p.analyses.filter((a) => a.tableId === t.id && ['ttest', 'anova1', 'anova2', 'multipleT', 'survival'].includes(a.kind));
  const selSeries = st.selectedSeries;
  void selSeries;
  return (
    <div>
      <Section title="Graph type" icon={<Layers size={14} />}>
        <div className="chart-picker">
          {chartsFor(t.kind).map((c) => <button key={c} className={`chart-chip ${graph.chart === c ? 'on' : ''}`} onClick={() => setG((g) => void (g.chart = c))}>{CHART_LABELS[c]}</button>)}
        </div>
      </Section>
      <Section title="Data sets" icon={<Palette size={14} />}>
        {idxAll.map((i) => {
          const ds = t.datasets[i];
          const s = o.series[ds.id] ?? {};
          const color = s.color ?? paletteColor(o.palette, [...selected].indexOf(i) >= 0 ? [...selected].indexOf(i) : i);
          const on = selected.has(i);
          return (
            <div className="series-row" key={ds.id}>
              <button className="iconbtn" title={on ? 'Hide' : 'Show'} onClick={() => setG((g) => {
                const cur = new Set(selectedDatasets(t, g.datasetIds).map((k) => t.datasets[k].id));
                if (cur.has(ds.id)) cur.delete(ds.id);
                else cur.add(ds.id);
                g.datasetIds = t.datasets.filter((d) => cur.has(d.id)).map((d) => d.id);
              })}>{on ? <Eye size={14} /> : <EyeOff size={14} />}</button>
              <input type="color" className="swatch" value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#000000'} onChange={(e) => setG((g) => void (g.options.series[ds.id] = { ...g.options.series[ds.id], color: e.target.value }))} />
              <span className="name" style={{ opacity: on ? 1 : 0.5 }}>{ds.title}</span>
              <select className="select" style={{ width: 92 }} value={s.marker ?? ''} onChange={(e) => setG((g) => void (g.options.series[ds.id] = { ...g.options.series[ds.id], marker: (e.target.value || undefined) as MarkerShape }))}>
                <option value="">auto</option>
                {MARKERS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          );
        })}
        <div className="field-label" style={{ marginTop: 8 }}>Color scheme</div>
        <div className="palette-row" style={{ marginTop: 4 }}>
          {Object.entries(PALETTES).map(([k, v]) => (
            <div key={k} className={`palette-opt ${o.palette === k ? 'on' : ''}`} title={v.name} onClick={() => setG((g) => {
              g.options.palette = k;
              for (const id of Object.keys(g.options.series)) delete g.options.series[id].color;
            })}>
              {v.colors.slice(0, 6).map((c, i) => <span key={i} style={{ background: c }} />)}
            </div>
          ))}
        </div>
      </Section>
      {(isColumnChart || ['xy', 'groupedBar', 'stackedBar', 'groupedScatter'].includes(graph.chart)) && (
        <Section title="Points, bars & error bars" icon={<Sigma size={14} />}>
          <div className="fgrid">
            <label>Error bars</label>
            <select className="select" value={o.errorBar} onChange={(e) => set({ errorBar: e.target.value as any })}>
              <option value="sd">Mean ± SD</option>
              <option value="sem">Mean ± SEM</option>
              <option value="ci95">Mean with 95% CI</option>
              <option value="range">Range</option>
              <option value="iqr">Interquartile range</option>
              <option value="none">None</option>
            </select>
            {['bar', 'groupedBar', 'stackedBar'].includes(graph.chart) && (
              <>
                <label>Direction</label>
                <select className="select" value={o.errorDirection} onChange={(e) => set({ errorDirection: e.target.value as any })}>
                  <option value="both">Both</option>
                  <option value="above">Above</option>
                  <option value="below">Below</option>
                </select>
                <label>Bar fill</label>
                <select className="select" value={o.barFill} onChange={(e) => set({ barFill: e.target.value as any })}>
                  <option value="solid">Solid</option>
                  <option value="light">Light</option>
                  <option value="hollow">Hollow</option>
                </select>
              </>
            )}
            {isColumnChart && (
              <>
                <label>Center line</label>
                <select className="select" value={o.center} onChange={(e) => set({ center: e.target.value as any })}>
                  <option value="mean">Mean</option>
                  <option value="median">Median</option>
                </select>
              </>
            )}
            {graph.chart === 'box' && (
              <>
                <label>Whiskers</label>
                <select className="select" value={o.whiskers} onChange={(e) => set({ whiskers: e.target.value as any })}>
                  <option value="minmax">Min to max</option>
                  <option value="tukey">Tukey (1.5 IQR)</option>
                  <option value="5-95">5–95 percentile</option>
                  <option value="10-90">10–90 percentile</option>
                </select>
              </>
            )}
            <label>Show points</label>
            <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={o.showPoints} onChange={(e) => set({ showPoints: e.target.checked })} /> Individual values</label>
            {graph.chart === 'xy' && (
              <>
                <label>Lines</label>
                <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={o.connectLines} onChange={(e) => set({ connectLines: e.target.checked })} /> Connect points</label>
                <label>Curve fits</label>
                <label className="check" style={{ margin: 0 }}><input type="checkbox" checked={o.showFitCurves} onChange={(e) => set({ showFitCurves: e.target.checked })} /> Show regression curves</label>
              </>
            )}
            <label>Point size</label>
            <input type="range" min={2} max={16} value={o.pointSize} onChange={(e) => set({ pointSize: Number(e.target.value) })} />
            <label>Bar/box width</label>
            <input type="range" min={0.2} max={1} step={0.05} value={o.barWidth} onChange={(e) => set({ barWidth: Number(e.target.value) })} />
            <label>Line width</label>
            <input type="range" min={0.5} max={4} step={0.25} value={o.lineWidth} onChange={(e) => set({ lineWidth: Number(e.target.value) })} />
          </div>
        </Section>
      )}
      {graph.chart === 'survival' && (
        <Section title="Survival curve" icon={<Sigma size={14} />}>
          <label className="check"><input type="checkbox" checked={o.survivalPercent} onChange={(e) => set({ survivalPercent: e.target.checked })} /> Show as percent</label>
          <label className="check"><input type="checkbox" checked={o.showCensored} onChange={(e) => set({ showCensored: e.target.checked })} /> Mark censored subjects</label>
          <label className="check"><input type="checkbox" checked={o.showCI} onChange={(e) => set({ showCI: e.target.checked })} /> 95% confidence bands</label>
          <div className="fgrid" style={{ marginTop: 6 }}>
            <label>Line width</label>
            <input type="range" min={0.5} max={4} step={0.25} value={o.lineWidth} onChange={(e) => set({ lineWidth: Number(e.target.value) })} />
          </div>
        </Section>
      )}
      {graph.chart !== 'pie' && graph.chart !== 'donut' && (
        <>
          <Section title="Y axis" icon={<Ruler size={14} />}>
            <AxisEditor axis={o.yAxis} onChange={(a) => set({ yAxis: { ...o.yAxis, ...a } })} />
          </Section>
          <Section title="X axis" icon={<Ruler size={14} style={{ transform: 'rotate(90deg)' }} />} defaultOpen={!isColumnChart}>
            <AxisEditor axis={o.xAxis} isCategory={isColumnChart || graph.chart.startsWith('grouped') || graph.chart === 'stackedBar'} onChange={(a) => set({ xAxis: { ...o.xAxis, ...a } })} />
            {(isColumnChart || graph.chart.startsWith('grouped')) && <label className="check"><input type="checkbox" checked={o.rotateXLabels} onChange={(e) => set({ rotateXLabels: e.target.checked })} /> Angle category labels</label>}
          </Section>
        </>
      )}
      <Section title="Titles, size & style" icon={<Type size={14} />}>
        <div className="fgrid">
          <label>Graph title</label>
          <input className="input" value={o.title} onChange={(e) => set({ title: e.target.value })} />
          <label>Style</label>
          <select className="select" value={o.theme} onChange={(e) => set({ theme: e.target.value as any })}>
            <option value="prism">Publication (Prism-like)</option>
            <option value="matlab">MATLAB-like</option>
            <option value="minimal">Minimal</option>
            <option value="dark">Dark (slides)</option>
          </select>
          <label>Frame</label>
          <select className="select" value={o.frame} onChange={(e) => set({ frame: e.target.value as any })}>
            <option value="open">Open (L-shaped)</option>
            <option value="box">Box</option>
          </select>
          <label>Width × height</label>
          <div className="row">
            <NumberInput value={o.width} onChange={(v) => v && set({ width: Math.max(150, Math.min(2000, v)) })} style={{ width: '50%' }} />
            <NumberInput value={o.height} onChange={(v) => v && set({ height: Math.max(120, Math.min(2000, v)) })} style={{ width: '50%' }} />
          </div>
          <label>Font</label>
          <select className="select" value={o.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })}>
            <option value="Arial, Helvetica, sans-serif">Arial</option>
            <option value="Helvetica, Arial, sans-serif">Helvetica</option>
            <option value="'Times New Roman', Times, serif">Times New Roman</option>
            <option value="Calibri, Carlito, sans-serif">Calibri</option>
            <option value="Verdana, sans-serif">Verdana</option>
            <option value="'Courier New', monospace">Courier New</option>
          </select>
          <label>Font size</label>
          <input type="range" min={8} max={22} value={o.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })} />
          <label>Legend</label>
          <select className="select" value={o.legend} onChange={(e) => set({ legend: e.target.value as any })}>
            <option value="auto">Automatic</option>
            <option value="right">Right</option>
            <option value="top">Top</option>
            <option value="inside">Inside</option>
            <option value="none">Hidden</option>
          </select>
        </div>
      </Section>
      {(isColumnChart || graph.chart.startsWith('grouped')) && (
        <Section title="Significance annotations" icon={<Star size={14} />}>
          {comparisonSources.length ? (
            <>
              <p className="small muted" style={{ marginTop: 0 }}>Add asterisk brackets from an analysis of this table (P &lt; 0.05 *, &lt; 0.01 **, &lt; 0.001 ***, &lt; 0.0001 ****).</p>
              {comparisonSources.map((a) => (
                <div key={a.id} className="row" style={{ marginBottom: 6 }}>
                  <span className="grow small">{a.name}</span>
                  <button className="btn small" onClick={() => {
                    const res = runAnalysis(t, a);
                    const anns = significanceAnnotations(res.comparisons ?? [], t, graph, false);
                    if (!anns.length) st.toast('No significant comparisons to annotate.');
                    setG((g) => void (g.annotations = [...g.annotations.filter((x) => x.kind !== 'bracket'), ...anns]));
                  }}><Plus size={13} /> Add</button>
                </div>
              ))}
            </>
          ) : (
            <p className="small muted" style={{ marginTop: 0 }}>Run a t test or ANOVA on this table to add significance brackets automatically.</p>
          )}
          {graph.annotations.length > 0 && (
            <>
              {graph.annotations.map((an, k) => (
                <div className="series-row" key={an.id}>
                  <span className="name small">{an.kind === 'bracket' ? `${t.datasets[selectedDatasets(t, graph.datasetIds)[an.from ?? 0]]?.title ?? '?'} ↔ ${t.datasets[selectedDatasets(t, graph.datasetIds)[an.to ?? 0]]?.title ?? '?'}` : 'Text'}</span>
                  <input className="input" style={{ width: 70 }} value={an.text} onChange={(e) => setG((g) => void (g.annotations[k].text = e.target.value))} />
                  <button className="iconbtn" onClick={() => setG((g) => void g.annotations.splice(k, 1))}><Trash2 size={14} /></button>
                </div>
              ))}
              <button className="btn small ghost" onClick={() => setG((g) => void (g.annotations = []))}>Remove all</button>
            </>
          )}
        </Section>
      )}
    </div>
  );
}
