import type { Accessor, Expr, FuncDef, LValue, Program, Stmt } from './ast';
import { tokenize, type Token } from './lexer';

export class ParseError extends Error {
  constructor(msg: string, public line: number, public col: number) {
    super(msg);
  }
}

const BLOCK_END = new Set(['end', 'endif', 'endfor', 'endwhile', 'endfunction', 'endswitch', 'end_try_catch']);

export function parse(src: string): Program {
  const p = new Parser(tokenize(src), src);
  return p.program();
}

export function parseExpression(src: string): Expr {
  const p = new Parser(tokenize(src), src);
  p.skipNewlines();
  const e = p.expr();
  p.skipNewlines();
  if (p.peek().t !== 'eof') throw new ParseError(`Unexpected '${p.peek().v}' in expression`, p.peek().line, p.peek().col);
  return e;
}

class Parser {
  i = 0;
  indexDepth = 0;
  matrixDepth = 0;
  constructor(private toks: Token[], private src: string) {}

  peek(o = 0): Token {
    return this.toks[Math.min(this.i + o, this.toks.length - 1)];
  }
  next(): Token {
    return this.toks[this.i++];
  }
  isOp(v: string, o = 0) {
    const t = this.peek(o);
    return t.t === 'op' && t.v === v;
  }
  isKw(v: string) {
    const t = this.peek();
    return t.t === 'kw' && t.v === v;
  }
  expectOp(v: string): Token {
    const t = this.next();
    if (t.t !== 'op' || t.v !== v) throw new ParseError(`Expected '${v}' but found '${t.v === '\n' ? 'newline' : t.v}'`, t.line, t.col);
    return t;
  }
  err(msg: string, t = this.peek()): never {
    throw new ParseError(msg, t.line, t.col);
  }
  skipNewlines() {
    while (this.peek().t === 'nl' || this.peek().t === 'semi' || this.peek().t === 'comma') this.i++;
  }

  program(): Program {
    const body: Stmt[] = [];
    const functions: FuncDef[] = [];
    this.skipNewlines();
    while (this.peek().t !== 'eof') {
      if (this.isKw('function')) functions.push(this.funcDef());
      else body.push(this.statement());
      this.skipNewlines();
    }
    return { body, functions };
  }

  funcDef(): FuncDef {
    const start = this.next(); // function
    let outs: string[] = [];
    let name = '';
    // forms: function name, function name(args), function out = name(args), function [a,b] = name(args)
    if (this.isOp('[')) {
      this.next();
      while (!this.isOp(']')) {
        const t = this.next();
        if (t.t === 'id') outs.push(t.v);
        else if (t.t !== 'comma') this.err('Invalid function output list', t);
      }
      this.next();
      this.expectOp('=');
      name = this.ident();
    } else {
      const first = this.ident();
      if (this.isOp('=')) {
        this.next();
        outs = [first];
        name = this.ident();
      } else name = first;
    }
    while (this.isOp('.')) {
      // set.prop / get.prop style names
      this.next();
      name += '.' + this.ident();
    }
    const params: string[] = [];
    if (this.isOp('(')) {
      this.next();
      while (!this.isOp(')')) {
        const t = this.next();
        if (t.t === 'id') params.push(t.v);
        else if (t.t === 'op' && (t.v === '~')) params.push('~');
        else if (t.t !== 'comma') this.err('Invalid parameter list', t);
      }
      this.next();
    }
    const body = this.block(['end', 'endfunction', 'function']);
    if (this.peek().t === 'kw' && (this.peek().v === 'end' || this.peek().v === 'endfunction')) this.next();
    return { name, params, outs, body, line: start.line };
  }

  ident(): string {
    const t = this.next();
    if (t.t !== 'id') this.err(`Expected identifier but found '${t.v}'`, t);
    return t.v;
  }

  block(terminators: string[]): Stmt[] {
    const out: Stmt[] = [];
    this.skipNewlines();
    while (true) {
      const t = this.peek();
      if (t.t === 'eof') return out;
      if (t.t === 'kw' && (terminators.includes(t.v) || (terminators.includes('end') && BLOCK_END.has(t.v)))) return out;
      out.push(this.statement());
      this.skipNewlines();
    }
  }

