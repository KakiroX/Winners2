export type Expr =
  | { k: 'num'; v: number; im: boolean }
  | { k: 'str'; v: string; dq: boolean }
  | { k: 'id'; name: string }
  | { k: 'colon' }
  | { k: 'end' }
  | { k: 'tilde' }
  | { k: 'bin'; op: string; l: Expr; r: Expr }
  | { k: 'un'; op: string; e: Expr }
  | { k: 'post'; op: string; e: Expr }
  | { k: 'range'; start: Expr; step: Expr | null; stop: Expr }
  | { k: 'index'; base: Expr; args: Expr[]; brace: boolean }
  | { k: 'field'; base: Expr; name: string }
  | { k: 'dynfield'; base: Expr; e: Expr }
  | { k: 'matrix'; rows: Expr[][] }
  | { k: 'cell'; rows: Expr[][] }
  | { k: 'anon'; params: string[]; body: Expr; src: string }
  | { k: 'fhandle'; name: string };

export type Accessor = { t: '()'; args: Expr[] } | { t: '{}'; args: Expr[] } | { t: '.'; name: string } | { t: '.()'; e: Expr };

export interface LValue {
  name: string;
  chain: Accessor[];
  tilde?: boolean;
}

export interface FuncDef {
  name: string;
  params: string[];
  outs: string[];
  body: Stmt[];
  line: number;
}

export type Stmt =
  | { k: 'expr'; e: Expr; print: boolean; line: number; src?: string }
  | { k: 'assign'; lhs: LValue[]; rhs: Expr; print: boolean; line: number; op?: string }
  | { k: 'if'; clauses: { cond: Expr; body: Stmt[] }[]; els: Stmt[] | null; line: number }
  | { k: 'for'; v: LValue; iter: Expr; body: Stmt[]; line: number }
  | { k: 'while'; cond: Expr; body: Stmt[]; line: number }
  | { k: 'dountil'; cond: Expr; body: Stmt[]; line: number }
  | { k: 'switch'; subject: Expr; cases: { v: Expr; body: Stmt[] }[]; otherwise: Stmt[] | null; line: number }
  | { k: 'try'; body: Stmt[]; id: string | null; catchBody: Stmt[]; line: number }
  | { k: 'break'; line: number }
  | { k: 'continue'; line: number }
  | { k: 'return'; line: number }
  | { k: 'global'; names: string[]; line: number }
  | { k: 'persistent'; names: string[]; line: number }
  | { k: 'command'; name: string; args: string[]; print: boolean; line: number };

export interface Program {
  body: Stmt[];
  functions: FuncDef[];
}
