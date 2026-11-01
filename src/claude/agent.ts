// In-app Claude agent: manual streaming tool-use loop over the Quanta Studio tools.
import type Anthropic from '@anthropic-ai/sdk';
import { create } from 'zustand';
import { platform } from '../platform';
import { useStore, findItem } from '../state/store';
import { executeTool, toolJsonSchemas } from './tools';
import type { StreamEvent, StreamOutcome } from './stream';

export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (recommended)' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1 (most capable)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest)' },
];

const SYSTEM_PROMPT = `You are the research assistant built into Quanta Studio, a desktop application that combines Prism-style biostatistics and publication graphing with a MATLAB-compatible numerical computing environment. You work directly inside the user's open project through tools.

What the app contains:
- Data tables of seven kinds: XY, Column, Grouped, Contingency, Survival, Parts of whole, Multiple variables. XY and Grouped tables can hold replicates or mean/SD/N summary data.
- Analysis sheets that stay linked to their table and recalculate automatically (descriptive statistics, normality tests, t tests, one-/two-way ANOVA with Tukey/Šídák/Dunnett/Holm-Šídák comparisons, Kruskal-Wallis, Friedman, nonlinear curve fitting with a library of dose-response, binding, kinetics and exponential models, linear regression, correlation, survival (Kaplan-Meier, log-rank, hazard ratios), chi-square/Fisher, ROC, Bland-Altman, PCA, multiple regression, transforms, normalization, frequency distributions).
- Publication-quality graphs (scatter dot plots, bars, box and violin plots, XY with fitted curves, grouped/stacked bars, survival curves, pie, heat maps) with asterisk significance brackets.
- A MATLAB-language engine with scripts, a command window, a shared workspace and figures. gettable/puttable/analyze/prismgraph connect code with the data tables.

How to work:
- Use the tools to act rather than describing what the user could click. Call get_project_overview when you need ids or don't know what exists.
- Choose statistically appropriate methods and say briefly why (paired vs unpaired, parametric vs nonparametric, correction for multiple comparisons). Flag violated assumptions, small samples and over-interpretation.
- After creating or changing a graph, call view_graph and fix problems you see (overlapping labels, wrong axis titles, missing error bars) before reporting back.
- Report results the way a careful scientist would: test name, statistic with degrees of freedom, exact P value (or P<0.0001), effect size or confidence interval where available.
- When writing MATLAB code, keep it idiomatic and runnable in this engine. Prefer run_matlab for computations and write_script when the user wants code they can keep.
- Never invent data. If the user's request needs data that isn't in the project, ask for it or offer clearly labeled example data.
- Keep replies concise and skimmable; use short paragraphs or bullet points and markdown tables for numbers.`;

export type ChatItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; thinking?: string }
  | { kind: 'tool'; name: string; input: any; result?: string; isError?: boolean; image?: string; running?: boolean }
  | { kind: 'notice'; text: string; error?: boolean };

interface ChatState {
  items: ChatItem[];
  messages: Anthropic.Beta.BetaMessageParam[];
  running: boolean;
  liveText: string;
  liveThinking: string;
  liveTool: string | null;
  requestId: string | null;
  usage: { input: number; output: number; cacheRead: number };
}

export const useChat = create<ChatState>(() => ({ items: [], messages: [], running: false, liveText: '', liveThinking: '', liveTool: null, requestId: null, usage: { input: 0, output: 0, cacheRead: 0 } }));

let stopRequested = false;

function contextNote(): string {
  const st = useStore.getState();
  const a = st.activeId ? findItem(st.project, st.activeId) : null;
  const parts = [`[App context] Project "${st.project.name}": ${st.project.tables.length} tables, ${st.project.analyses.length} analyses, ${st.project.graphs.length} graphs, ${st.project.scripts.length} scripts, ${st.project.figures.length} figures.`];
  if (a) parts.push(`The user is viewing the ${a.type} "${(a.item as any).name}" (id ${a.item.id}).`);
  return parts.join(' ');
}

