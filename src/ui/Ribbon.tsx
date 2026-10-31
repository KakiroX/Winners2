import { useState } from 'react';
import {
  FilePlus2, FolderOpen, Save, Import, Table2, FlaskConical, BarChart3, FileCode2, Play, Square, Undo2, Redo2, Download, Sparkles, Settings, Sigma,
  TrendingUp, Activity, LineChart, Rows3, PieChart, Grid3x3, Eraser, Terminal, PanelRight, Moon, Sun, StickyNote, HelpCircle, FileOutput, Layers, Spline, Percent, ScatterChart,
} from 'lucide-react';
import { useStore, findItem, tableFor } from '../state/store';
import { exportAllPzfx, exportTable, importDialog, newProject, openProjectDialog, runCode, runScript, saveProject, saveWorkspaceMat, stopExecution } from '../state/actions';
import type { AnalysisKind, Graph } from '../model/types';
import { chartsFor, CHART_LABELS } from '../model/table';
import { engine } from '../lang/client';

type TabName = 'Home' | 'Analyze' | 'Graph' | 'Code' | 'View';

function RBtn({ icon, label, onClick, disabled, title }: { icon: React.ReactNode; label: string; onClick?: () => void; disabled?: boolean; title?: string }) {
  return (
    <button className="rbtn" onClick={onClick} disabled={disabled} title={title ?? label}>
      <span className="ic-wrap">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function SBtn({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button className="rbtn-sm" onClick={onClick} disabled={disabled}>
      {icon}
      {label}
    </button>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="ribbon-group">
      <div className="ribbon-group-items">{children}</div>
      <div className="ribbon-group-label">{label}</div>
    </div>
  );
}

export function RibbonTabs({ tab, setTab }: { tab: TabName; setTab: (t: TabName) => void }) {
  return (
    <div className="ribbon-tabs">
      {(['Home', 'Analyze', 'Graph', 'Code', 'View'] as TabName[]).map((t) => (
        <button key={t} className={`ribbon-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
          {t}
        </button>
      ))}
    </div>
  );
}

export function useRibbonTab() {
  return useState<TabName>('Home');
}

export function Ribbon({ tab }: { tab: TabName }) {
  const st = useStore();
  const active = st.activeId ? findItem(st.project, st.activeId) : null;
  const activeTableId = active?.type === 'table' ? active.item.id : active?.type === 'analysis' ? (active.item as any).tableId : active?.type === 'graph' ? (active.item as Graph).tableId : null;
  const activeTable = activeTableId ? tableFor(st.project, activeTableId) : undefined;
  const I = 22;
  const quick = (kind: AnalysisKind) => () => activeTableId && st.setDialog({ kind: 'analyze', tableId: activeTableId, presetKind: kind });

  if (tab === 'Home')
    return (
      <div className="ribbon">
        <Group label="Project">
          <RBtn icon={<FilePlus2 size={I} />} label="New" onClick={newProject} />
          <RBtn icon={<FolderOpen size={I} />} label="Open" onClick={openProjectDialog} />
          <RBtn icon={<Save size={I} />} label="Save" onClick={() => saveProject()} />
          <div className="rbtn-col">
            <SBtn icon={<Import size={15} />} label="Import data…" onClick={importDialog} />
            <SBtn icon={<FileOutput size={15} />} label="Export .pzfx" onClick={exportAllPzfx} />
            <SBtn icon={<Download size={15} />} label="Table as CSV" disabled={!activeTable} onClick={() => activeTableId && exportTable(activeTableId, 'csv')} />
          </div>
        </Group>
        <Group label="Edit">
          <div className="rbtn-col">
            <SBtn icon={<Undo2 size={15} />} label="Undo" disabled={!st.past.length} onClick={st.undo} />
            <SBtn icon={<Redo2 size={15} />} label="Redo" disabled={!st.future.length} onClick={st.redo} />
          </div>
        </Group>
        <Group label="Create">
          <RBtn icon={<Table2 size={I} />} label="Data table" onClick={() => st.setDialog({ kind: 'newTable' })} />
          <RBtn icon={<FlaskConical size={I} />} label="Analyze" disabled={!activeTableId} onClick={() => st.setDialog({ kind: 'analyze', tableId: activeTableId! })} />
          <RBtn icon={<BarChart3 size={I} />} label="Graph" disabled={!activeTableId} onClick={() => st.setDialog({ kind: 'newGraph', tableId: activeTableId! })} />
          <RBtn icon={<FileCode2 size={I} />} label="Script" onClick={() => st.addScript()} />
          <RBtn icon={<StickyNote size={I} />} label="Notes" onClick={() => st.addInfo()} />
        </Group>
        <Group label="Assistant">
          <RBtn icon={<Sparkles size={I} color="#d97757" />} label="Ask Claude" onClick={() => st.set({ rightPanel: 'claude' })} />
        </Group>
      </div>
    );

  if (tab === 'Analyze')
    return (
      <div className="ribbon">
        <Group label="Analysis">
          <RBtn icon={<FlaskConical size={I} />} label="Analyze…" disabled={!activeTableId} onClick={() => st.setDialog({ kind: 'analyze', tableId: activeTableId! })} />
        </Group>
        <Group label="Column">
          <div className="rbtn-col">
            <SBtn icon={<Sigma size={15} />} label="Descriptive stats" disabled={!activeTable} onClick={quick('descriptive')} />
            <SBtn icon={<Activity size={15} />} label="Normality tests" disabled={!activeTable} onClick={quick('normality')} />
            <SBtn icon={<Rows3 size={15} />} label="Frequency distribution" disabled={!activeTable} onClick={quick('freqDist')} />
          </div>
          <div className="rbtn-col">
            <SBtn icon={<Layers size={15} />} label="t test" disabled={!activeTable} onClick={quick('ttest')} />
            <SBtn icon={<Layers size={15} />} label="One-way ANOVA" disabled={!activeTable} onClick={quick('anova1')} />
            <SBtn icon={<Eraser size={15} />} label="Outliers (Grubbs)" disabled={!activeTable} onClick={quick('outliers')} />
          </div>
        </Group>
        <Group label="XY">
          <div className="rbtn-col">
            <SBtn icon={<Spline size={15} />} label="Nonlinear fit" disabled={activeTable?.kind !== 'xy'} onClick={quick('nonlin')} />
            <SBtn icon={<TrendingUp size={15} />} label="Linear regression" disabled={activeTable?.kind !== 'xy'} onClick={quick('linreg')} />
            <SBtn icon={<ScatterChart size={15} />} label="Correlation" disabled={!activeTable} onClick={quick('correlation')} />
          </div>
        </Group>
        <Group label="Grouped & other">
          <div className="rbtn-col">
            <SBtn icon={<Grid3x3 size={15} />} label="Two-way ANOVA" disabled={activeTable?.kind !== 'grouped'} onClick={quick('anova2')} />
            <SBtn icon={<LineChart size={15} />} label="Survival curves" disabled={activeTable?.kind !== 'survival'} onClick={quick('survival')} />
            <SBtn icon={<Percent size={15} />} label="Chi-square / Fisher" disabled={activeTable?.kind !== 'contingency'} onClick={quick('contingency')} />
          </div>
        </Group>
      </div>
    );

  if (tab === 'Graph') {
    const g = active?.type === 'graph' ? (active.item as Graph) : null;
    const gt = g ? tableFor(st.project, g.analysisId ? `derived:${g.analysisId}` : g.tableId) ?? tableFor(st.project, g.tableId) : undefined;
    const icons: Record<string, React.ReactNode> = { scatter: <ScatterChart size={I} />, bar: <BarChart3 size={I} />, box: <Layers size={I} />, violin: <Activity size={I} />, xy: <LineChart size={I} />, groupedBar: <BarChart3 size={I} />, stackedBar: <Rows3 size={I} />, survival: <TrendingUp size={I} />, pie: <PieChart size={I} />, donut: <PieChart size={I} />, heatmap: <Grid3x3 size={I} />, histogram: <BarChart3 size={I} /> };
    return (
      <div className="ribbon">
        <Group label="New">
          <RBtn icon={<BarChart3 size={I} />} label="New graph" disabled={!activeTableId} onClick={() => st.setDialog({ kind: 'newGraph', tableId: activeTableId! })} />
        </Group>
        <Group label="Change graph type">
          {g && gt ? (
            chartsFor(gt.kind).map((c) => (
              <RBtn key={c} icon={icons[c] ?? <BarChart3 size={I} />} label={CHART_LABELS[c]} disabled={g.chart === c} onClick={() => st.update((p) => {
                const x = p.graphs.find((y) => y.id === g.id);
                if (x) x.chart = c;
              })} />
            ))
          ) : (
            <div className="muted small" style={{ padding: 12 }}>Select a graph to change its type</div>
          )}
        </Group>
        <Group label="Export">
          <RBtn icon={<Download size={I} />} label="Export…" disabled={!(active?.type === 'graph' || active?.type === 'figure')} onClick={() => active && st.setDialog({ kind: 'export', itemId: active.item.id })} />
        </Group>
      </div>
    );
  }

  if (tab === 'Code')
    return (
      <div className="ribbon">
        <Group label="Script">
          <RBtn icon={<FileCode2 size={I} />} label="New script" onClick={() => st.addScript()} />
          <RBtn icon={<Play size={I} color="#1f9d55" />} label="Run" disabled={active?.type !== 'script' || st.engineBusy} onClick={() => active && runScript(active.item.id)} />
          <RBtn icon={<Square size={I} color="#d43c3c" />} label="Stop" disabled={!st.engineBusy} onClick={stopExecution} />
        </Group>
        <Group label="Workspace">
          <div className="rbtn-col">
            <SBtn icon={<Save size={15} />} label="Save workspace (.mat)" onClick={saveWorkspaceMat} />
            <SBtn icon={<Import size={15} />} label="Load .mat / .m" onClick={importDialog} />
            <SBtn icon={<Eraser size={15} />} label="Clear workspace" onClick={async () => {
              const r = await engine().clear();
              st.set({ workspace: r.workspace });
            }} />
          </div>
          <div className="rbtn-col">
            <SBtn icon={<Eraser size={15} />} label="Clear command window" onClick={() => st.set({ console: [] })} />
            <SBtn icon={<BarChart3 size={15} />} label="Close all figures" onClick={() => runCode('close all', { quiet: true })} />
          </div>
        </Group>
        <Group label="Examples">
          <div className="rbtn-col">
            <SBtn icon={<FileCode2 size={15} />} label="Signal processing demo" onClick={() => st.addScript('demo_signal.m', DEMO_SIGNAL)} />
            <SBtn icon={<FileCode2 size={15} />} label="ODE & surface demo" onClick={() => st.addScript('demo_ode.m', DEMO_ODE)} />
            <SBtn icon={<FileCode2 size={15} />} label="Tables ↔ code demo" onClick={() => st.addScript('demo_tables.m', DEMO_TABLES)} />
          </div>
        </Group>
      </div>
    );

  return (
    <div className="ribbon">
      <Group label="Panels">
        <RBtn icon={<Terminal size={I} />} label="Command window" onClick={() => st.set({ bottomOpen: !st.bottomOpen })} />
        <RBtn icon={<PanelRight size={I} />} label="Format panel" onClick={() => st.set({ rightPanel: st.rightPanel === 'format' ? null : 'format' })} />
        <RBtn icon={<Sparkles size={I} color="#d97757" />} label="Claude" onClick={() => st.set({ rightPanel: st.rightPanel === 'claude' ? null : 'claude' })} />
      </Group>
      <Group label="Appearance">
        <RBtn icon={st.settings.theme === 'dark' ? <Sun size={I} /> : <Moon size={I} />} label={st.settings.theme === 'dark' ? 'Light mode' : 'Dark mode'} onClick={() => st.set({ settings: { ...st.settings, theme: st.settings.theme === 'dark' ? 'light' : 'dark' } })} />
      </Group>
      <Group label="Application">
        <RBtn icon={<Settings size={I} />} label="Settings" onClick={() => st.setDialog({ kind: 'settings' })} />
        <RBtn icon={<HelpCircle size={I} />} label="About" onClick={() => st.setDialog({ kind: 'about' })} />
      </Group>
    </div>
  );
}

export const DEMO_SIGNAL = `% Signal processing demo: noisy signal, FFT spectrum and filtering
fs = 500;                       % sampling frequency (Hz)
t = 0:1/fs:1-1/fs;
x = sin(2*pi*12*t) + 0.5*sin(2*pi*40*t) + 0.4*randn(size(t));

% Spectrum
N = numel(x);
X = fft(x);
P = abs(X/N); P = P(1:N/2+1); P(2:end-1) = 2*P(2:end-1);
f = fs*(0:N/2)/N;

% Moving-average low-pass filter
b = ones(1, 15)/15;
y = filter(b, 1, x);

figure('Name', 'Signal analysis');
subplot(2,1,1);
plot(t, x, 'Color', [0.6 0.6 0.6]); hold on;
plot(t, y, 'LineWidth', 2);
title('Noisy signal and filtered output'); xlabel('Time (s)'); ylabel('Amplitude');
legend('raw', 'filtered'); grid on;
subplot(2,1,2);
plot(f, P, 'LineWidth', 1.5);
title('Single-sided amplitude spectrum'); xlabel('Frequency (Hz)'); ylabel('|P(f)|');
xlim([0 80]); grid on;
[pk, k] = max(P(2:end));
fprintf('Dominant frequency: %.1f Hz (amplitude %.2f)\\n', f(k+1), pk);
`;

export const DEMO_ODE = `% Damped oscillator with ode45, and a 3-D surface
f = @(t, y) [y(2); -0.4*y(2) - 4*y(1)];
[t, y] = ode45(f, [0 20], [1; 0]);
figure;
plot(t, y(:,1), 'LineWidth', 1.8); hold on;
plot(t, y(:,2), '--', 'LineWidth', 1.2);
xlabel('t'); ylabel('state'); title('Damped harmonic oscillator');
legend('position', 'velocity'); grid on;

figure;
[X, Y] = meshgrid(-3:0.15:3);
Z = peaksfn(X, Y);
surf(X, Y, Z); colorbar; title('peaks surface');
xlabel('x'); ylabel('y'); zlabel('z');

function Z = peaksfn(X, Y)
  Z = 3*(1-X).^2.*exp(-X.^2 - (Y+1).^2) - 10*(X/5 - X.^3 - Y.^5).*exp(-X.^2-Y.^2) - 1/3*exp(-(X+1).^2 - Y.^2);
end
`;

export const DEMO_TABLES = `% Moving data between the MATLAB workspace and Prism-style data tables
listtables
% Generate a dose-response experiment and push it to a new XY table
logdose = -9:0.5:-5;
resp = @(ec50) 100 ./ (1 + 10.^(ec50 - logdose));
Y = [resp(-7.2)' + 4*randn(9,1), resp(-7.2)' + 4*randn(9,1), resp(-6.5)' + 4*randn(9,1), resp(-6.5)' + 4*randn(9,1)];
puttable('Dose response (from code)', logdose', Y, 'Kind', 'xy', 'Replicates', 2, 'Names', {'Vehicle', 'Drug'}, 'XTitle', 'log[Agonist], M');
% Fit a 4-parameter logistic and make a graph, all from code
analyze('Dose response (from code)', 'nonlin', 'model', 'logAgonist4', 'Save', true);
prismgraph('Dose response (from code)', 'xy');
% Pull a table back into the workspace
T = gettable('Dose response (from code)');
disp(size(T.y))
`;
