import type { Accessor, Expr, FuncDef, LValue, Program, Stmt } from './ast';
import { parse, ParseError } from './parser';
import { LexError } from './lexer';
import { binaryOp, colonRange, transpose, unaryOp, warnings as opWarnings } from './ops';
import { COLON, assignCellContents, assignIndex, cellContents, indexValue, type RawIndex } from './indexing';
import {
  CellArray, FuncHandle, MError, StringArray, StructArray, Tensor, bool, complexScalar, emptyTensor, num, str, toBoolScalar, toNumber, toStringValue, valuesEqual, zeros,
  type Value, castTo,
} from './value';
import { defaultDisplay, displayValue, type DisplayOptions } from './display';
import { concat } from './concat';
import type { FigureSpec } from '../graph/spec';

export type Builtin = (args: Value[], nargout: number, ctx: CallContext) => Value[] | Value | void;

export interface CallContext {
  interp: Interpreter;
  scope: Scope;
  name: string;
}

export interface HostIO {
  print: (text: string) => void;
  /** Synchronous file read (Electron only). Returns null when unavailable. */
  readFile?: (path: string) => Uint8Array | null;
  writeFile?: (path: string, data: Uint8Array | string) => void;
  /** Called when figures change */
  onFigures?: (figs: { number: number; name: string; spec: FigureSpec }[]) => void;
  app?: AppBridge;
}

export interface AppBridge {
  listTables(): { name: string; kind: string; rows: number; datasets: string[] }[];
  getTable(name: string): { kind: string; x: (number | null)[]; datasets: { title: string; cols: (number | null)[][] }[]; rowTitles: string[] } | null;
  putTable(spec: { name: string; kind: string; x?: number[]; datasets: { title: string; cols: (number | null)[][] }[]; rowTitles?: string[] }): void;
  runAnalysis?(tableName: string, kind: string, params: Record<string, any>): string;
  makeGraph?(tableName: string, chart: string): string;
}

export class Scope {
  vars = new Map<string, Value>();
  globals = new Set<string>();
  nargin = 0;
  nargout = 0;
  fname: string | null = null;
  file: FileUnit | null = null;
  constructor(public parent: Scope | null = null) {}
}

export interface FileUnit {
  name: string;
  functions: Map<string, FuncDef>;
}

class BreakSig {}
class ContinueSig {}
class ReturnSig {}

export class Interpreter {
  base = new Scope();
  globals = new Map<string, Value>();
  persistents = new Map<string, Map<string, Value>>();
  builtins = new Map<string, Builtin>();
  /** Functions defined in project script files, keyed by name */
  libraryFunctions = new Map<string, { def: FuncDef; unit: FileUnit }>();
  display: DisplayOptions = { ...defaultDisplay };
  depth = 0;
  deadline = Infinity;
  steps = 0;
  sandboxed = false;
  lastWarning = '';
  rngState = 1;
  tic = Date.now();
  graphics: any = null;
  private endStack: { v: Value; k: number; n: number }[] = [];

  constructor(public io: HostIO) {}

  register(name: string, fn: Builtin) {
    this.builtins.set(name, fn);
  }

  print(s: string) {
    this.io.print(s);
  }

  warn(msg: string) {
    this.lastWarning = msg;
    this.print(`Warning: ${msg}\n`);
  }

  /** Execute source in the base workspace. Errors are printed (not thrown) unless `throwErrors`. */
  run(src: string, opts: { throwErrors?: boolean; unitName?: string } = {}): boolean {
    let prog: Program;
    try {
      prog = parse(src);
    } catch (e: any) {
      const msg = e instanceof ParseError || e instanceof LexError ? `Error: ${opts.unitName ? `File: ${opts.unitName} ` : ''}Line: ${e.line} Column: ${e.col}\n${e.message}` : String(e?.message ?? e);
      if (opts.throwErrors) throw new MError(msg);
      this.print(msg + '\n');
      return false;
    }
    const unit: FileUnit = { name: opts.unitName ?? 'command', functions: new Map(prog.functions.map((f) => [f.name, f])) };
    const prevFile = this.base.file;
    this.base.file = unit;
    try {
      this.execBlock(prog.body, this.base);
      this.flushOpWarnings();
      return true;
    } catch (e: any) {
      this.flushOpWarnings();
      if (e instanceof ReturnSig) return true;
      if (e instanceof BreakSig || e instanceof ContinueSig) return true;
      const err = this.toMError(e);
      if (opts.throwErrors) throw err;
      this.print(this.formatError(err) + '\n');
      return false;
    } finally {
      this.base.file = prevFile ?? null;
    }
  }

