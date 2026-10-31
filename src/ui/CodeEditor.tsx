import { useEffect, useRef } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleComment } from '@codemirror/commands';
import { StreamLanguage, syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentOnInput, HighlightStyle } from '@codemirror/language';
import { octave } from '@codemirror/legacy-modes/mode/octave';
import { autocompletion, closeBrackets, completeFromList } from '@codemirror/autocomplete';
import { searchKeymap } from '@codemirror/search';
import { tags } from '@lezer/highlight';

const BUILTINS = ['plot', 'figure', 'subplot', 'hold', 'xlabel', 'ylabel', 'title', 'legend', 'grid', 'axis', 'xlim', 'ylim', 'scatter', 'bar', 'histogram', 'errorbar', 'surf', 'mesh', 'contour', 'imagesc', 'colorbar', 'colormap',
  'zeros', 'ones', 'eye', 'rand', 'randn', 'randi', 'linspace', 'logspace', 'size', 'numel', 'length', 'reshape', 'repmat', 'sum', 'prod', 'cumsum', 'mean', 'median', 'std', 'var', 'min', 'max', 'sort', 'unique', 'find', 'abs', 'sqrt', 'exp', 'log', 'log10',
  'sin', 'cos', 'tan', 'round', 'floor', 'ceil', 'mod', 'inv', 'det', 'eig', 'svd', 'qr', 'lu', 'chol', 'pinv', 'rank', 'norm', 'trace', 'kron', 'polyfit', 'polyval', 'roots', 'interp1', 'spline', 'trapz', 'integral', 'fzero', 'fminsearch', 'fminbnd', 'fsolve',
  'lsqcurvefit', 'ode45', 'ode23', 'fft', 'ifft', 'filter', 'conv', 'disp', 'fprintf', 'sprintf', 'num2str', 'str2num', 'strcat', 'strsplit', 'strjoin', 'strrep', 'regexp', 'cellfun', 'arrayfun', 'struct', 'cell', 'fieldnames', 'isfield', 'isempty',
  'ttest', 'ttest2', 'anova1', 'ranksum', 'signrank', 'normpdf', 'normcdf', 'norminv', 'tcdf', 'tinv', 'corr', 'corrcoef', 'regress', 'fitlm', 'gettable', 'puttable', 'listtables', 'analyze', 'prismgraph', 'load', 'save', 'readmatrix', 'writematrix'];

const hl = HighlightStyle.define([
  { tag: tags.keyword, color: '#0b52d6', fontWeight: '600' },
  { tag: tags.comment, color: '#228b22', fontStyle: 'italic' },
  { tag: tags.string, color: '#a020f0' },
  { tag: tags.number, color: '#b35c00' },
  { tag: tags.variableName, color: 'inherit' },
  { tag: tags.operator, color: '#666' },
]);

const hlDark = HighlightStyle.define([
  { tag: tags.keyword, color: '#7aa7ff', fontWeight: '600' },
  { tag: tags.comment, color: '#6fbf73', fontStyle: 'italic' },
  { tag: tags.string, color: '#d39bff' },
  { tag: tags.number, color: '#ffb470' },
  { tag: tags.operator, color: '#aab' },
]);

export function CodeEditor({ value, onChange, onRun, onRunSelection, selectionRef, dark }: { value: string; onChange: (v: string) => void; onRun: () => void; onRunSelection: (s: string) => void; selectionRef: React.MutableRefObject<() => string>; dark: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cbs = useRef({ onChange, onRun, onRunSelection });
  cbs.current = { onChange, onRun, onRunSelection };
  const theme = useRef(new Compartment());

  useEffect(() => {
    const getSel = () => {
      const v = view.current;
      if (!v) return '';
      const { from, to } = v.state.selection.main;
      if (from === to) {
        const line = v.state.doc.lineAt(from);
        return line.text;
      }
      return v.state.sliceDoc(from, to);
    };
    selectionRef.current = getSel;
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        history(),
        bracketMatching(),
        closeBrackets(),
        indentOnInput(),
        StreamLanguage.define(octave),
        theme.current.of(syntaxHighlighting(dark ? hlDark : hl)),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        autocompletion({ override: [completeFromList(BUILTINS.map((b) => ({ label: b, type: 'function' })))] }),
        keymap.of([
          { key: 'F5', run: () => (cbs.current.onRun(), true) },
          { key: 'Mod-Enter', run: () => (cbs.current.onRun(), true) },
          { key: 'F9', run: () => (cbs.current.onRunSelection(getSel()), true) },
          { key: 'Shift-Enter', run: () => (cbs.current.onRunSelection(getSel()), true) },
          { key: 'Mod-r', run: (v) => toggleComment(v) },
          { key: 'Mod-/', run: (v) => toggleComment(v) },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) cbs.current.onChange(u.state.doc.toString());
        }),
        EditorView.theme({ '&': { backgroundColor: 'var(--code-bg)', color: 'var(--text)' }, '.cm-content': { caretColor: 'var(--accent)' } }),
      ],
    });
    view.current = new EditorView({ state, parent: host.current! });
    return () => view.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: theme.current.reconfigure(syntaxHighlighting(dark ? hlDark : hl)) });
  }, [dark]);

  // external value changes (e.g. Claude edited the script)
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  return <div ref={host} style={{ flex: 1, minHeight: 0, display: 'flex' }} />;
}