  endBlock() {
    const t = this.next();
    if (!(t.t === 'kw' && BLOCK_END.has(t.v))) this.err(`Expected 'end' but found '${t.v}'`, t);
  }

  terminator(): boolean {
    // returns true if output should be printed
    const t = this.peek();
    if (t.t === 'semi') {
      this.next();
      if (this.peek().t === 'nl') this.next();
      return false;
    }
    if (t.t === 'comma' || t.t === 'nl') {
      this.next();
      return true;
    }
    if (t.t === 'eof') return true;
    if (t.t === 'kw' && (BLOCK_END.has(t.v) || ['else', 'elseif', 'case', 'otherwise', 'catch', 'until', 'function'].includes(t.v))) return true;
    this.err(`Unexpected '${t.v}'. Check for missing operator or delimiter.`);
  }

  statement(): Stmt {
    const t = this.peek();
    const line = t.line;
    if (t.t === 'kw') {
      switch (t.v) {
        case 'if': return this.ifStmt();
        case 'for':
        case 'parfor': return this.forStmt();
        case 'while': {
          this.next();
          const cond = this.expr();
          const body = this.block(['end']);
          this.endBlock();
          return { k: 'while', cond, body, line };
        }
        case 'do': {
          this.next();
          const body = this.block(['until']);
          this.next();
          const cond = this.expr();
          return { k: 'dountil', cond, body, line };
        }
        case 'switch': return this.switchStmt();
        case 'try': {
          this.next();
          if (this.peek().t === 'comma') this.next();
          const body = this.block(['catch', 'end']);
          let id: string | null = null;
          let catchBody: Stmt[] = [];
          if (this.isKw('catch')) {
            const ct = this.next();
            if (this.peek().t === 'id' && this.peek().line === ct.line) id = this.next().v;
            catchBody = this.block(['end']);
          }
          this.endBlock();
          return { k: 'try', body, id, catchBody, line };
        }
        case 'break':
          this.next();
          this.terminator();
          return { k: 'break', line };
        case 'continue':
          this.next();
          this.terminator();
          return { k: 'continue', line };
        case 'return':
          this.next();
          this.terminator();
          return { k: 'return', line };
        case 'global':
        case 'persistent': {
          this.next();
          const names: string[] = [];
          while (this.peek().t === 'id') names.push(this.next().v);
          this.terminator();
          return { k: t.v === 'global' ? 'global' : 'persistent', names, line };
        }
        case 'function':
          this.err('Function definitions are not permitted in this context.');
        default:
          this.err(`Unexpected keyword '${t.v}'`);
      }
    }
    if (t.t === 'id' && this.peek(1).t === 'cmd') {
      this.next();
      const cmd = this.next();
      const print = this.terminator();
      return { k: 'command', name: t.v, args: cmd.args ?? [], print, line };
    }
    const startTok = this.i;
    const e = this.expr();
    if (this.isOp('=') ) {
      this.next();
      const lhs = this.toLValues(e);
      const rhs = this.expr();
      const print = this.terminator();
      return { k: 'assign', lhs, rhs, print, line };
    }
    for (const op of ['+=', '-=', '*=', '/=']) {
      if (this.isOp(op)) {
        this.next();
        const lhs = this.toLValues(e);
        const rhs = this.expr();
        const print = this.terminator();
        return { k: 'assign', lhs, rhs: { k: 'bin', op: op[0], l: e, r: rhs }, print, line, op };
      }
    }
    const endTok = this.i;
    const print = this.terminator();
    void startTok;
    void endTok;
    return { k: 'expr', e, print, line };
  }

  toLValues(e: Expr): LValue[] {
    if (e.k === 'matrix') {
      if (e.rows.length > 1) this.err('Invalid assignment target');
      return (e.rows[0] ?? []).map((x) => this.toLValue(x));
    }
    return [this.toLValue(e)];
  }

