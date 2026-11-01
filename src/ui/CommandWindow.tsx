import { useEffect, useRef, useState } from 'react';
import { Terminal, Trash2, Square, Database, X } from 'lucide-react';
import { useStore } from '../state/store';
import { runCode, stopExecution } from '../state/actions';
import { engine } from '../lang/client';

export function CommandWindow() {
  const st = useStore();
  const [cmd, setCmd] = useState('');
  const [hIdx, setHIdx] = useState(-1);
  const outRef = useRef<HTMLDivElement>(null);
  const inRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = outRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [st.console]);

  const submit = async () => {
    const code = cmd;
    if (!code.trim()) return;
    st.set({ history: [...st.history.filter((h) => h !== code), code].slice(-200) });
    setCmd('');
    setHIdx(-1);
    await runCode(code, { echo: true });
  };

  const complete = async () => {
    const m = cmd.match(/([A-Za-z_]\w*)$/);
    if (!m) return;
    const names = await engine().names();
    const matches = [...new Set(names.filter((n) => n.startsWith(m[1])))].sort();
    if (matches.length === 1) setCmd(cmd.slice(0, cmd.length - m[1].length) + matches[0]);
    else if (matches.length > 1) {
      let pre = matches[0];
      for (const x of matches) while (!x.startsWith(pre)) pre = pre.slice(0, -1);
      if (pre.length > m[1].length) setCmd(cmd.slice(0, cmd.length - m[1].length) + pre);
      else st.log('info', matches.slice(0, 60).join('  '));
    }
  };

  return (
    <div className="bottom" style={{ height: st.bottomHeight }}>
      <div className="cmd">
        <div className="cmd-head">
          <Terminal size={14} /> Command Window
          <span className="grow" />
          {st.engineBusy && <button className="btn small danger" onClick={stopExecution}><Square size={12} /> Stop</button>}
          <button className="iconbtn" title="Clear (clc)" onClick={() => st.set({ console: [] })}><Trash2 size={14} /></button>
          <button className="iconbtn" title="Hide" onClick={() => st.set({ bottomOpen: false })}><X size={14} /></button>
        </div>
        <div className="cmd-out" ref={outRef} onClick={() => window.getSelection()?.toString() || inRef.current?.focus()}>
          {st.console.map((e) => (
            <div key={e.id} className={e.kind === 'input' ? 'in' : e.kind === 'error' ? 'err' : e.kind === 'info' ? 'info' : ''}>
              {e.kind === 'input' ? e.text.split('\n').map((l, i) => <div key={i}>{i === 0 ? '>> ' : '   '}{l}</div>) : e.kind === 'output' ? colorize(e.text) : e.text}
            </div>
          ))}
        </div>
        <div className="cmd-line">
          <span className="prompt">{st.engineBusy ? '…' : '>>'}</span>
          <input
            ref={inRef}
            value={cmd}
            spellCheck={false}
            placeholder={st.engineBusy ? 'Running…' : 'Enter a command, e.g. A = magic(4); eig(A)'}
            onChange={(e) => setCmd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                const h = st.history;
                const matches = h.map((x, i) => [x, i] as const).filter(([x]) => x.startsWith(hIdx === -1 ? cmd : ''));
                const ni = hIdx === -1 ? h.length - 1 : Math.max(0, hIdx - 1);
                if (h.length) {
                  setHIdx(ni);
                  setCmd(h[ni]);
                }
                void matches;
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                const h = st.history;
                if (hIdx >= 0 && hIdx < h.length - 1) {
                  setHIdx(hIdx + 1);
                  setCmd(h[hIdx + 1]);
                } else {
                  setHIdx(-1);
                  setCmd('');
                }
              } else if (e.key === 'Tab') {
                e.preventDefault();
                complete();
              } else if (e.key === 'c' && e.ctrlKey && st.engineBusy) {
                stopExecution();
              }
            }}
          />
        </div>
      </div>
      <Workspace />
    </div>
  );
}

function colorize(text: string) {
  // Highlight MATLAB error blocks in red
  const parts = text.split(/(\n?(?:Error(?: using \w+)?\n[^\n]*|Error: [^\n]*|Error in [^\n]*|Warning: [^\n]*))/);
  return parts.map((p, i) => (/^\n?(Error|Warning)/.test(p) ? <span key={i} className={p.includes('Warning') ? '' : 'err'} style={p.includes('Warning') ? { color: 'var(--warn)' } : undefined}>{p}</span> : <span key={i}>{p}</span>));
}

function Workspace() {
  const st = useStore();
  return (
    <div className="ws">
      <div className="ws-head"><Database size={14} /> Workspace <span className="grow" /><span className="small muted">{st.workspace.length} vars</span></div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        <table className="ws-table">
          <thead>
            <tr><th>Name</th><th>Value</th><th>Size</th><th>Class</th></tr>
          </thead>
          <tbody>
            {st.workspace.map((v) => (
              <tr key={v.name} onDoubleClick={() => st.setDialog({ kind: 'variable', name: v.name })} title="Double-click to view / send to a data table">
                <td className="vname">{v.name}</td>
                <td title={v.preview}>{v.preview}</td>
                <td>{v.size}</td>
                <td className="muted">{v.cls}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!st.workspace.length && <div className="chat-empty small">Variables you create appear here. Double-click one to inspect it or turn it into a data table.</div>}
      </div>
    </div>
  );
}