  formatError(err: MError): string {
    const where = (err as any).where as string | undefined;
    const m = err.message.startsWith('Error') ? err.message : `Error${(err as any).fn ? ` using ${(err as any).fn}` : ''}\n${err.message}`;
    return where ? `${m}\n\n${where}` : m;
  }

  toMError(e: any): MError {
    if (e instanceof MError) return e;
    if (e instanceof RangeError) return new MError('Maximum recursion limit reached or out of memory.', 'MATLAB:recursionLimit');
    return new MError(String(e?.message ?? e));
  }

  /** Register functions from a project script that is a function file (or contains functions). */
  defineLibrary(name: string, src: string): string | null {
    try {
      const prog = parse(src);
      const unit: FileUnit = { name, functions: new Map(prog.functions.map((f) => [f.name, f])) };
      for (const f of prog.functions) this.libraryFunctions.set(f.name, { def: f, unit });
      return null;
    } catch (e: any) {
      return e.message;
    }
  }

  flushOpWarnings() {
    while (opWarnings.length) this.print(opWarnings.shift()! + '\n');
  }

  checkTime() {
    if (++this.steps % 4096 === 0 && Date.now() > this.deadline) throw new MError('Execution stopped: time limit exceeded.', 'MATLAB:timeout');
  }

  // ---------------- Statements ----------------
  execBlock(stmts: Stmt[], scope: Scope) {
    for (const s of stmts) this.exec(s, scope);
  }

  exec(s: Stmt, scope: Scope) {
    try {
      this.execInner(s, scope);
    } catch (e: any) {
      if (e instanceof BreakSig || e instanceof ContinueSig || e instanceof ReturnSig) throw e;
      const err = this.toMError(e);
      if (!(err as any).where) {
        const fn = scope.fname;
        (err as any).where = fn ? `Error in ${fn} (line ${s.line})` : scope === this.base && this.base.file?.name && this.base.file.name !== 'command' ? `Error in ${this.base.file.name} (line ${s.line})` : '';
        if (!(err as any).where) delete (err as any).where;
      }
      throw err;
    }
  }