  toLValue(e: Expr): LValue {
    if (e.k === 'tilde') return { name: '~', chain: [], tilde: true };
    const chain: Accessor[] = [];
    let cur: Expr = e;
    while (true) {
      if (cur.k === 'id') return { name: cur.name, chain: chain.reverse() };
      if (cur.k === 'index') {
        chain.push(cur.brace ? { t: '{}', args: cur.args } : { t: '()', args: cur.args });
        cur = cur.base;
      } else if (cur.k === 'field') {
        chain.push({ t: '.', name: cur.name });
        cur = cur.base;
      } else if (cur.k === 'dynfield') {
        chain.push({ t: '.()', e: cur.e });
        cur = cur.base;
      } else this.err('Invalid assignment target. Only variables, indexed variables and fields can be assigned.');
    }
  }

  ifStmt(): Stmt {
    const line = this.next().line;
    const clauses: { cond: Expr; body: Stmt[] }[] = [];
    const cond = this.expr();
    clauses.push({ cond, body: this.block(['elseif', 'else', 'end']) });
    let els: Stmt[] | null = null;
    while (true) {
      if (this.isKw('elseif')) {
        this.next();
        const c = this.expr();
        clauses.push({ cond: c, body: this.block(['elseif', 'else', 'end']) });
      } else if (this.isKw('else')) {
        this.next();
        els = this.block(['end']);
      } else break;
    }
    this.endBlock();
    return { k: 'if', clauses, els, line };
  }

  forStmt(): Stmt {
    const line = this.next().line;
    let paren = false;
    if (this.isOp('(')) {
      // for (i = 1:10)
      const save = this.i;
      this.next();
      if (this.peek().t === 'id' && this.isOp('=', 1)) paren = true;
      else this.i = save;
    }
    const name = this.ident();
    this.expectOp('=');
    const iter = this.expr();
    if (paren) this.expectOp(')');
    const body = this.block(['end']);
    this.endBlock();
    return { k: 'for', v: { name, chain: [] }, iter, body, line };
  }

  switchStmt(): Stmt {
    const line = this.next().line;
    const subject = this.expr();
    this.skipNewlines();
    const cases: { v: Expr; body: Stmt[] }[] = [];
    let otherwise: Stmt[] | null = null;
    while (true) {
      if (this.isKw('case')) {
        this.next();
        const v = this.expr();
        cases.push({ v, body: this.block(['case', 'otherwise', 'end']) });
      } else if (this.isKw('otherwise')) {
        this.next();
        otherwise = this.block(['case', 'otherwise', 'end']);
      } else break;
    }
    this.endBlock();
    return { k: 'switch', subject, cases, otherwise, line };
  }

