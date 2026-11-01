import { useEffect } from 'react';
import { X, Sparkles, SlidersHorizontal, Settings as SettingsIcon, Save } from 'lucide-react';
import { useStore, findItem } from './state/store';
import { Ribbon, RibbonTabs, useRibbonTab } from './ui/Ribbon';
import { Navigator } from './ui/Navigator';
import { TableView, ResultsView, GraphView, ScriptView, InfoView } from './ui/Views';
import { FormatPanel } from './ui/FormatPanel';
import { CommandWindow } from './ui/CommandWindow';
import { ClaudePanel } from './ui/ClaudePanel';
import { Dialogs } from './ui/Dialogs';
import { Welcome } from './ui/Welcome';
import { ItemIcon, Splitter } from './ui/common';
import { platform } from './platform';
import { exportAllPzfx, importDialog, newProject, openPath, openProjectDialog, saveProject, saveWorkspaceMat, stopExecution, runScript, openFileData } from './state/actions';
import { registerMcpBridge } from './claude/mcp';
import type { Analysis, DataTable, Figure, Graph, InfoSheet, Script } from './model/types';

function DocTabs() {
  const st = useStore();
  const items = st.openTabs.map((id) => findItem(st.project, id)).filter((x): x is NonNullable<typeof x> => !!x);
  if (!items.length) return null;
  return (
    <div className="doctabs">
      {items.map(({ type, item }) => (
        <div key={item.id} className={`doctab ${st.activeId === item.id ? 'active' : ''}`} onClick={() => st.open(item.id)} onAuxClick={(e) => e.button === 1 && st.closeTab(item.id)}>
          <ItemIcon type={type} size={13} />
          <span className="lbl">{item.name}</span>
          <button className="x" onClick={(e) => {
            e.stopPropagation();
            st.closeTab(item.id);
          }}><X size={12} /></button>
        </div>
      ))}
    </div>
  );
}

function ActiveSheet() {
  const st = useStore();
  const found = st.activeId ? findItem(st.project, st.activeId) : null;
  if (!found) return <Welcome />;
  switch (found.type) {
    case 'table': return <TableView key={found.item.id} table={found.item as DataTable} />;
    case 'analysis': return <ResultsView key={found.item.id} analysis={found.item as Analysis} />;
    case 'graph': return <GraphView key={found.item.id} id={found.item.id} graph={found.item as Graph} />;
    case 'figure': return <GraphView key={found.item.id} id={found.item.id} figure={found.item as Figure} />;
    case 'script': return <ScriptView key={found.item.id} script={found.item as Script} />;
    case 'info': return <InfoView key={found.item.id} info={found.item as InfoSheet} />;
  }
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
    </div>
  );
}