  private execInner(s: Stmt, scope: Scope) {
    this.checkTime();
    switch (s.k) {
      case 'expr': {
        const e = s.e;
        if (e.k === 'id' && this.hasVar(scope, e.name)) {
          if (s.print) this.print(displayValue(e.name, this.getVar(scope, e.name)!, this.display));
          return;
        }
        const vals = this.evalMulti(e, scope, 0);
        this.flushOpWarnings();
        if (vals.length) {
          const v = vals[0];
          this.setVar(scope, 'ans', v);
          if (s.print) this.print(displayValue('ans', v, this.display));
        }
        return;
      }
      case 'assign': {
        if (s.lhs.length === 1) {
          const lv = s.lhs[0];
          const nargout = 1;
          const vals = this.evalMulti(s.rhs, scope, nargout, lv);
          if (!vals.length) throw new MError('Insufficient number of outputs from right hand side of equal sign to satisfy assignment.');
          this.assignLValue(scope, lv, vals[0]);
          this.flushOpWarnings();
          if (s.print && !lv.tilde) this.print(displayValue(lv.name, this.getVar(scope, lv.name)!, this.display));
          return;
        }
        const vals = this.evalMulti(s.rhs, scope, s.lhs.length);
        const needed = s.lhs.reduce((m, lv, i) => (lv.tilde ? m : i + 1), 0);
        if (vals.length < needed) throw new MError(vals.length === 0 ? 'Insufficient number of outputs from right hand side of equal sign to satisfy assignment.' : 'Too many output arguments.', 'MATLAB:TooManyOutputs');
        s.lhs.forEach((lv, i) => {
          if (!lv.tilde && vals[i]) this.assignLValue(scope, lv, vals[i]);
        });
        this.flushOpWarnings();
        if (s.print) for (const lv of s.lhs) if (!lv.tilde) this.print(displayValue(lv.name, this.getVar(scope, lv.name)!, this.display));
        return;
      }
      case 'if': {
        for (const c of s.clauses) {
          if (this.truthy(this.evalSingle(c.cond, scope))) {
            this.execBlock(c.body, scope);
            return;
          }
        }
        if (s.els) this.execBlock(s.els, scope);
        return;
      }
      case 'for': {
        const runBody = (v: Value) => {
          this.assignLValue(scope, s.v, v);
          try {
            this.execBlock(s.body, scope);
          } catch (e) {
            if (e instanceof ContinueSig) return true;
            if (e instanceof BreakSig) return false;
            throw e;
          }
          return true;
        };
        if (s.iter.k === 'range') {
          const start = toNumber(this.evalSingle(s.iter.start, scope));
          const step = s.iter.step ? toNumber(this.evalSingle(s.iter.step, scope)) : 1;
          const stop = toNumber(this.evalSingle(s.iter.stop, scope));
          if (step === 0 || (step > 0 && start > stop) || (step < 0 && start < stop)) {
            this.assignLValue(scope, s.v, zeros(1, 0));
            return;
          }
          const n = Math.floor((stop - start) / step + 1e-10) + 1;
          for (let i = 0; i < n; i++) {
            this.checkTime();
            if (!runBody(num(start + i * step))) break;
          }
          return;
        }
        const it = this.evalSingle(s.iter, scope);
        const cols = it.cols;
        if (it.numel === 0) {
          this.assignLValue(scope, s.v, emptyTensor());
          return;
        }
        for (let j = 0; j < cols; j++) {
          this.checkTime();
          let v: Value;
          if (it.rows === 1) v = indexValue(it, [num(j + 1)]);
          else v = indexValue(it, [COLON, num(j + 1)]);
          if (!runBody(v)) break;
        }
        return;
      }
      case 'while': {
        while (this.truthy(this.evalSingle(s.cond, scope))) {
          this.checkTime();
          try {
            this.execBlock(s.body, scope);
          } catch (e) {
            if (e instanceof ContinueSig) continue;
            if (e instanceof BreakSig) break;
            throw e;
          }
        }
        return;
      }
      case 'dountil': {
        do {
          this.checkTime();
          try {
            this.execBlock(s.body, scope);
          } catch (e) {
            if (e instanceof ContinueSig) continue;
            if (e instanceof BreakSig) break;
            throw e;
          }
        } while (!this.truthy(this.evalSingle(s.cond, scope)));
        return;
      }
      case 'switch': {
        const subj = this.evalSingle(s.subject, scope);
        const matches = (cv: Value): boolean => {
          if (cv.kind === 'cell') return cv.data.some(matches);
          if ((subj.kind === 'tensor' && subj.cls === 'char') || subj.kind === 'string') {
            if ((cv.kind === 'tensor' && cv.cls === 'char') || cv.kind === 'string') return toStringValue(subj) === toStringValue(cv);
            return false;
          }
          if (subj.kind === 'tensor' && cv.kind === 'tensor' && cv.cls !== 'char') {
            if (subj.numel === 0 || cv.numel === 0) return false;
            return subj.re[0] === cv.re[0];
          }
          return false;
        };
        for (const c of s.cases) {
          if (matches(this.evalSingle(c.v, scope))) {
            this.execBlock(c.body, scope);
            return;
          }
        }
        if (s.otherwise) this.execBlock(s.otherwise, scope);
        return;
      }
      case 'try': {
        try {
          this.execBlock(s.body, scope);
        } catch (e) {
          if (e instanceof BreakSig || e instanceof ContinueSig || e instanceof ReturnSig) throw e;
          const err = this.toMError(e);
          if (s.id) this.setVar(scope, s.id, this.exceptionValue(err));
          (this as any).lastError = err;
          this.execBlock(s.catchBody, scope);
        }
        return;
      }
      case 'break':
        throw new BreakSig();
      case 'continue':
        throw new ContinueSig();
      case 'return':
        throw new ReturnSig();
      case 'global':
        for (const n of s.names) {
          scope.globals.add(n);
          if (!this.globals.has(n)) this.globals.set(n, emptyTensor());
          scope.vars.delete(n);
        }
        return;
      case 'persistent': {
        const key = scope.fname ?? '__base__';
        let m = this.persistents.get(key);
        if (!m) {
          m = new Map();
          this.persistents.set(key, m);
        }
        for (const n of s.names) {
          if (!m.has(n)) m.set(n, emptyTensor());
          scope.globals.add(`persistent:${key}:${n}`);
          (scope as any).persist = (scope as any).persist ?? new Map<string, Map<string, Value>>();
          (scope as any).persist.set(n, m);
        }
        return;
      }
      case 'command': {
        const vals = this.callFunction(s.name, s.args.map((a) => str(a)), 0, scope);
        if (vals.length && s.print) {
          this.setVar(scope, 'ans', vals[0]);
          this.print(displayValue('ans', vals[0], this.display));
        }
        return;
      }
    }
  }

