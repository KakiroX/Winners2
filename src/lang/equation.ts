// Compiles a user-defined curve-fitting equation such as "Y = A*exp(-k*X) + C" into a fast
// closure f(x, params). Uses the MATLAB expression parser; scalar math only.
import type { Expr } from './ast';
import { parseExpression } from './parser';

type Fn = (x: number, p: number[]) => number;

const FUNCS: Record<string, (...a: number[]) => number> = {
  exp: Math.exp, log: Math.log, ln: Math.log, log10: Math.log10, log2: Math.log2, sqrt: Math.sqrt, abs: Math.abs,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  power: Math.pow, pow: Math.pow, min: Math.min, max: Math.max, sign: Math.sign, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  erf: (v) => {
    const t = 1 / (1 + 0.3275911 * Math.abs(v));
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-v * v);
    return v >= 0 ? y : -y;
  },
  heaviside: (v) => (v > 0 ? 1 : v < 0 ? 0 : 0.5),
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E, Inf: Infinity, inf: Infinity };

export function compileUserEquation(src: string): { params: string[]; f: Fn } {
  let rhs = src.trim();
  const eq = rhs.match(/^\s*[Yy]\s*=\s*([\s\S]+)$/);
  if (eq) rhs = eq[1];
  rhs = rhs.replace(/;\s*$/, '');
  const ast = parseExpression(rhs);
  const params: string[] = [];
  const visit = (e: Expr) => {
    switch (e.k) {
      case 'id':
        if (e.name !== 'X' && e.name !== 'x' && !(e.name in CONSTS) && !params.includes(e.name)) params.push(e.name);
        break;
      case 'bin': visit(e.l); visit(e.r); break;
      case 'un': visit(e.e); break;
      case 'index':
        if (e.base.k === 'id' && e.base.name in FUNCS) e.args.forEach(visit);
        else throw new Error(`Unknown function in equation`);
        break;
      case 'num': break;
      default: throw new Error('Unsupported syntax in equation');
    }
  };
  visit(ast);
  const compile = (e: Expr): Fn => {
    switch (e.k) {
      case 'num': {
        const v = e.v;
        return () => v;
      }
      case 'id': {
        if (e.name === 'X' || e.name === 'x') return (x) => x;
        if (e.name in CONSTS) {
          const v = CONSTS[e.name];
          return () => v;
        }
        const k = params.indexOf(e.name);
        return (_x, p) => p[k];
      }
      case 'un': {
        const a = compile(e.e);
        return e.op === '-' ? (x, p) => -a(x, p) : a;
      }
      case 'bin': {
        const l = compile(e.l), r = compile(e.r);
        switch (e.op) {
          case '+': return (x, p) => l(x, p) + r(x, p);
          case '-': return (x, p) => l(x, p) - r(x, p);
          case '*': case '.*': return (x, p) => l(x, p) * r(x, p);
          case '/': case './': return (x, p) => l(x, p) / r(x, p);
          case '^': case '.^': return (x, p) => Math.pow(l(x, p), r(x, p));
          case '<': return (x, p) => (l(x, p) < r(x, p) ? 1 : 0);
          case '>': return (x, p) => (l(x, p) > r(x, p) ? 1 : 0);
          default: throw new Error(`Operator ${e.op} not supported in equations`);
        }
      }
      case 'index': {
        const fn = FUNCS[(e.base as any).name];
        const args = e.args.map(compile);
        if (args.length === 1) {
          const a0 = args[0];
          return (x, p) => fn(a0(x, p));
        }
        return (x, p) => fn(...args.map((a) => a(x, p)));
      }
      default:
        throw new Error('Unsupported equation');
    }
  };
  return { params, f: compile(ast) };
}