  // ---------------- Expressions (MATLAB precedence) ----------------
  expr(): Expr {
    return this.orOr();
  }
  orOr(): Expr {
    let l = this.andAnd();
    while (this.isOp('||')) {
      this.next();
      l = { k: 'bin', op: '||', l, r: this.andAnd() };
    }
    return l;
  }
  andAnd(): Expr {
    let l = this.or();
    while (this.isOp('&&')) {
      this.next();
      l = { k: 'bin', op: '&&', l, r: this.or() };
    }
    return l;
  }
  or(): Expr {
    let l = this.and();
    while (this.isOp('|')) {
      this.next();
      l = { k: 'bin', op: '|', l, r: this.and() };
    }
    return l;
  }
  and(): Expr {
    let l = this.cmp();
    while (this.isOp('&')) {
      this.next();
      l = { k: 'bin', op: '&', l, r: this.cmp() };
    }
    return l;
  }
  cmp(): Expr {
    let l = this.range();
    while (true) {
      const t = this.peek();
      if (t.t === 'op' && ['==', '~=', '!=', '<', '<=', '>', '>='].includes(t.v)) {
        this.next();
        l = { k: 'bin', op: t.v === '!=' ? '~=' : t.v, l, r: this.range() };
      } else return l;
    }
  }
  range(): Expr {
    // A bare ':' inside an index means "all"
    if (this.isOp(':') && this.indexDepth > 0) {
      const nt = this.peek(1);
      if ((nt.t === 'op' && (nt.v === ')' || nt.v === '}')) || nt.t === 'comma') {
        this.next();
        return { k: 'colon' };
      }
    }
    const start = this.additive();
    if (this.isOp(':') && !(this.matrixDepth === 0 && this.indexDepth === 0 && false)) {
      this.next();
      const second = this.additive();
      if (this.isOp(':')) {
        this.next();
        const third = this.additive();
        return { k: 'range', start, step: second, stop: third };
      }
      return { k: 'range', start, step: null, stop: second };
    }
    return start;
  }
  additive(): Expr {
    let l = this.multiplicative();
    while (true) {
      const t = this.peek();
      if (t.t === 'op' && (t.v === '+' || t.v === '-')) {
        // In matrix context, "a -b" was split by the lexer with a comma already.
        this.next();
        l = { k: 'bin', op: t.v, l, r: this.multiplicative() };
      } else return l;
    }
  }
  multiplicative(): Expr {
    let l = this.unary();
    while (true) {
      const t = this.peek();
      if (t.t === 'op' && ['*', '/', '\\', '.*', './', '.\\'].includes(t.v)) {
        this.next();
        l = { k: 'bin', op: t.v, l, r: this.unary() };
      } else return l;
    }
  }
  unary(): Expr {
    const t = this.peek();
    if (t.t === 'op' && (t.v === '-' || t.v === '+' || t.v === '~' || t.v === '!')) {
      if ((t.v === '~' || t.v === '!') && this.matrixDepth > 0) {
        const nt = this.peek(1);
        if (nt.t === 'comma' || (nt.t === 'op' && nt.v === ']')) {
          this.next();
          return { k: 'tilde' };
        }
      }
      this.next();
      const e = this.unary();
      return { k: 'un', op: t.v === '!' ? '~' : t.v, e };
    }
    return this.power();
  }
  power(): Expr {
    let base = this.postfix();
    while (this.isOp('^') || this.isOp('.^')) {
      const op = this.next().v;
      // exponent may have a unary prefix: 2^-1
      let rhs: Expr;
      const t = this.peek();
      if (t.t === 'op' && (t.v === '-' || t.v === '+' || t.v === '~' || t.v === '!')) {
        this.next();
        rhs = { k: 'un', op: t.v === '!' ? '~' : t.v, e: this.postfix() };
      } else rhs = this.postfix();
      base = { k: 'bin', op, l: base, r: rhs };
    }
    return base;
  }
  postfix(): Expr {
    let e = this.primary();
    while (true) {
      const t = this.peek();
      if (t.t === 'op' && t.v === '(' && !(this.matrixDepth > 0 && t.sp && this.indexDepth === 0)) {
        this.next();
        const args = this.args(')');
        e = { k: 'index', base: e, args, brace: false };
      } else if (t.t === 'op' && t.v === '{' && !(this.matrixDepth > 0 && t.sp)) {
        this.next();
        const args = this.args('}');
        e = { k: 'index', base: e, args, brace: true };
      } else if (t.t === 'op' && t.v === '.' && !t.sp) {
        this.next();
        const n = this.peek();
        if (n.t === 'id' || n.t === 'kw') {
          this.next();
          e = { k: 'field', base: e, name: n.v };
        } else if (n.t === 'op' && n.v === '(') {
          this.next();
          const save = this.indexDepth;
          this.indexDepth = 0;
          const fe = this.expr();
          this.indexDepth = save;
          this.expectOp(')');
          e = { k: 'dynfield', base: e, e: fe };
        } else this.err('Invalid field name');
      } else if (t.t === 'op' && (t.v === "'" || t.v === ".'")) {
        this.next();
        e = { k: 'post', op: t.v, e };
      } else return e;
    }
  }
  args(close: string): Expr[] {
    const args: Expr[] = [];
    const saveM = this.matrixDepth;
    this.matrixDepth = 0;
    this.indexDepth++;
    while (this.peek().t === 'nl') this.next();
    if (this.isOp(close)) {
      this.next();
      this.indexDepth--;
      this.matrixDepth = saveM;
      return args;
    }
    while (true) {
      args.push(this.expr());
      if (this.peek().t === 'comma') {
        this.next();
        continue;
      }
      if (this.isOp(close)) {
        this.next();
        break;
      }
      this.err(`Expected ',' or '${close}' in argument list`);
    }
    this.indexDepth--;
    this.matrixDepth = saveM;
    return args;
  }
  primary(): Expr {
    const t = this.next();
    switch (t.t) {
      case 'num':
        return { k: 'num', v: t.num!, im: !!t.imag };
      case 'str':
        return { k: 'str', v: t.v, dq: false };
      case 'dstr':
        return { k: 'str', v: t.v, dq: true };
      case 'id':
        return { k: 'id', name: t.v };
      case 'kw':
        if (t.v === 'end' && this.indexDepth > 0) return { k: 'end' };
        this.err(`Unexpected keyword '${t.v}'`, t);
      case 'op':
        if (t.v === '(') {
          const saveM = this.matrixDepth, saveI = this.indexDepth;
          this.matrixDepth = 0;
          const e = this.expr();
          this.matrixDepth = saveM;
          this.indexDepth = saveI;
          this.expectOp(')');
          // parenthesized expressions suppress cs-list expansion; represent as-is
          return e.k === 'index' ? { k: 'index', base: { k: 'id', name: '__paren__' }, args: [e], brace: false } : e;
        }
        if (t.v === '[') return this.matrix(']', 'matrix');
        if (t.v === '{') return this.matrix('}', 'cell');
        if (t.v === '@') {
          if (this.isOp('(')) {
            const startTok = this.peek();
            this.next();
            const params: string[] = [];
            while (!this.isOp(')')) {
              const p = this.next();
              if (p.t === 'id') params.push(p.v);
              else if (p.t === 'op' && p.v === '~') params.push('~');
              else if (p.t !== 'comma') this.err('Invalid anonymous function parameter', p);
            }
            this.next();
            const saveM = this.matrixDepth, saveI = this.indexDepth;
            this.matrixDepth = 0;
            this.indexDepth = 0;
            const bodyStart = this.peek();
            const body = this.expr();
            this.matrixDepth = saveM;
            this.indexDepth = saveI;
            const endTok = this.peek();
            const src = '@(' + params.join(',') + ') ' + this.sliceSource(bodyStart, endTok);
            void startTok;
            return { k: 'anon', params, body, src };
          }
          let name = this.ident();
          while (this.isOp('.') && this.peek(1).t === 'id') {
            this.next();
            name += '.' + this.next().v;
          }
          return { k: 'fhandle', name };
        }
        if (t.v === ':') return { k: 'colon' };
        this.err(`Unexpected '${t.v}'`, t);
      case 'nl':
      case 'eof':
        this.err('Expression is incomplete.', t);
      default:
        this.err(`Unexpected '${t.v}'`, t);
    }
  }
  sliceSource(a: Token, b: Token): string {
    const lines = this.src.split('\n');
    if (a.line === b.line) return lines[a.line - 1].slice(a.col - 1, b.col - 1).trim();
    const parts = [lines[a.line - 1].slice(a.col - 1)];
    for (let l = a.line; l < b.line - 1; l++) parts.push(lines[l]);
    parts.push(lines[b.line - 1].slice(0, b.col - 1));
    return parts.join(' ').replace(/\.\.\.[^\n]*/g, '').trim();
  }
  matrix(close: string, kind: 'matrix' | 'cell'): Expr {
    const rows: Expr[][] = [];
    let row: Expr[] = [];
    const saveI = this.indexDepth;
    this.matrixDepth++;
    while (true) {
      const t = this.peek();
      if (t.t === 'op' && t.v === close) {
        this.next();
        break;
      }
      if (t.t === 'semi' || t.t === 'nl') {
        this.next();
        if (row.length) rows.push(row);
        row = [];
        continue;
      }
      if (t.t === 'comma') {
        this.next();
        continue;
      }
      if (t.t === 'eof') this.err(`Missing '${close}'`);
      row.push(this.expr());
    }
    if (row.length) rows.push(row);
    this.matrixDepth--;
    this.indexDepth = saveI;
    return kind === 'matrix' ? { k: 'matrix', rows } : { k: 'cell', rows };
  }
}