  exceptionValue(err: MError): Value {
    const st = StructArray.scalar([
      ['message', str(err.message)],
      ['identifier', str(err.identifier || '')],
      ['stack', StructArray.scalar([['name', str((err as any).fn ?? '')], ['line', num(0)]])],
    ]);
    (st as any).isException = true;
    return st;
  }

  truthy(v: Value): boolean {
    return toBoolScalar(v);
  }

  // ---------------- Variables ----------------
  hasVar(scope: Scope, name: string): boolean {
    if (scope.globals.has(name)) return this.globals.has(name);
    const persist = (scope as any).persist as Map<string, Map<string, Value>> | undefined;
    if (persist?.has(name)) return true;
    return scope.vars.has(name);
  }
  getVar(scope: Scope, name: string): Value | undefined {
    if (scope.globals.has(name)) return this.globals.get(name);
    const persist = (scope as any).persist as Map<string, Map<string, Value>> | undefined;
    if (persist?.has(name)) return persist.get(name)!.get(name);
    return scope.vars.get(name);
  }
  setVar(scope: Scope, name: string, v: Value) {
    if (scope.globals.has(name)) {
      this.globals.set(name, v);
      return;
    }
    const persist = (scope as any).persist as Map<string, Map<string, Value>> | undefined;
    if (persist?.has(name)) {
      persist.get(name)!.set(name, v);
      return;
    }
    scope.vars.set(name, v);
  }

  assignLValue(scope: Scope, lv: LValue, v: Value) {
    if (lv.tilde) return;
    if (!lv.chain.length) {
      if (v.kind === 'tensor' && (v as any).__cslist) throw new MError('Too many output arguments.');
      this.setVar(scope, lv.name, v);
      return;
    }
    const cur = this.getVar(scope, lv.name);
    this.setVar(scope, lv.name, this.assignChain(cur, lv.chain, v, scope));
  }

