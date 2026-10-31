// Lexer for a MATLAB-compatible language. Handles the context-sensitive parts of the grammar:
// transpose vs. string quotes, whitespace/newline separators inside [] and {}, comments,
// line continuation, and command syntax (e.g. `hold on`, `format long`).

export type TokType = 'num' | 'str' | 'dstr' | 'id' | 'kw' | 'op' | 'nl' | 'semi' | 'comma' | 'cmd' | 'eof';

export interface Token {
  t: TokType;
  v: string;
  num?: number;
  imag?: boolean;
  line: number;
  col: number;
  /** whitespace immediately precedes this token */
  sp: boolean;
  args?: string[];
}

export const KEYWORDS = new Set([
  'if', 'elseif', 'else', 'end', 'for', 'parfor', 'while', 'switch', 'case', 'otherwise', 'function', 'return', 'break', 'continue',
  'try', 'catch', 'global', 'persistent', 'endif', 'endfor', 'endwhile', 'endfunction', 'endswitch', 'end_try_catch', 'do', 'until',
]);

export const COMMAND_WORDS = new Set([
  'hold', 'grid', 'axis', 'format', 'close', 'clear', 'clc', 'clf', 'figure', 'more', 'warning', 'box', 'help', 'doc', 'load', 'save',
  'cd', 'ls', 'dir', 'pwd', 'which', 'type', 'edit', 'colormap', 'shading', 'legend', 'drawnow', 'rng', 'pkg', 'echo', 'diary', 'beep',
  'print', 'whos', 'who', 'clearvars', 'cla', 'colorbar', 'mkdir', 'what', 'lookfor', 'syms', 'rotate3d', 'zoom', 'pan', 'datacursormode',
]);

export class LexError extends Error {
  constructor(msg: string, public line: number, public col: number) {
    super(msg);
  }
}

const OPS3 = ['...', '.^\'', '!==', '==='];
const OPS2 = ['==', '~=', '!=', '<=', '>=', '&&', '||', '.*', './', '.\\', '.^', ".'", '++', '--', '+=', '-=', '*=', '/='];
const OPS1 = ['+', '-', '*', '/', '\\', '^', '<', '>', '=', '&', '|', '~', '!', '(', ')', '[', ']', '{', '}', ':', '.', '@', "'", '?'];

function isIdStart(c: string) {
  return /[A-Za-z_]/.test(c);
}
function isIdChar(c: string) {
  return /[A-Za-z0-9_]/.test(c);
}
function isDigit(c: string) {
  return c >= '0' && c <= '9';
}

