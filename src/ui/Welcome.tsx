import { Table2, FolderOpen, FileCode2, Sparkles, Import, LineChart, BarChart3, Activity, Grid3x3, PieChart, Rows3, Percent } from 'lucide-react';
import { useStore } from '../state/store';
import { importDialog, openProjectDialog, runCode } from '../state/actions';
import type { ChartType, TableKind, AnalysisKind } from '../model/types';
import { DEMO_ODE, DEMO_SIGNAL } from './Ribbon';
import { significanceAnnotations } from '../graph/compile';
import { runAnalysis } from '../analysis/registry';

const SAMPLES: { kind: TableKind; title: string; desc: string; icon: React.ReactNode; chart: ChartType; analysis?: AnalysisKind }[] = [
  { kind: 'column', title: 'Compare groups', desc: 'One-way ANOVA with Tukey comparisons and a scatter dot plot with significance stars.', icon: <BarChart3 size={17} />, chart: 'scatter', analysis: 'anova1' },
  { kind: 'xy', title: 'Dose-response curve', desc: 'Fit log(agonist) vs. response (4PL) and get EC50 values with confidence intervals.', icon: <LineChart size={17} />, chart: 'xy', analysis: 'nonlin' },
  { kind: 'grouped', title: 'Two-way ANOVA', desc: 'Genotype × time grouped bar chart with two-way ANOVA and multiple comparisons.', icon: <Rows3 size={17} />, chart: 'groupedBar', analysis: 'anova2' },
  { kind: 'survival', title: 'Survival analysis', desc: 'Kaplan-Meier curves, median survival, log-rank test and hazard ratio.', icon: <Activity size={17} />, chart: 'survival', analysis: 'survival' },
  { kind: 'contingency', title: 'Contingency table', desc: "Fisher's exact test, relative risk and odds ratio for a 2×2 table.", icon: <Percent size={17} />, chart: 'groupedBar', analysis: 'contingency' },
  { kind: 'multi', title: 'Correlation & PCA', desc: 'Multiple variables: correlation matrix, multiple regression and principal components.', icon: <Grid3x3 size={17} />, chart: 'xy', analysis: 'corrMatrix' },
  { kind: 'parts', title: 'Parts of whole', desc: 'Fractions of a total shown as a pie or donut chart.', icon: <PieChart size={17} />, chart: 'donut', analysis: 'fraction' },
];

export function Welcome() {
  const st = useStore();
  const openSample = (s: (typeof SAMPLES)[number]) => {
    const tid = st.addTable(s.kind, { sample: true, name: s.title, open: false });
    if (s.analysis) st.addAnalysis(tid, s.analysis, undefined, undefined, false);
    const gid = st.addGraph(tid, s.chart, { name: s.title });
    if (s.analysis === 'anova1') {
      // add significance brackets from the ANOVA
      const p = useStore.getState().project;
      const a = p.analyses.find((x) => x.tableId === tid)!;
      const t = p.tables.find((x) => x.id === tid)!;
      const g = p.graphs.find((x) => x.id === gid)!;
      const anns = significanceAnnotations(runAnalysis(t, a).comparisons ?? [], t, g);
      useStore.getState().update((d) => void (d.graphs.find((x) => x.id === gid)!.annotations = anns));
    }
  };
  return (
    <div className="welcome">
      <h1>Welcome to Quanta Studio</h1>
      <div className="lead">
        Organize data in Prism-style tables, run linked statistical analyses, make publication-ready graphs, and compute with a MATLAB-compatible language — with Claude built in to help with every step.
      </div>
      <h2>Start</h2>
      <div className="wcards">
        <button className="wcard" onClick={() => st.setDialog({ kind: 'newTable' })}><span className="t"><span className="ic"><Table2 size={17} /></span>New data table</span><span className="d">XY, column, grouped, contingency, survival, parts of whole or multiple variables.</span></button>
        <button className="wcard" onClick={openProjectDialog}><span className="t"><span className="ic"><FolderOpen size={17} /></span>Open project</span><span className="d">Open a .quanta project, Prism XML (.pzfx), CSV, MATLAB .m or .mat file.</span></button>
        <button className="wcard" onClick={importDialog}><span className="t"><span className="ic"><Import size={17} /></span>Import data</span><span className="d">Bring in data tables from Prism (.pzfx), Excel/CSV exports, or MATLAB .mat files.</span></button>
        <button className="wcard" onClick={() => {
          st.addScript('analysis.m', '% Write MATLAB code here and press Run (F5)\nx = linspace(0, 4*pi, 400);\ny = sin(x) .* exp(-x/6);\nplot(x, y, \'LineWidth\', 2); grid on\ntitle(\'Damped sine\'); xlabel(\'x\'); ylabel(\'y\')\n');
        }}><span className="t"><span className="ic"><FileCode2 size={17} /></span>New script</span><span className="d">Matrices, linear algebra, ODEs, optimization, signal processing and plotting.</span></button>
        <button className="wcard" onClick={() => st.set({ rightPanel: 'claude' })}><span className="t"><span className="ic" style={{ background: '#fbe9e2', color: '#c4623f' }}><Sparkles size={17} /></span>Ask Claude</span><span className="d">Describe your experiment and let Claude set up tables, analyses and graphs.</span></button>
      </div>
      <h2>Start with sample data</h2>
      <div className="wcards">
        {SAMPLES.map((s) => (
          <button key={s.title} className="wcard" onClick={() => openSample(s)}>
            <span className="t"><span className="ic">{s.icon}</span>{s.title}</span>
            <span className="d">{s.desc}</span>
          </button>
        ))}
      </div>
      <h2>Code examples</h2>
      <div className="wcards">
        <button className="wcard" onClick={() => {
          st.addScript('demo_signal.m', DEMO_SIGNAL);
          runCode(DEMO_SIGNAL, { unitName: 'demo_signal' });
        }}><span className="t"><span className="ic"><Activity size={17} /></span>Signal processing</span><span className="d">FFT spectrum and filtering of a noisy signal.</span></button>
        <button className="wcard" onClick={() => {
          st.addScript('demo_ode.m', DEMO_ODE);
          runCode(DEMO_ODE, { unitName: 'demo_ode' });
        }}><span className="t"><span className="ic"><LineChart size={17} /></span>ODEs & surfaces</span><span className="d">ode45 simulation and a 3-D surface plot with a local function.</span></button>
      </div>
    </div>
  );
}