  private assignChain(cur: Value | undefined, chain: Accessor[], rhs: Value, scope: Scope): Value {
    const acc = chain[0];
    const rest = chain.slice(1);
    switch (acc.t) {
      case '.':
      case '.()': {
        const name = acc.t === '.' ? acc.name : toStringValue(this.evalSingle(acc.e, scope), 'dynamic field name');
        if (!cur || (cur.kind === 'tensor' && cur.numel === 0)) cur = StructArray.scalar();
        if (cur.kind !== 'struct') throw new MError('Unable to perform assignment because dot indexing is not supported for variables of this type.', 'MATLAB:dotIndexNonStruct');
        if (cur.numel !== 1) throw new MError('Scalar structure required for this assignment.', 'MATLAB:scalarStructRequired');
        const sub = cur.data[0].get(name);
        const newSub = rest.length ? this.assignChain(sub, rest, rhs, scope) : rhs;
        const out = cur.clone();
        if (!out.fields.includes(name)) {
          out.fields.push(name);
          for (const m of out.data) if (!m.has(name)) m.set(name, emptyTensor());
        }
        out.data[0].set(name, newSub);
        return out;
      }
      case '()': {
        const args = this.evalIndexArgs(acc.args, scope, cur ?? emptyTensor());
        if (!rest.length) {
          if (cur && cur.kind === 'fhandle') throw new MError('Unable to index into a function handle in an assignment.');
          return assignIndex(cur, args, rhs);
        }
        let elem: Value | undefined;
        if (cur) {
          try {
            elem = indexValue(cur, args);
          } catch {
            elem = undefined;
          }
        }
        if (elem && elem.numel === 0) elem = undefined;
        if (!elem && cur && cur.kind === 'struct') elem = new StructArray(1, 1, [...cur.fields], [new Map(cur.fields.map((f) => [f, emptyTensor() as Value]))]);
        if (elem && elem.kind === 'cell' && rest[0].t !== '{}' && elem.numel === 1) elem = elem.data[0];
        const newElem = this.assignChain(elem, rest, rhs, scope);
        if (cur && cur.kind === 'cell' && newElem.kind !== 'cell') return assignIndex(cur, args, new CellArray(1, 1, [newElem]));
        return assignIndex(cur, args, newElem);
      }
      case '{}': {
        const args = this.evalIndexArgs(acc.args, scope, cur ?? new CellArray(0, 0, []));
        if (!rest.length) return assignCellContents(cur, args, rhs);
        let inner: Value | undefined;
        if (cur && cur.kind === 'cell') {
          try {
            inner = cellContents(cur, args)[0];
          } catch {
            inner = undefined;
          }
        }
        if (inner && inner.kind === 'tensor' && inner.numel === 0) inner = undefined;
        return assignCellContents(cur, args, this.assignChain(inner, rest, rhs, scope));
      }
    }
  }

  // ---------------- Expressions ----------------
  evalSingle(e: Expr, scope: Scope): Value {
    const v = this.evalMulti(e, scope, 1);
    if (!v.length) {
      if (e.k === 'index' && e.brace) throw new MError('Brace indexing produced no results (empty cell or index).');
      throw new MError(e.k === 'id' || e.k === 'index' ? `Value expected: '${exprName(e)}' did not return a value.` : 'Expression produced no value.', 'MATLAB:noValue');
    }
    return v[0];
  }

