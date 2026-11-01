import { useEffect, useMemo, useState } from 'react';
import { Table2, FlaskConical, BarChart3, Download, Settings, KeyRound, Sparkles, Database, Info, Check, ExternalLink, Plug } from 'lucide-react';
import { useStore, findItem, tableFor } from '../state/store';
import { Modal, NumberInput } from './common';
import type { AnalysisKind, ChartType, TableKind, YFormat } from '../model/types';
import { TABLE_KIND_INFO, chartsFor, CHART_LABELS, selectedDatasets, newTable, emptyDataset, newGraph } from '../model/table';
import { compileGraph } from '../graph/compile';
import { compileUserEquation } from '../lang/equation';
import { analysisDef, defaultParams, type ParamDef } from '../analysis/registry';
import { groupedAnalyses } from '../state/analysisHelpers';
import { NL_MODELS } from '../stats/regression';
import { EXPORT_FORMATS, type ExportFormat } from '../graph/export';
import { exportGraph, specForItem } from '../state/actions';
import { platform } from '../platform';
import { engine } from '../lang/client';
import type { SerializedVar } from '../lang/protocol';
import { renderFigure } from '../graph/render';
import { SvgView } from './common';
import { CLAUDE_MODELS } from '../claude/agent';

export function Dialogs() {
  const d = useStore((s) => s.dialog);
  const close = () => useStore.getState().setDialog(null);
  if (!d) return null;
  switch (d.kind) {
    case 'newTable': return <NewTableDialog onClose={close} />;
    case 'analyze': return <AnalyzeDialog onClose={close} tableId={d.tableId} analysisId={d.analysisId} preset={d.presetKind} />;
    case 'newGraph': return <NewGraphDialog onClose={close} tableId={d.tableId} />;
    case 'export': return <ExportDialog onClose={close} itemId={d.itemId} />;
    case 'settings': return <SettingsDialog onClose={close} />;
    case 'about': return <AboutDialog onClose={close} />;
    case 'variable': return <VariableDialog onClose={close} name={d.name} />;
    case 'confirm':
      return (
        <Modal title={d.title} onClose={close} size="narrow" footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" onClick={() => {
          close();
          d.onOk();
        }}>{d.okLabel ?? 'OK'}</button></>}>
          <p style={{ margin: 0 }}>{d.message}</p>
        </Modal>
      );
    case 'prompt':
      return <PromptDialog title={d.title} label={d.label} value={d.value} onOk={d.onOk} onClose={close} />;
  }
}

function PromptDialog({ title, label, value, onOk, onClose }: { title: string; label: string; value: string; onOk: (v: string) => void; onClose: () => void }) {
  const [v, setV] = useState(value);
  return (
    <Modal title={title} onClose={onClose} size="narrow" footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => {
      onClose();
      onOk(v);
    }}>OK</button></>}>
      <div className="field"><label>{label}</label><input className="input" autoFocus value={v} onChange={(e) => setV(e.target.value)} /></div>
    </Modal>
  );
}