export function App() {
  const st = useStore();
  const [tab, setTab] = useRibbonTab();
  const theme = st.settings.theme === 'system' ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : st.settings.theme;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Load persisted settings & key status
  useEffect(() => {
    (async () => {
      const s = await platform.getSettings();
      if (s.appSettings) useStore.setState({ settings: { ...useStore.getState().settings, ...s.appSettings } });
      const hasKey = platform.bridge ? await platform.bridge.claudeHasKey() : !!s.webApiKey;
      useStore.setState({ apiKeySet: hasKey });
    })();
    registerMcpBridge();
  }, []);

  // Persist settings
  useEffect(() => {
    platform.setSettings({ appSettings: st.settings });
  }, [st.settings]);

  // Window title & dirty flag
  useEffect(() => {
    const name = st.filePath ? st.filePath.replace(/^.*[\\/]/, '') : st.project.name;
    platform.setTitle(`${st.dirty ? '• ' : ''}${name} — Quanta Studio`);
    platform.setDirty(st.dirty);
  }, [st.dirty, st.filePath, st.project.name]);

  // Menu commands from Electron
  useEffect(() => {
    if (!platform.bridge) return;
    const off1 = platform.bridge.onMenu((cmd) => {
      const s = useStore.getState();
      switch (cmd) {
        case 'new': return newProject();
        case 'open': return openProjectDialog();
        case 'save': return saveProject();
        case 'saveAs': return saveProject(true);
        case 'import': return importDialog();
        case 'exportPzfx': return exportAllPzfx();
        case 'saveWorkspace': return saveWorkspaceMat();
        case 'undo':
        case 'redo': {
          const el = document.activeElement as HTMLElement | null;
          if (el && el.closest('input, textarea, .cm-editor')) {
            document.execCommand(cmd);
            return;
          }
          return cmd === 'undo' ? s.undo() : s.redo();
        }
        case 'newTable': return s.setDialog({ kind: 'newTable' });
        case 'newScript': return s.addScript();
        case 'toggleCommand': return s.set({ bottomOpen: !s.bottomOpen });
        case 'toggleClaude': return s.set({ rightPanel: s.rightPanel === 'claude' ? null : 'claude' });
        case 'toggleFormat': return s.set({ rightPanel: s.rightPanel === 'format' ? null : 'format' });
        case 'settings': return s.setDialog({ kind: 'settings' });
        case 'about': return s.setDialog({ kind: 'about' });
        case 'stop': return stopExecution();
      }
    });
    const off2 = platform.bridge.onOpenPath((p) => openPath(p));
    return () => {
      off1();
      off2();
    };
  }, []);

  // Keyboard shortcuts (browser + desktop)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const target = e.target as HTMLElement;
      const inEditor = target.closest('.cm-editor, input, textarea, select');
      const s = useStore.getState();
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveProject(e.shiftKey);
      } else if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        openProjectDialog();
      } else if (mod && !inEditor && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        s.undo();
      } else if (mod && !inEditor && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        s.redo();
      } else if (e.key === 'F5' && !inEditor) {
        const a = s.activeId ? findItem(s.project, s.activeId) : null;
        if (a?.type === 'script') {
          e.preventDefault();
          runScript(a.item.id);
        }
      }
    };
    window.addEventListener('keydown', h);
    const before = (e: BeforeUnloadEvent) => {
      if (!platform.isDesktop && useStore.getState().dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', before);
    return () => {
      window.removeEventListener('keydown', h);
      window.removeEventListener('beforeunload', before);
    };
  }, []);

  // Drag & drop files
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = async (e: DragEvent) => {
      e.preventDefault();
      for (const f of Array.from(e.dataTransfer?.files ?? [])) await openFileData(f.name, new Uint8Array(await f.arrayBuffer()), (f as any).path ?? null);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  return (
    <div className="app">
      <div className="titlebar">
        <div className="brand"><div className="brand-logo" /> Quanta Studio</div>
        <RibbonTabs tab={tab} setTab={setTab} />
        <div className="title-file">{st.filePath ?? st.project.name}{st.dirty ? ' — unsaved' : ''}</div>
        <div className="title-actions">
          <button className="title-btn" title="Save (Ctrl+S)" onClick={() => saveProject()}><Save size={13} /></button>
          <button className="title-btn" title="Format panel" onClick={() => st.set({ rightPanel: st.rightPanel === 'format' ? null : 'format' })}><SlidersHorizontal size={13} /> Format</button>
          <button className="title-btn claude" onClick={() => st.set({ rightPanel: st.rightPanel === 'claude' ? null : 'claude' })}><Sparkles size={13} /> Claude</button>
          <button className="title-btn" title="Settings" onClick={() => st.setDialog({ kind: 'settings' })}><SettingsIcon size={13} /></button>
        </div>
      </div>
      <Ribbon tab={tab} />
      <div className="main">
        <Navigator />
        <Splitter dir="v" onDrag={(d) => st.set({ navWidth: Math.max(180, Math.min(480, useStore.getState().navWidth + d)) })} />
        <div className="center">
          <div className="workarea">
            <DocTabs />
            <div className="docbody"><ActiveSheet /></div>
          </div>
          {st.bottomOpen && (
            <>
              <Splitter dir="h" onDrag={(d) => st.set({ bottomHeight: Math.max(100, Math.min(window.innerHeight - 260, useStore.getState().bottomHeight - d)) })} />
              <CommandWindow />
            </>
          )}
        </div>
        {st.rightPanel && (
          <>
            <Splitter dir="v" onDrag={(d) => st.set({ rightWidth: Math.max(280, Math.min(700, useStore.getState().rightWidth - d)) })} />
            <div className="right" style={{ width: st.rightWidth }}>
              <div className="panel-tabs">
                <button className={`panel-tab ${st.rightPanel === 'format' ? 'active' : ''}`} onClick={() => st.set({ rightPanel: 'format' })}><SlidersHorizontal size={14} /> Format</button>
                <button className={`panel-tab ${st.rightPanel === 'claude' ? 'active' : ''}`} onClick={() => st.set({ rightPanel: 'claude' })}><Sparkles size={14} color="#d97757" /> Claude</button>
                <button className="iconbtn" style={{ margin: 6 }} onClick={() => st.set({ rightPanel: null })}><X size={14} /></button>
              </div>
              <div className="panel-body" style={{ display: st.rightPanel === 'format' ? 'block' : 'none' }}><FormatPanel /></div>
              <div className="panel-body" style={{ display: st.rightPanel === 'claude' ? 'flex' : 'none', flexDirection: 'column' }}><ClaudePanel /></div>
            </div>
          </>
        )}
      </div>
      <div className="statusbar">
        <span><span className={`dot ${st.engineBusy ? 'busy' : ''}`} />{st.engineBusy ? 'Running…' : 'Ready'}</span>
        <span>{st.project.tables.length} tables · {st.project.analyses.length} analyses · {st.project.graphs.length} graphs · {st.project.scripts.length} scripts</span>
        <span className="spacer" />
        <span>{platform.isDesktop ? 'Desktop' : 'Web'} · Claude {st.apiKeySet ? 'connected' : 'not configured'}</span>
      </div>
      <Dialogs />
      <Toasts />
    </div>
  );
}