function buildParams(messages: Anthropic.Beta.BetaMessageParam[]) {
  const s = useStore.getState().settings;
  const model = s.model;
  const params: any = {
    model,
    max_tokens: 64000,
    system: [{ type: 'text', text: SYSTEM_PROMPT }],
    tools: toolJsonSchemas(true),
    messages,
    cache_control: { type: 'ephemeral' },
    thinking: { type: 'adaptive', display: 'summarized' },
    output_config: { effort: s.effort },
  };
  if (model !== 'claude-haiku-5-5') {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  return params;
}

let browserClient: any = null;

async function callClaude(params: any, onEvent: (e: StreamEvent) => void): Promise<StreamOutcome> {
  const requestId = `r${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  useChat.setState({ requestId });
  if (platform.bridge) {
    const off = platform.bridge.onClaudeEvent((e) => {
      if (e.requestId !== requestId) return;
      if (e.kind === 'text' || e.kind === 'thinking' || e.kind === 'tool_input') onEvent({ kind: e.kind, text: e.text ?? '' } as StreamEvent);
      else if (e.kind === 'tool_start') onEvent({ kind: 'tool_start', name: e.name ?? '' });
    });
    try {
      return await platform.bridge.claudeStream(requestId, params);
    } finally {
      off();
    }
  }
  // Browser build: call the API directly with the user's key
  const settings = await platform.getSettings();
  const key = settings.webApiKey;
  if (!key) return { error: { type: 'authentication_error', message: 'Add your Anthropic API key in Settings.', retryable: false } };
  const [{ default: Anthropic }, { streamClaude }] = await Promise.all([import('@anthropic-ai/sdk'), import('./stream')]);
  if (!browserClient || browserClient.apiKey !== key) browserClient = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
  return streamClaude(browserClient, params, onEvent, (abort) => (abortBrowser = abort));
}

let abortBrowser: (() => void) | null = null;

export function stopClaude() {
  stopRequested = true;
  const id = useChat.getState().requestId;
  if (platform.bridge && id) platform.bridge.claudeAbort(id);
  abortBrowser?.();
}

export function resetChat() {
  useChat.setState({ items: [], messages: [], liveText: '', liveThinking: '', liveTool: null, usage: { input: 0, output: 0, cacheRead: 0 } });
}

function pushItem(item: ChatItem) {
  useChat.setState((s) => ({ items: [...s.items, item] }));
}

function updateLastTool(patch: Partial<Extract<ChatItem, { kind: 'tool' }>>) {
  useChat.setState((s) => {
    const items = [...s.items];
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].kind === 'tool' && (items[i] as any).running) {
        items[i] = { ...(items[i] as any), ...patch };
        break;
      }
    }
    return { items };
  });
}

export async function sendToClaude(text: string) {
  const chat = useChat.getState();
  if (chat.running || !text.trim()) return;
  stopRequested = false;
  pushItem({ kind: 'user', text });
  const messages: Anthropic.Beta.BetaMessageParam[] = [...chat.messages, { role: 'user', content: [{ type: 'text', text }, { type: 'text', text: contextNote() }] }];
  useChat.setState({ messages, running: true, liveText: '', liveThinking: '' });
  let jsonRetries = 0;
  try {
    for (let turn = 0; turn < 40 && !stopRequested; turn++) {
      useChat.setState({ liveText: '', liveThinking: '', liveTool: null });
      const outcome = await callClaude(buildParams(useChat.getState().messages), (e) => {
        if (e.kind === 'text') useChat.setState((s) => ({ liveText: s.liveText + e.text }));
        else if (e.kind === 'thinking') useChat.setState((s) => ({ liveThinking: s.liveThinking + e.text }));
        else if (e.kind === 'tool_start') useChat.setState({ liveTool: e.name });
      });
      if (outcome.error) {
        if (outcome.error.type === 'aborted') break;
        if (outcome.error.jsonError && jsonRetries++ < 2) continue;
        const hint = outcome.error.type === 'authentication_error' ? ' Open Settings to add a valid Anthropic API key.' : outcome.error.type === 'rate_limit_error' ? ' You are being rate limited; wait a moment and try again.' : '';
        pushItem({ kind: 'notice', text: `${outcome.error.message}${hint}`, error: true });
        break;
      }
      jsonRetries = 0;
      const msg = outcome.message!;
      const u: any = msg.usage ?? {};
      useChat.setState((s) => ({ usage: { input: s.usage.input + (u.input_tokens ?? 0), output: s.usage.output + (u.output_tokens ?? 0), cacheRead: s.usage.cacheRead + (u.cache_read_input_tokens ?? 0) } }));
      // Keep the full content (including thinking blocks) unchanged in the history.
      useChat.setState((s) => ({ messages: [...s.messages, { role: 'assistant', content: msg.content as any }] }));
      const textOut = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
      const thinking = msg.content.filter((b: any) => b.type === 'thinking').map((b: any) => b.thinking).join('\n');
      if (textOut.trim() || thinking.trim()) pushItem({ kind: 'assistant', text: textOut, thinking: thinking || undefined });
      useChat.setState({ liveText: '', liveThinking: '', liveTool: null });
      if (msg.stop_reason === 'refusal') {
        pushItem({ kind: 'notice', text: 'Claude declined to continue with this request.', error: true });
        break;
      }
      if (msg.stop_reason === 'pause_turn') continue;
      const toolUses = msg.content.filter((b: any) => b.type === 'tool_use') as any[];
      if (!toolUses.length) break;
      if (msg.stop_reason === 'max_tokens') {
        pushItem({ kind: 'notice', text: 'The response was cut off before a tool call finished. Try asking for a smaller step.', error: true });
        // Answer the incomplete tool calls so the conversation stays valid
        useChat.setState((s) => ({ messages: [...s.messages, { role: 'user', content: toolUses.map((t) => ({ type: 'tool_result', tool_use_id: t.id, is_error: true, content: 'Tool input was truncated (max_tokens); not executed.' })) }] }));
        break;
      }
      const results: any[] = [];
      for (const tu of toolUses) {
        pushItem({ kind: 'tool', name: tu.name, input: tu.input, running: true });
        if (stopRequested) {
          results.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: 'Stopped by the user.' });
          updateLastTool({ running: false, result: 'Stopped', isError: true });
          continue;
        }
        const r = await executeTool(tu.name, tu.input);
        const content = r.content;
        const textResult = typeof content === 'string' ? content : content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
        const img = typeof content === 'string' ? undefined : (content.find((c: any) => c.type === 'image') as any)?.source?.data;
        updateLastTool({ running: false, result: textResult, isError: r.isError, image: img });
        results.push({ type: 'tool_result', tool_use_id: tu.id, content, ...(r.isError ? { is_error: true } : {}) });
      }
      useChat.setState((s) => ({ messages: [...s.messages, { role: 'user', content: results }] }));
      if (stopRequested) break;
    }
  } catch (e: any) {
    pushItem({ kind: 'notice', text: `Error: ${e?.message ?? e}`, error: true });
  } finally {
    useChat.setState({ running: false, liveText: '', liveThinking: '', liveTool: null, requestId: null });
  }
}