  evalMulti(e: Expr, scope: Scope, nargout: number, _lv?: LValue): Value[] {
    switch (e.k) {
      case 'num':
        return [e.im ? complexScalar(0, e.v) : num(e.v)];
      case 'str':
        return [e.dq ? StringArray.scalar(e.v) : str(e.v)];
      case 'id': {
        const v = this.getVar(scope, e.name);
        if (v !== undefined) return [v];
        return this.callFunction(e.name, [], nargout, scope);
      }
      case 'colon':
        return [str(':')];
      case 'end': {
        const top = this.endStack[this.endStack.length - 1];
        if (!top) throw new MError("The end operator must be used within an array index expression.");
        const v = top.v;
        if (top.n === 1) return [num(v.numel)];
        if (top.k === 0) return [num(v.rows)];
        if (top.k === 1) return [num(top.n === 2 ? v.cols : v.cols)];
        return [num(1)];
      }
      case 'tilde':
        throw new MError('Invalid use of ~.');
      case 'bin': {
        if (e.op === '&&' || e.op === '||') {
          const l = this.evalSingle(e.l, scope);
          const lb = this.logicalScalar(l, e.op);
          if (e.op === '&&' && !lb) return [bool(false)];
          if (e.op === '||' && lb) return [bool(true)];
          return [bool(this.logicalScalar(this.evalSingle(e.r, scope), e.op))];
        }
        const l = this.evalSingle(e.l, scope);
        const r = this.evalSingle(e.r, scope);
        return [binaryOp(e.op, l, r)];
      }
      case 'un':
        return [unaryOp(e.op, this.evalSingle(e.e, scope))];
      case 'post':
        return [transpose(this.evalSingle(e.e, scope), e.op === "'")];
      case 'range': {
        const a = this.evalSingle(e.start, scope);
        const st = e.step ? toNumber(this.evalSingle(e.step, scope)) : 1;
        const b = this.evalSingle(e.stop, scope);
        if ((a.kind === 'tensor' && a.numel === 0) || (b.kind === 'tensor' && b.numel === 0)) return [zeros(1, 0)];
        const r = colonRange(toNumber(a), st, toNumber(b));
        if (a.kind === 'tensor' && a.cls === 'char' && b.kind === 'tensor' && b.cls === 'char') return [r.withClass('char')];
        return [r];
      }
      case 'matrix': {
        const rows = e.rows.map((row) => row.flatMap((x) => this.evalMulti(x, scope, 1)));
        return [concat(rows, 'matrix')];
      }
      case 'cell': {
        const rows = e.rows.map((row) =>
          row.flatMap((x) => {
            const vs = this.evalMulti(x, scope, 1);
            return vs.map((v) => (v.kind === 'cell' && (x.k === 'cell' || (x.k === 'index' && !x.brace) || x.k === 'id') ? v : new CellArray(1, 1, [v])));
          }),
        );
        return [concat(rows, 'cell')];
      }
      case 'anon': {
        const closure = new Map<string, Value>();
        collectIds(e.body, (name) => {
          if (e.params.includes(name)) return;
          const v = this.getVar(scope, name);
          if (v !== undefined) closure.set(name, v);
        });
        return [new FuncHandle({ params: e.params, body: e.body, closure, src: e.src })];
      }
      case 'fhandle':
        return [new FuncHandle({ name: e.name, src: `@${e.name}` })];
      case 'field':
      case 'dynfield': {
        const bases = this.evalMulti(e.base, scope, 1);
        const name = e.k === 'field' ? e.name : toStringValue(this.evalSingle(e.e, scope), 'dynamic field name');
        const out: Value[] = [];
        for (const b of bases) {
          if (b.kind !== 'struct') {
            if (b.kind === 'fhandle' || b.kind === 'tensor' || b.kind === 'cell' || b.kind === 'string') {
              // allow method-like access on a few objects (e.g. figure handles) via interpreter hook
              const hook = this.builtins.get('__getprop__');
              if (hook && b.kind === 'tensor') {
                const r = hook([b, str(name)], 1, { interp: this, scope, name: '__getprop__' });
                if (r) return Array.isArray(r) ? r : [r as Value];
              }
              throw new MError(`Dot indexing is not supported for variables of this type.`, 'MATLAB:dotIndexNonStruct');
            }
          }
          for (let i = 0; i < b.numel; i++) out.push(b.getField(name, i));
        }
        return out;
      }
      case 'index': {
        const base = e.base;
        if (base.k === 'id') {
          if (base.name === '__paren__') return [this.evalSingle(e.args[0], scope)];
          const v = this.getVar(scope, base.name);
          if (v === undefined) {
            if (e.brace) throw new MError(`Undefined variable '${base.name}'.`, 'MATLAB:UndefinedFunction');
            const args = this.evalCallArgs(e.args, scope);
            return this.callFunction(base.name, args, nargout, scope);
          }
          return this.indexInto(v, e, scope, nargout);
        }
        const bvs = this.evalMulti(base, scope, 1);
        if (bvs.length !== 1) {
          if (!bvs.length) throw new MError('Indexing into an empty result.');
          throw new MError('Expected one output from a curly brace or dot indexing expression, but there were ' + bvs.length + ' results.');
        }
        return this.indexInto(bvs[0], e, scope, nargout);
      }
    }
  }

  private indexInto(v: Value, e: Extract<Expr, { k: 'index' }>, scope: Scope, nargout: number): Value[] {
    if (v.kind === 'fhandle' && !e.brace) {
      const args = this.evalCallArgs(e.args, scope);
      return this.callHandle(v, args, nargout, scope);
    }
    const args = this.evalIndexArgs(e.args, scope, v);
    if (e.brace) return cellContents(v, args);
    if (v.kind === 'struct' && (v as any).isException) return [indexValue(v, args)];
    return [indexValue(v, args)];
  }

