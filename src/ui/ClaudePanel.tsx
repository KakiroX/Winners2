import { useEffect, useMemo, useRef, useState } from 'react';
import { Send, Square, Sparkles, Wrench, ChevronDown, ChevronRight, RotateCcw, KeyRound, AlertTriangle, Brain, Loader2 } from 'lucide-react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useChat, sendToClaude, stopClaude, resetChat, type ChatItem } from '../claude/agent';
import { useStore } from '../state/store';

marked.setOptions({ gfm: true, breaks: false });

function Markdown({ text }: { text: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false }) as string), [text]);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}

const TOOL_LABELS: Record<string, string> = {
  get_project_overview: 'Looked at the project',
  get_table: 'Read a data table',
  create_table: 'Created a data table',
  update_table: 'Edited a data table',
  list_analysis_types: 'Checked available analyses',
  run_analysis: 'Ran an analysis',
  get_analysis_results: 'Read analysis results',
  update_analysis: 'Changed an analysis',
  create_graph: 'Created a graph',
  update_graph: 'Formatted a graph',
  view_graph: 'Viewed a graph',
  run_matlab: 'Ran MATLAB code',
  write_script: 'Wrote a script',
  read_script: 'Read a script',
  open_sheet: 'Opened a sheet',
  rename_or_delete_sheet: 'Renamed/deleted a sheet',
  write_notes: 'Wrote notes',
};

function ToolItem({ item }: { item: Extract<ChatItem, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const detail = item.name === 'run_matlab' ? item.input?.code : JSON.stringify(item.input, null, 1);
  return (
    <div>
      <div className={`tool-chip ${item.isError ? 'err' : ''}`} onClick={() => setOpen(!open)}>
        {item.running ? <Loader2 size={13} className="spin" /> : <Wrench size={13} />}
        <span className="grow">{TOOL_LABELS[item.name] ?? item.name}{item.input?.name ? `: ${item.input.name}` : item.input?.kind && item.name === 'run_analysis' ? `: ${item.input.kind}` : ''}</span>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </div>
      {open && (
        <>
          {detail && detail !== '{}' && <div className="tool-detail">{detail}</div>}
          {item.result && <div className="tool-detail">{item.result.length > 4000 ? item.result.slice(0, 4000) + '…' : item.result}</div>}
        </>
      )}
      {item.image && <img src={`data:image/png;base64,${item.image}`} style={{ maxWidth: '100%', marginTop: 6, borderRadius: 6, border: '1px solid var(--border)' }} />}
    </div>
  );
}

function Thinking({ text, live }: { text: string; live?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="thinking" style={{ cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        <Brain size={13} /> {live ? 'Thinking…' : 'Thought process'} {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </div>
      {open && text && <div className="tool-detail" style={{ fontFamily: 'var(--font)' }}>{text}</div>}
    </div>
  );
}

const SUGGESTIONS = [
  'Create a column table with example data for a control and two treatment groups, run a one-way ANOVA with Tukey tests, and make a scatter dot plot with significance stars.',
  'Fit a 4-parameter dose-response curve to my XY table and report the EC50s with 95% CIs.',
  'Write MATLAB code that simulates a damped oscillator with ode45 and plots position and velocity.',
  'Which statistical test should I use for my current table, and why?',
];

export function ClaudePanel() {
  const chat = useChat();
  const apiKeySet = useStore((s) => s.apiKeySet);
  const setDialog = useStore((s) => s.setDialog);
  const model = useStore((s) => s.settings.model);
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.items, chat.liveText, chat.liveThinking]);
  useEffect(() => {
    const h = (e: Event) => {
      const q = (e as CustomEvent).detail as string;
      if (q) sendToClaude(q);
    };
    window.addEventListener('quanta:ask', h);
    return () => window.removeEventListener('quanta:ask', h);
  }, []);
  const send = () => {
    if (!text.trim() || chat.running) return;
    sendToClaude(text);
    setText('');
  };
  return (
    <div className="chat">
      <div className="toolbar" style={{ minHeight: 38 }}>
        <span className="claude-badge"><Sparkles size={13} /></span>
        <b>Claude</b>
        <span className="small muted">{model.replace('claude-', '').replace(/-/g, ' ')}</span>
        <span className="grow" />
        {chat.usage.output > 0 && <span className="small muted" title="Tokens used in this conversation">{Math.round((chat.usage.input + chat.usage.output) / 1000)}k tok</span>}
        <button className="iconbtn" title="New conversation" onClick={resetChat} disabled={chat.running}><RotateCcw size={15} /></button>
      </div>
      <div className="chat-scroll" ref={scrollRef}>
        {!chat.items.length && (
          <div className="chat-empty">
            <p style={{ marginTop: 0 }}><b>Ask Claude to work in your project.</b> It can create and edit data tables, choose and run analyses, build and polish graphs, and write and run MATLAB code. It can also see your graphs and interpret results.</p>
            {!apiKeySet && (
              <div className="warn-box"><KeyRound size={14} style={{ verticalAlign: -2 }} /> Add your Anthropic API key to start. <button className="btn small" style={{ marginLeft: 6 }} onClick={() => setDialog({ kind: 'settings' })}>Open settings</button></div>
            )}
            <div className="suggest">
              {SUGGESTIONS.map((s) => <button key={s} onClick={() => sendToClaude(s)} disabled={!apiKeySet}>{s}</button>)}
            </div>
          </div>
        )}
        {chat.items.map((it, i) => {
          if (it.kind === 'user') return <div key={i} className="msg user">{it.text}</div>;
          if (it.kind === 'assistant')
            return (
              <div key={i} className="msg assistant">
                {it.thinking && <Thinking text={it.thinking} />}
                {it.text && <Markdown text={it.text} />}
              </div>
            );
          if (it.kind === 'tool') return <ToolItem key={i} item={it} />;
          return <div key={i} className={it.error ? 'warn-box' : 'muted small'}>{it.error && <AlertTriangle size={13} style={{ verticalAlign: -2, marginRight: 4 }} />}{it.text}</div>;
        })}
        {chat.running && (
          <div className="msg assistant">
            {(chat.liveThinking || (!chat.liveText && !chat.liveTool)) && <Thinking text={chat.liveThinking} live />}
            {chat.liveText && <Markdown text={chat.liveText} />}
            {chat.liveTool && <div className="thinking"><Loader2 size={13} /> Preparing {TOOL_LABELS[chat.liveTool]?.toLowerCase() ?? chat.liveTool}…</div>}
          </div>
        )}
      </div>
      <div className="chat-input">
        <textarea
          value={text}
          placeholder={apiKeySet ? 'Ask Claude… (Enter to send, Shift+Enter for a new line)' : 'Add an API key in Settings to chat with Claude'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="row" style={{ marginTop: 6 }}>
          <span className="small muted grow">Claude can make mistakes; check important results.</span>
          {chat.running ? (
            <button className="btn small danger" onClick={stopClaude}><Square size={13} /> Stop</button>
          ) : (
            <button className="btn small primary" onClick={send} disabled={!text.trim()}><Send size={13} /> Send</button>
          )}
        </div>
      </div>
    </div>
  );
}