export function tokenize(src: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const brackets: string[] = []; // '[', '{', '('
  let sp = false;
  const n = src.length;

  const inMatrix = () => brackets.length > 0 && (brackets[brackets.length - 1] === '[' || brackets[brackets.length - 1] === '{');
  const prev = () => toks[toks.length - 1];
  const prevIsValueEnd = () => {
    const p = prev();
    if (!p) return false;
    if (p.t === 'num' || p.t === 'str' || p.t === 'dstr' || p.t === 'id') return true;
    if (p.t === 'kw' && p.v === 'end') return true;
    if (p.t === 'op' && (p.v === ')' || p.v === ']' || p.v === '}' || p.v === "'" || p.v === ".'")) return true;
    return false;
  };
  const atStatementStart = () => {
    const p = prev();
    return !p || p.t === 'nl' || p.t === 'semi' || p.t === 'comma';
  };
  const push = (t: TokType, v: string, extra: Partial<Token> = {}) => {
    toks.push({ t, v, line, col: i - lineStart + 1, sp, ...extra });
    sp = false;
  };

  while (i < n) {
    const c = src[i];
    // Block comments %{ ... %} on their own lines
    if ((c === '%' || c === '#') && src[i + 1] === '{' && /^[ \t]*$/.test(src.slice(lineStart, i)) && /^[ \t]*(\r?\n|$)/.test(src.slice(i + 2))) {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (src[i] === '\n') {
          line++;
          lineStart = i + 1;
          const rest = src.slice(i + 1);
          const m = rest.match(/^[ \t]*[%#]([{}])[ \t]*(\r?\n|$)/);
          if (m) {
            depth += m[1] === '{' ? 1 : -1;
            i += 1 + m[0].length - (m[2] ? m[2].length : 0);
            continue;
          }
        }
        i++;
      }
      continue;
    }
    if (c === '%' || (c === '#' && !inMatrix())) {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      sp = true;
      // Inside [] or {}, whitespace can separate elements
      if (inMatrix()) {
        while (i < n && (src[i] === ' ' || src[i] === '\t' || src[i] === '\r')) i++;
        const nc = src[i], nn = src[i + 1];
        if (prevIsValueEnd() && nc !== undefined) {
          let startsValue = false;
          if (isDigit(nc) || isIdStart(nc) || nc === '(' || nc === '[' || nc === '{' || nc === "'" || nc === '"' || nc === '@') startsValue = true;
          else if (nc === '.' && isDigit(nn ?? '')) startsValue = true;
          else if ((nc === '~' || nc === '!') && nn !== '=') startsValue = true;
          else if ((nc === '+' || nc === '-') && nn !== ' ' && nn !== '\t' && nn !== '=' && nn !== nc) startsValue = true;
          if (startsValue) push('comma', ',');
          sp = true;
        }
      }
      continue;
    }
    if (c === '.' && src.startsWith('...', i)) {
      // continuation: skip to end of line
      while (i < n && src[i] !== '\n') i++;
      if (i < n) {
        i++;
        line++;
        lineStart = i;
      }
      sp = true;
      continue;
    }
    if (c === '\n') {
      if (inMatrix()) {
        const p = prev();
        if (p && !(p.t === 'semi') && !(p.t === 'op' && (p.v === '[' || p.v === '{')) && !(p.t === 'comma')) push('semi', ';');
      } else if (brackets.length === 0) push('nl', '\n');
      i++;
      line++;
      lineStart = i;
      sp = true;
      continue;
    }
    // Command syntax: ident at statement start followed by space and a word
    if (isIdStart(c) && atStatementStart() && brackets.length === 0) {
      let j = i;
      while (j < n && isIdChar(src[j])) j++;
      const word = src.slice(i, j);
      if (COMMAND_WORDS.has(word) && (src[j] === ' ' || src[j] === '\t')) {
        let k = j;
        while (k < n && (src[k] === ' ' || src[k] === '\t')) k++;
        const nc = src[k];
        const isAssignOrCall = nc === '=' && src[k + 1] !== '=' || nc === '(';
        if (nc !== undefined && nc !== '\n' && nc !== ';' && nc !== ',' && nc !== '%' && !isAssignOrCall && !/^[+\-*/^<>&|]=?\s/.test(src.slice(k, k + 3))) {
          let e = k;
          while (e < n && src[e] !== '\n' && src[e] !== ';' && src[e] !== ',' && src[e] !== '%') {
            if (src[e] === "'") {
              e++;
              while (e < n && src[e] !== "'" && src[e] !== '\n') e++;
            }
            e++;
          }
          const raw = src.slice(k, e).trim();
          const args = splitCommandArgs(raw);
          push('id', word);
          i = e;
          push('cmd', raw, { args });
          continue;
        }
      }
    }
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] ?? ''))) {
      let j = i;
      let text: string;
      if (c === '0' && (src[i + 1] === 'x' || src[i + 1] === 'X')) {
        j += 2;
        while (j < n && /[0-9a-fA-F]/.test(src[j])) j++;
        text = src.slice(i, j);
        push('num', text, { num: parseInt(text.slice(2), 16) });
        i = j;
        continue;
      }
      while (j < n && isDigit(src[j])) j++;
      if (src[j] === '.' && !(src[j + 1] === '*' || src[j + 1] === '/' || src[j + 1] === '\\' || src[j + 1] === '^' || src[j + 1] === "'") && !src.startsWith('...', j)) {
        j++;
        while (j < n && isDigit(src[j])) j++;
      }
      if ((src[j] === 'e' || src[j] === 'E' || src[j] === 'd' || src[j] === 'D') && (isDigit(src[j + 1] ?? '') || ((src[j + 1] === '+' || src[j + 1] === '-') && isDigit(src[j + 2] ?? '')))) {
        j += 2;
        while (j < n && isDigit(src[j])) j++;
      }
      text = src.slice(i, j).replace(/[dD]/, 'e');
      let imag = false;
      if ((src[j] === 'i' || src[j] === 'j' || src[j] === 'I' || src[j] === 'J') && !isIdChar(src[j + 1] ?? '')) {
        imag = true;
        j++;
      }
      push('num', text, { num: parseFloat(text), imag });
      i = j;
      continue;
    }
    if (isIdStart(c)) {
      let j = i;
      while (j < n && isIdChar(src[j])) j++;
      const w = src.slice(i, j);
      // `end` inside parentheses/braces used as index is still a keyword token; parser decides.
      push(KEYWORDS.has(w) ? 'kw' : 'id', w);
      i = j;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let s = '';
      while (j < n) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            s += '"';
            j += 2;
            continue;
          }
          break;
        }
        if (src[j] === '\n') throw new LexError('String is not terminated properly.', line, i - lineStart + 1);
        s += src[j];
        j++;
      }
      if (j >= n) throw new LexError('String is not terminated properly.', line, i - lineStart + 1);
      push('dstr', s);
      i = j + 1;
      continue;
    }
    if (c === "'") {
      const transpose = prevIsValueEnd() && !(sp && inMatrix());
      if (transpose) {
        push('op', "'");
        i++;
        continue;
      }
      let j = i + 1;
      let s = '';
      while (j < n) {
        if (src[j] === "'") {
          if (src[j + 1] === "'") {
            s += "'";
            j += 2;
            continue;
          }
          break;
        }
        if (src[j] === '\n') throw new LexError('Character vector is not terminated properly.', line, i - lineStart + 1);
        s += src[j];
        j++;
      }
      if (j >= n) throw new LexError('Character vector is not terminated properly.', line, i - lineStart + 1);
      push('str', s);
      i = j + 1;
      continue;
    }
    if (c === ';') {
      if (inMatrix()) push('semi', ';');
      else if (brackets.length === 0) push('semi', ';');
      else push('semi', ';');
      i++;
      continue;
    }
    if (c === ',') {
      push('comma', ',');
      i++;
      continue;
    }
    let op = OPS3.find((o) => src.startsWith(o, i)) ?? OPS2.find((o) => src.startsWith(o, i)) ?? OPS1.find((o) => src.startsWith(o, i));
    if (!op) throw new LexError(`Invalid character '${c}'.`, line, i - lineStart + 1);
    if (op === ".'" && !prevIsValueEnd()) op = '.';
    if (op === '++' || op === '--') op = op[0];
    if (op === '(' || op === '[' || op === '{') brackets.push(op);
    if (op === ')' || op === ']' || op === '}') brackets.pop();
    push('op', op);
    i += op.length;
  }
  push('nl', '\n');
  push('eof', '');
  return toks;
}

function splitCommandArgs(raw: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < raw.length) {
    while (raw[i] === ' ' || raw[i] === '\t') i++;
    if (i >= raw.length) break;
    if (raw[i] === "'") {
      let j = i + 1;
      let s = '';
      while (j < raw.length && raw[j] !== "'") s += raw[j++];
      out.push(s);
      i = j + 1;
    } else {
      let j = i;
      while (j < raw.length && raw[j] !== ' ' && raw[j] !== '\t') j++;
      out.push(raw.slice(i, j));
      i = j;
    }
  }
  return out;
}