  logicalScalar(v: Value, op: string): boolean {
    if (v.kind === 'tensor' && v.numel !== 1) {
      throw new MError(`Operands to the ${op === '&&' ? '&&' : '||'} operator must be convertible to logical scalar values. Use the ANY or ALL functions to reduce operands to logical scalar values.`, 'MATLAB:nonLogicalConditional');
    }
    return toBoolScalar(v);
  }

  evalIndexArgs(args: Expr[], scope: Scope, target: Value): RawIndex[] {
    const out: RawIndex[] = [];
    args.forEach((a, k) => {
      if (a.k === 'colon') {
        out.push(COLON);
        return;
      }
      this.endStack.push({ v: target, k, n: args.length });
      try {
        const vs = this.evalMulti(a, scope, 1);
        for (const v of vs) out.push(v);
      } finally {
        this.endStack.pop();
      }
    });
    return out;
  }

  evalCallArgs(args: Expr[], scope: Scope): Value[] {
    const out: Value[] = [];
    for (const a of args) {
      if (a.k === 'colon') {
        out.push(str(':'));
        continue;
      }
      out.push(...this.evalMulti(a, scope, 1));
    }
    return out;
  }

  // ---------------- Calls ----------------
  findFunction(name: string, scope: Scope): { def: FuncDef; unit: FileUnit } | null {
    let s: Scope | null = scope;
    while (s) {
      const f = s.file?.functions.get(name);
      if (f) return { def: f, unit: s.file! };
      s = s.parent;
    }
    const f = this.base.file?.functions.get(name);
    if (f) return { def: f, unit: this.base.file! };
    return this.libraryFunctions.get(name) ?? null;
  }

  callFunction(name: string, args: Value[], nargout: number, scope: Scope): Value[] {
    const user = this.findFunction(name, scope);
    if (user) return this.callUser(user.def, user.unit, args, nargout);
    const b = this.builtins.get(name);
    if (b) {
      const r = b(args, nargout, { interp: this, scope, name });
      if (r === undefined) return [];
      return Array.isArray(r) ? r : [r];
    }
    throw new MError(`Unrecognized function or variable '${name}'.`, 'MATLAB:UndefinedFunction');
  }

  callHandle(h: FuncHandle | Value, args: Value[], nargout: number, scope: Scope = this.base): Value[] {
    if (h.kind !== 'fhandle') {
      if (h.kind === 'tensor' && h.cls === 'char') return this.callFunction(h.toStr(), args, nargout, scope);
      if (h.kind === 'string') return this.callFunction(h.data[0], args, nargout, scope);
      throw new MError('Expected a function handle.');
    }
    const d = h.h;
    if (d.name) return this.callFunction(d.name, args, nargout, scope);
    const fs = new Scope(null);
    fs.fname = 'anonymous function';
    fs.file = scope.file ?? this.base.file;
    for (const [k, v] of d.closure!) fs.vars.set(k, v);
    const params = d.params!;
    const hasVarargin = params[params.length - 1] === 'varargin';
    const fixed = hasVarargin ? params.length - 1 : params.length;
    if (args.length > fixed && !hasVarargin) throw new MError('Too many input arguments.', 'MATLAB:TooManyInputs');
    for (let i = 0; i < fixed; i++) if (i < args.length && params[i] !== '~') fs.vars.set(params[i], args[i]);
    if (hasVarargin) fs.vars.set('varargin', new CellArray(1, Math.max(0, args.length - fixed), args.slice(fixed)));
    fs.nargin = args.length;
    if (++this.depth > 500) {
      this.depth = 0;
      throw new MError('Maximum recursion limit of 500 reached.', 'MATLAB:recursionLimit');
    }
    try {
      return this.evalMulti(d.body!, fs, nargout);
    } finally {
      this.depth--;
    }
  }