// ---------------- New table ----------------
function NewTableDialog({ onClose }: { onClose: () => void }) {
  const st = useStore();
  const [kind, setKind] = useState<TableKind>('column');
  const [sample, setSample] = useState(false);
  const [reps, setReps] = useState(3);
  const [fmt, setFmt] = useState<YFormat>('replicates');
  const [name, setName] = useState('');
  const info = TABLE_KIND_INFO[kind];
  const create = () => {
    st.addTable(kind, { sample, replicates: reps, yFormat: fmt, name: name.trim() || undefined });
    onClose();
  };
  return (
    <Modal title="New data table" icon={<Table2 size={18} color="var(--accent)" />} size="wide" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={create}>Create</button></>}>
      <div className="kind-cards">
        {(Object.keys(TABLE_KIND_INFO) as TableKind[]).map((k) => (
          <button key={k} className={`kind-card ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)} onDoubleClick={() => {
            setKind(k);
            st.addTable(k, { sample, replicates: reps, yFormat: fmt });
            onClose();
          }}>
            <span className="k-title"><Table2 size={16} color="var(--accent)" /> {TABLE_KIND_INFO[k].label}</span>
            <span className="k-desc">{TABLE_KIND_INFO[k].description}</span>
          </button>
        ))}
      </div>
      <div className="row wrap" style={{ marginTop: 16, gap: 20, alignItems: 'flex-start' }}>
        <div className="field" style={{ minWidth: 220 }}>
          <label>Name</label>
          <input className="input" placeholder={`Data ${st.project.tables.length + 1}`} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>Start with</label>
          <div className="segmented">
            <button className={!sample ? 'on' : ''} onClick={() => setSample(false)}>Empty table</button>
            <button className={sample ? 'on' : ''} onClick={() => setSample(true)}>Sample data</button>
          </div>
        </div>
        {info.allowFormats && !sample && (
          <>
            <div className="field">
              <label>Y values</label>
              <select className="select" value={fmt} onChange={(e) => setFmt(e.target.value as YFormat)}>
                <option value="replicates">Enter replicate values</option>
                <option value="meanSD">Mean and SD</option>
                <option value="meanSEM">Mean and SEM</option>
                <option value="meanSDN">Mean, SD and N</option>
                <option value="meanSEMN">Mean, SEM and N</option>
              </select>
            </div>
            {fmt === 'replicates' && (
              <div className="field">
                <label>Replicates per point</label>
                <input className="input" type="number" min={1} max={50} value={reps} style={{ width: 90 }} onChange={(e) => setReps(Math.max(1, Number(e.target.value) || 1))} />
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

// ---------------- Analyze ----------------
function ParamField({ def, value, onChange, datasets }: { def: ParamDef; value: any; onChange: (v: any) => void; datasets: string[] }) {
  switch (def.type) {
    case 'select':
      return (
        <select className="select" value={value ?? def.default} onChange={(e) => onChange(e.target.value)}>
          {def.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    case 'boolean':
      return <label className="check"><input type="checkbox" checked={!!(value ?? def.default)} onChange={(e) => onChange(e.target.checked)} /> {def.label}</label>;
    case 'number':
      return <NumberInput value={value ?? def.default} onChange={(v) => onChange(v ?? def.default)} />;
    case 'text':
      return <input className="input" value={value ?? def.default} onChange={(e) => onChange(e.target.value)} />;
    case 'dataset':
      return (
        <select className="select" value={value ?? def.default} onChange={(e) => onChange(Number(e.target.value))}>
          {def.default === -1 && <option value={-1}>Last data set (default)</option>}
          {datasets.map((d, i) => <option key={i} value={i}>{d}</option>)}
        </select>
      );
    case 'model': {
      const groups = new Map<string, typeof NL_MODELS>();
      for (const m of NL_MODELS) groups.set(m.group, [...(groups.get(m.group) ?? []), m]);
      return (
        <select className="select" value={value ?? def.default} onChange={(e) => onChange(e.target.value)}>
          {[...groups.entries()].map(([g, ms]) => (
            <optgroup key={g} label={g}>{ms.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>
          ))}
          <optgroup label="User-defined"><option value="custom">Custom equation…</option></optgroup>
        </select>
      );
    }
  }
}

function AnalyzeDialog({ onClose, tableId, analysisId, preset }: { onClose: () => void; tableId?: string; analysisId?: string; preset?: AnalysisKind }) {
  const st = useStore();
  const p = st.project;
  const existing = analysisId ? p.analyses.find((a) => a.id === analysisId) : undefined;
  const [tid, setTid] = useState(tableId ?? existing?.tableId ?? p.tables[0]?.id);
  const table = tid ? tableFor(p, tid) : undefined;
  const groups = table ? groupedAnalyses(table.kind) : [];
  const [kind, setKind] = useState<AnalysisKind | undefined>(existing?.kind ?? preset ?? groups[0]?.[1][0]?.kind);
  const [params, setParams] = useState<Record<string, any>>(existing?.params ?? (kind ? defaultParams(kind) : {}));
  const [dsIds, setDsIds] = useState<string[]>(existing?.datasetIds ?? []);
  useEffect(() => {
    if (!existing && kind) setParams(defaultParams(kind));
  }, [kind]);
  if (!table) return <Modal title="Analyze" onClose={onClose}><p>Create a data table first.</p></Modal>;
  const def = kind ? analysisDef(kind) : undefined;
  const sel = dsIds.length ? dsIds : selectedDatasets(table).map((i) => table.datasets[i].id);
  const dsNames = table.datasets.map((d) => d.title);
  const go = () => {
    if (!kind) return;
    const ids = dsIds.length === table.datasets.length ? undefined : dsIds.length ? dsIds : undefined;
    if (existing) {
      st.update((d) => {
        const a = d.analyses.find((x) => x.id === existing.id);
        if (a) {
          a.kind = kind;
          a.params = params;
          a.datasetIds = ids;
        }
      });
      st.open(existing.id);
    } else st.addAnalysis(table.id, kind, params, ids);
    onClose();
  };
  const model = kind === 'nonlin' ? NL_MODELS.find((m) => m.id === params.model) : undefined;
  return (
    <Modal title={existing ? 'Analysis parameters' : 'Analyze data'} icon={<FlaskConical size={18} color="#8a4fd8" />} size="wide" onClose={onClose}
      footer={<><span className="small muted grow">{def?.description}</span><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!kind} onClick={go}>{existing ? 'Update' : 'Analyze'}</button></>}>
      <div className="two-col">
        <div>
          <div className="field">
            <label>Data table</label>
            <select className="select" value={tid} disabled={!!existing} onChange={(e) => setTid(e.target.value)}>
              {p.tables.map((t) => <option key={t.id} value={t.id}>{t.name} ({TABLE_KIND_INFO[t.kind].label})</option>)}
            </select>
          </div>
          <div className="alist">
            {groups.map(([g, defs]) => (
              <div key={g}>
                <div className="alist-group">{g}</div>
                {defs.map((d) => <div key={d.kind} className={`alist-item ${kind === d.kind ? 'on' : ''}`} onClick={() => setKind(d.kind)} onDoubleClick={() => {
                  setKind(d.kind);
                }}>{d.name}</div>)}
              </div>
            ))}
          </div>
        </div>
        <div>
          {def && (
            <>
              <h3 style={{ marginTop: 0 }}>{def.name}</h3>
              <p className="muted small" style={{ marginTop: -6 }}>{def.description}</p>
              <div className="field">
                <label>Data sets to analyze</label>
                <div className="row wrap">
                  {table.datasets.map((d) => (
                    <label key={d.id} className="check" style={{ marginRight: 10 }}>
                      <input type="checkbox" checked={sel.includes(d.id)} onChange={(e) => setDsIds(e.target.checked ? [...sel, d.id] : sel.filter((x) => x !== d.id))} />
                      {d.title}
                    </label>
                  ))}
                </div>
                {def.minDatasets && sel.length < def.minDatasets && <span className="small" style={{ color: 'var(--danger)' }}>Select at least {def.minDatasets} data sets.</span>}
              </div>
              {def.params.filter((pd) => !pd.showIf || pd.showIf(params)).map((pd) => (
                <div className="field" key={pd.key}>
                  {pd.type !== 'boolean' && <label>{pd.label}</label>}
                  <ParamField def={pd} value={params[pd.key]} datasets={dsNames} onChange={(v) => setParams({ ...params, [pd.key]: v })} />
                </div>
              ))}
              {kind === 'nonlin' && (
                <div className="field">
                  <label>Equation</label>
                  <code className="small" style={{ background: 'var(--panel-3)', padding: '6px 8px', borderRadius: 6 }}>{params.model === 'custom' ? params.custom : model?.equation}</code>
                  {(model || params.model === 'custom') && (
                    <>
                      <label style={{ marginTop: 8 }}>Initial values / constraints (leave blank for automatic)</label>
                      <table className="rtable" style={{ minWidth: 0 }}>
                        <thead><tr><th>Parameter</th><th>Initial value</th><th>Constrain to</th></tr></thead>
                        <tbody>
                          {(params.model === 'custom' ? customParams(params.custom) : model!.params).map((pn) => (
                            <tr key={pn}>
                              <td>{pn}</td>
                              <td><NumberInput value={params.initial?.[pn]} placeholder="auto" onChange={(v) => setParams({ ...params, initial: { ...(params.initial ?? {}), [pn]: v } })} /></td>
                              <td><NumberInput value={params.fixed?.[pn]} placeholder="free" onChange={(v) => setParams({ ...params, fixed: { ...(params.fixed ?? {}), [pn]: v } })} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function customParams(src: string): string[] {
  try {
    return compileUserEquation(src).params;
  } catch {
    return [];
  }
}

// ---------------- New graph ----------------
function NewGraphDialog({ onClose, tableId }: { onClose: () => void; tableId?: string }) {
  const st = useStore();
  const p = st.project;
  const [tid, setTid] = useState(tableId ?? p.tables[0]?.id);
  const t = tid ? tableFor(p, tid) : undefined;
  const charts = t ? chartsFor(t.kind) : [];
  const [chart, setChart] = useState<ChartType | undefined>(charts[0]);
  useEffect(() => setChart(charts[0]), [tid]);
  const preview = useMemo(() => {
    if (!t || !chart) return '';
    const g0 = newGraph(t, 'preview', chart);
    const g = { ...g0, options: { ...g0.options, width: 300, height: 220, fontSize: 10 } };
    g.fitAnalysisIds = p.analyses.filter((a) => a.tableId === t.id && (a.kind === 'nonlin' || a.kind === 'linreg')).map((a) => a.id);
    return renderFigure(compileGraph(g, { project: p, tableFor: (id: string) => tableFor(p, id) }));
  }, [t, chart, p]);
  return (
    <Modal title="New graph" icon={<BarChart3 size={18} color="#1f9d55" />} size="wide" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!t || !chart} onClick={() => {
      st.addGraph(t!.id, chart);
      onClose();
    }}>Create graph</button></>}>
      <div className="two-col">
        <div>
          <div className="field">
            <label>Data table</label>
            <select className="select" value={tid} onChange={(e) => setTid(e.target.value)}>
              {p.tables.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </div>
          <div className="alist">
            {charts.map((c) => <div key={c} className={`alist-item ${chart === c ? 'on' : ''}`} onClick={() => setChart(c)}>{CHART_LABELS[c]}</div>)}
          </div>
        </div>
        <div style={{ display: 'grid', placeItems: 'center', background: 'var(--canvas)', borderRadius: 10, minHeight: 300 }}>
          {preview ? <SvgView svg={preview} style={{ background: '#fff', boxShadow: 'var(--shadow)' }} /> : <span className="muted">Select a table</span>}
        </div>
      </div>
    </Modal>
  );
}


// ---------------- Export ----------------
function ExportDialog({ onClose, itemId }: { onClose: () => void; itemId: string }) {
  const st = useStore();
  const [format, setFormat] = useState<ExportFormat>(platform.isDesktop ? 'pdf' : 'png');
  const [dpi, setDpi] = useState(st.settings.exportDpi);
  const [scale, setScale] = useState(1);
  const [busy, setBusy] = useState(false);
  const spec = specForItem(itemId);
  const raster = format === 'png' || format === 'tiff' || format === 'jpeg';
  return (
    <Modal title="Export graph" icon={<Download size={18} color="var(--accent)" />} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        await exportGraph(itemId, format, dpi, scale);
        onClose();
      } catch (e: any) {
        st.toast(e.message, 'error');
      } finally {
        setBusy(false);
      }
    }}>{busy ? 'Exporting…' : 'Export'}</button></>}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
        <div style={{ flex: 1 }}>
          <div className="field">
            <label>Format</label>
            {EXPORT_FORMATS.map((f) => (
              <label key={f.value} className="check"><input type="radio" name="fmt" checked={format === f.value} disabled={f.value === 'pdf' && !platform.isDesktop} onChange={() => setFormat(f.value)} /> {f.label}{f.value === 'pdf' && !platform.isDesktop ? ' — desktop app only' : ''}</label>
            ))}
          </div>
          {raster && (
            <div className="field">
              <label>Resolution</label>
              <select className="select" value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
                {[72, 150, 300, 600, 1200].map((d) => <option key={d} value={d}>{d} dpi</option>)}
              </select>
            </div>
          )}
          <div className="field">
            <label>Size</label>
            <select className="select" value={scale} onChange={(e) => setScale(Number(e.target.value))}>
              {[0.5, 0.75, 1, 1.5, 2].map((s) => <option key={s} value={s}>{Math.round(s * 100)}%{spec ? ` — ${(spec.width * s / 72).toFixed(2)} × ${(spec.height * s / 72).toFixed(2)} in` : ''}</option>)}
            </select>
          </div>
          {raster && spec && <p className="small muted">Output: {Math.round((spec.width * scale * dpi) / 72)} × {Math.round((spec.height * scale * dpi) / 72)} pixels</p>}
        </div>
        {spec && <SvgView svg={renderFigure({ ...spec })} style={{ width: 300, transform: `scale(${300 / spec.width})`, transformOrigin: 'top left', height: spec.height * (300 / spec.width) }} />}
      </div>
    </Modal>
  );
}

// ---------------- Settings ----------------
function SettingsDialog({ onClose }: { onClose: () => void }) {
  const st = useStore();
  const [key, setKey] = useState('');
  const [s, setS] = useState(st.settings);
  const [mcp, setMcp] = useState<{ enabled: boolean; port?: number; configPath?: string; command?: string; args?: string[]; env?: Record<string, string> } | null>(null);
  useEffect(() => {
    platform.bridge?.mcpStatus().then(setMcp).catch(() => setMcp(null));
  }, []);
  const save = async () => {
    if (key.trim()) {
      if (platform.bridge) await platform.bridge.claudeSetKey(key.trim());
      else await platform.setSettings({ webApiKey: key.trim() });
      st.set({ apiKeySet: true });
    }
    st.set({ settings: s });
    await platform.setSettings({ appSettings: s });
    onClose();
    st.toast('Settings saved', 'success');
  };
  const mcpConfig = mcp?.command ? JSON.stringify({ mcpServers: { 'quanta-studio': { command: mcp.command, args: mcp.args, env: mcp.env } } }, null, 2) : '';
  const q = (x: string) => (/[\s"']/.test(x) ? `"${x.replace(/"/g, '\\"')}"` : x);
  const claudeCodeCmd = mcp?.command ? `claude mcp add quanta-studio -e ELECTRON_RUN_AS_NODE=1 -- ${[mcp.command, ...(mcp.args ?? [])].map(q).join(' ')}` : '';
  return (
    <Modal title="Settings" icon={<Settings size={18} />} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <h3 style={{ marginTop: 0, display: 'flex', gap: 8, alignItems: 'center' }}><Sparkles size={16} color="#d97757" /> Claude</h3>
      <div className="field">
        <label><KeyRound size={12} style={{ verticalAlign: -1 }} /> Anthropic API key {st.apiKeySet && <span className="pill accent"><Check size={10} /> saved</span>}</label>
        <input className="input" type="password" placeholder={st.apiKeySet ? '•••••••• (leave blank to keep)' : 'sk-ant-…'} value={key} onChange={(e) => setKey(e.target.value)} />
        <span className="small muted">{platform.isDesktop ? 'Stored encrypted with your operating system keychain; it never leaves this computer except to call the Anthropic API.' : 'Stored in this browser only. For best security, use the desktop app.'} Get a key at console.anthropic.com.</span>
        {st.apiKeySet && <button className="btn small ghost" style={{ alignSelf: 'flex-start' }} onClick={async () => {
          if (platform.bridge) await platform.bridge.claudeSetKey(null);
          else await platform.setSettings({ webApiKey: null });
          st.set({ apiKeySet: false });
        }}>Remove saved key</button>}
      </div>
      <div className="row" style={{ gap: 12 }}>
        <div className="field grow">
          <label>Model</label>
          <select className="select" value={s.model} onChange={(e) => setS({ ...s, model: e.target.value })}>
            {CLAUDE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Effort</label>
          <select className="select" value={s.effort} onChange={(e) => setS({ ...s, effort: e.target.value as any })}>
            {['low', 'medium', 'high', 'xhigh', 'max'].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
      </div>
      <label className="check"><input type="checkbox" checked={s.allowClaudeCode} onChange={(e) => setS({ ...s, allowClaudeCode: e.target.checked })} /> Allow Claude to run MATLAB code in a sandbox (no file access, 30 s limit)</label>
      {platform.isDesktop && (
        <>
          <h3 style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Plug size={16} /> Connect Claude Desktop / Claude Code (MCP)</h3>
          <label className="check"><input type="checkbox" checked={!!mcp?.enabled} onChange={async (e) => setMcp(await platform.bridge!.mcpEnable(e.target.checked).then(() => platform.bridge!.mcpStatus()))} /> Allow external Claude apps to read and edit this project while Quanta Studio is open</label>
          {mcp?.enabled && mcpConfig && (
            <div className="field">
              <label>Claude Desktop — add to claude_desktop_config.json:</label>
              <textarea className="input" readOnly style={{ fontFamily: 'var(--mono)', fontSize: 11.5, minHeight: 150 }} value={mcpConfig} />
              <button className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => navigator.clipboard.writeText(mcpConfig).then(() => st.toast('Copied'))}>Copy configuration</button>
              <label style={{ marginTop: 8 }}>Claude Code — run in a terminal:</label>
              <textarea className="input" readOnly style={{ fontFamily: 'var(--mono)', fontSize: 11.5, minHeight: 60 }} value={claudeCodeCmd} />
              <button className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => navigator.clipboard.writeText(claudeCodeCmd).then(() => st.toast('Copied'))}>Copy command</button>
            </div>
          )}
        </>
      )}
      <h3>Appearance & defaults</h3>
      <div className="row wrap" style={{ gap: 12 }}>
        <div className="field">
          <label>Theme</label>
          <select className="select" value={s.theme} onChange={(e) => setS({ ...s, theme: e.target.value as any })}>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </select>
        </div>
        <div className="field">
          <label>Default graph style</label>
          <select className="select" value={s.defaultGraphTheme} onChange={(e) => setS({ ...s, defaultGraphTheme: e.target.value as any })}>
            <option value="prism">Publication (Prism-like)</option>
            <option value="matlab">MATLAB-like</option>
            <option value="minimal">Minimal</option>
          </select>
        </div>
        <div className="field">
          <label>Default colors</label>
          <select className="select" value={s.defaultPalette} onChange={(e) => setS({ ...s, defaultPalette: e.target.value })}>
            {['prism', 'colorblind', 'vivid', 'nature', 'pastel', 'grayscale', 'matlab', 'ocean'].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Export resolution</label>
          <select className="select" value={s.exportDpi} onChange={(e) => setS({ ...s, exportDpi: Number(e.target.value) })}>
            {[150, 300, 600, 1200].map((d) => <option key={d} value={d}>{d} dpi</option>)}
          </select>
        </div>
      </div>
    </Modal>
  );
}

// ---------------- Variable viewer ----------------
function VariableDialog({ onClose, name }: { onClose: () => void; name: string }) {
  const st = useStore();
  const [v, setV] = useState<SerializedVar | null | undefined>(undefined);
  const [kind, setKind] = useState<TableKind>('column');
  useEffect(() => {
    engine().getVar(name).then(setV);
  }, [name]);
  const numeric = v && v.re && v.kind === 'tensor';
  const toTable = () => {
    if (!v || !v.re) return;
    const t = newTable(kind, name, { datasets: 0, replicates: 1 });
    const col = (j: number) => Array.from({ length: v.rows }, (_, i) => v.re![j * v.rows + i]).map((x) => (Number.isFinite(x) ? x : null));
    let j0 = 0;
    if (kind === 'xy' || kind === 'survival') {
      t.x = col(0);
      j0 = 1;
    }
    for (let j = j0; j < v.cols; j++) {
      const ds = emptyDataset(t, `${name}(:,${j + 1})`);
      ds.cols = [col(j)];
      t.datasets.push(ds);
    }
    st.addTableObject(t);
    onClose();
  };
  return (
    <Modal title={<span style={{ fontFamily: 'var(--mono)' }}>{name}</span>} icon={<Database size={18} color="var(--accent)" />} size="wide" onClose={onClose} footer={numeric ? (
      <>
        <span className="small muted grow">Send this matrix to the project as a data table (columns become data sets).</span>
        <select className="select" value={kind} onChange={(e) => setKind(e.target.value as TableKind)}>
          <option value="column">Column table</option>
          <option value="xy">XY table (first column = X)</option>
          <option value="multi">Multiple variables</option>
          <option value="grouped">Grouped</option>
        </select>
        <button className="btn primary" onClick={toTable}><Table2 size={14} /> Create data table</button>
      </>
    ) : <button className="btn" onClick={onClose}>Close</button>}>
      {v === undefined && <p>Loading…</p>}
      {v === null && <p>Variable not found.</p>}
      {v && (
        <>
          <p className="small muted" style={{ marginTop: 0 }}>{v.rows}×{v.cols} {v.cls}</p>
          {numeric && v.rows * v.cols <= 20000 ? (
            <div className="var-grid">
              <table>
                <thead><tr><th></th>{Array.from({ length: v.cols }, (_, j) => <th key={j}>{j + 1}</th>)}</tr></thead>
                <tbody>
                  {Array.from({ length: Math.min(v.rows, 2000) }, (_, i) => (
                    <tr key={i}><th>{i + 1}</th>{Array.from({ length: v.cols }, (_, j) => {
                      const x = v.re![j * v.rows + i];
                      const im = v.im?.[j * v.rows + i];
                      return <td key={j}>{v.cls === 'char' ? String.fromCharCode(x) : im ? `${+x.toPrecision(6)}${im < 0 ? '-' : '+'}${+Math.abs(im).toPrecision(6)}i` : +x.toPrecision(8)}</td>;
                    })}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <pre style={{ fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--code-bg)', padding: 12, borderRadius: 8, maxHeight: '55vh', overflow: 'auto' }}>{v.text}</pre>
          )}
        </>
      )}
    </Modal>
  );
}

// ---------------- About ----------------
function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="About Quanta Studio" icon={<Info size={18} />} size="narrow" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Close</button>}>
      <div className="row" style={{ gap: 12 }}>
        <div className="brand-logo" style={{ width: 44, height: 44, borderRadius: 12 }} />
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Quanta Studio 1.0</div>
          <div className="muted small">Scientific graphing · biostatistics · numerical computing</div>
        </div>
      </div>
      <p style={{ lineHeight: 1.55 }}>
        Quanta Studio combines Prism-style data tables, analyses and publication graphs with a MATLAB-compatible numerical computing language, with Claude built in as a research assistant.
        It reads and writes Prism XML (.pzfx) data tables and MATLAB .m scripts and .mat files.
      </p>
      <p className="small muted">GraphPad Prism and MATLAB are trademarks of their respective owners. Quanta Studio is an independent project and is not affiliated with or endorsed by them.</p>
      <button className="btn small ghost" onClick={() => platform.openExternal('https://github.com/KakiroX/Winners2')}><ExternalLink size={13} /> Project page</button>
    </Modal>
  );
}

void findItem;