  callUser(def: FuncDef, unit: FileUnit, args: Value[], nargout: number): Value[] {
    const fs = new Scope(null);
    fs.fname = def.name;
    fs.file = unit;
    const params = def.params;
    const hasVarargin = params[params.length - 1] === 'varargin';
    const fixed = hasVarargin ? params.length - 1 : params.length;
    if (args.length > fixed && !hasVarargin) throw new MError(`Too many input arguments.`, 'MATLAB:TooManyInputs');
    for (let i = 0; i < Math.min(fixed, args.length); i++) if (params[i] !== '~') fs.vars.set(params[i], args[i]);
    if (hasVarargin) fs.vars.set('varargin', new CellArray(1, Math.max(0, args.length - fixed), args.slice(fixed)));
    fs.nargin = args.length;
    fs.nargout = nargout;
    const outs = def.outs;
    const hasVarargout = outs[outs.length - 1] === 'varargout';
    if (nargout > outs.length && !hasVarargout) throw new MError('Too many output arguments.', 'MATLAB:TooManyOutputs');
    if (++this.depth > 500) {
      this.depth = 0;
      throw new MError('Maximum recursion limit of 500 reached.', 'MATLAB:recursionLimit');
    }
    try {
      this.execBlock(def.body, fs);
    } catch (e) {
      if (!(e instanceof ReturnSig)) throw e;
    } finally {
      this.depth--;
    }
    const res: Value[] = [];
    const want = Math.max(1, nargout);
    for (let i = 0; i < outs.length && res.length < want; i++) {
      const o = outs[i];
      if (o === 'varargout') {
        const vo = fs.vars.get('varargout');
        if (vo && vo.kind === 'cell') res.push(...vo.data.slice(0, want - res.length));
        continue;
      }
      const v = this.getVar(fs, o);
      if (v === undefined) {
        if (i < nargout || (nargout === 0 && i === 0 && false)) throw new MError(`Output argument "${o}" (and possibly others) not assigned a value in the execution with "${def.name}" function.`, 'MATLAB:unassignedOutputs');
        break;
      }
      res.push(v);
    }
    return res;
  }

  /** Evaluate a value as a callable on numbers (used by numerics like fzero, ode45). */
  makeCallable(f: Value, scope: Scope = this.base): (args: Value[], nargout?: number) => Value[] {
    return (args, nargout = 1) => this.callHandle(f, args, nargout, scope);
  }

  // ---------------- Workspace helpers ----------------
  workspaceVars(): [string, Value][] {
    return [...this.base.vars.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }

  clearAll() {
    this.base.vars.clear();
    this.globals.clear();
  }

  evaluateToValue(src: string): Value {
    const prog = parse(src);
    if (prog.body.length !== 1 || prog.body[0].k !== 'expr') throw new MError('Expected an expression.');
    return this.evalSingle(prog.body[0].e, this.base);
  }

  isEqual(a: Value, b: Value) {
    return valuesEqual(a, b);
  }

  cast(t: Tensor, cls: any) {
    return castTo(t, cls);
  }
}

function exprName(e: Expr): string {
  if (e.k === 'id') return e.name;
  if (e.k === 'index') return exprName(e.base);
  if (e.k === 'field') return exprName(e.base) + '.' + e.name;
  return 'expression';
}

export function collectIds(e: Expr, f: (name: string) => void) {
  switch (e.k) {
    case 'id': f(e.name); break;
    case 'bin': collectIds(e.l, f); collectIds(e.r, f); break;
    case 'un':
    case 'post': collectIds(e.e, f); break;
    case 'range': collectIds(e.start, f); if (e.step) collectIds(e.step, f); collectIds(e.stop, f); break;
    case 'index': collectIds(e.base, f); e.args.forEach((a) => collectIds(a, f)); break;
    case 'field': collectIds(e.base, f); break;
    case 'dynfield': collectIds(e.base, f); collectIds(e.e, f); break;
    case 'matrix':
    case 'cell': e.rows.forEach((r) => r.forEach((x) => collectIds(x, f))); break;
    case 'anon': collectIds(e.body, (n) => { if (!e.params.includes(n)) f(n); }); break;
    default: break;
  }
}
