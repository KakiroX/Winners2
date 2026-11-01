import { describe, expect, it } from 'vitest';
import { createInterpreter } from '../src/lang';
import { toNumber, toStringValue, type Tensor, type Value } from '../src/lang/value';
import { readMat, writeMat } from '../src/io/mat';
import { compileUserEquation } from '../src/lang/equation';

function run(code: string) {
  let out = '';
  const I = createInterpreter({ print: (s) => (out += s) });
  I.run(code);
  const v = (name: string): Value => {
    const x = I.base.vars.get(name);
    if (!x) throw new Error(`no variable ${name}; output:\n${out}`);
    return x;
  };
  const n = (name: string) => toNumber(v(name));
  const arr = (name: string) => Array.from((v(name) as Tensor).re);
  return { out, v, n, arr, I };
}

describe('lexing & parsing', () => {
  it('matrix whitespace rules', () => {
    const r = run("a = [1 -2]; b = [1 - 2]; c = [1 , 2;3 4]; d = [a' a']; e = [1 +2];");
    expect(r.arr('a')).toEqual([1, -2]);
    expect(r.arr('b')).toEqual([-1]);
    expect(r.arr('c')).toEqual([1, 3, 2, 4]);
    expect((r.v('d') as Tensor).cols).toBe(2);
    expect(r.arr('e')).toEqual([1, 2]);
  });
  it('transpose vs strings', () => {
    const r = run("x = [1 2 3]'; s = 'it''s'; y = x'; z = {'a' 'b'};");
    expect((r.v('x') as Tensor).rows).toBe(3);
    expect(toStringValue(r.v('s'))).toBe("it's");
    expect((r.v('z') as any).numel).toBe(2);
  });
  it('comments, continuation and command syntax', () => {
    const r = run("x = 1 + ... comment\n 2; % trailing\n%{\nblock\n%}\nformat long\ny = x;");
    expect(r.n('y')).toBe(3);
  });
  it('precedence', () => {
    const r = run('a = -2^2; b = 2^-1; c = 1:3+1; d = ~0 == 1; e = 2*3^2;');
    expect(r.n('a')).toBe(-4);
    expect(r.n('b')).toBe(0.5);
    expect(r.arr('c')).toEqual([1, 2, 3, 4]);
    expect(r.n('d')).toBe(1);
    expect(r.n('e')).toBe(18);
  });
});

describe('indexing', () => {
  it('reads with end, colon, logical masks', () => {
    const r = run('A = magic(4); a = A(end, end); b = A(2, :); c = A(:, end); d = A(A > 12)\'; e = A(end); f = A([1 end], [1 end]);');
    expect(r.n('a')).toBe(1);
    expect(r.arr('b')).toEqual([5, 11, 10, 8]);
    expect(r.arr('c')).toEqual([13, 8, 12, 1]);
    expect(r.arr('d').sort((x, y) => x - y)).toEqual([13, 14, 15, 16]);
    expect(r.n('e')).toBe(1);
    expect(r.arr('f')).toEqual([16, 4, 13, 1]);
  });
  it('assignment growth and deletion', () => {
    const r = run('x = []; x(3) = 5; y = 1:5; y([2 4]) = []; M = eye(2); M(3, 3) = 9; N = magic(3); N(:, 2) = []; z = zeros(2); z(:) = 1:4;');
    expect(r.arr('x')).toEqual([0, 0, 5]);
    expect(r.arr('y')).toEqual([1, 3, 5]);
    expect(r.arr('M')).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 9]);
    expect((r.v('N') as Tensor).cols).toBe(2);
    expect(r.arr('z')).toEqual([1, 2, 3, 4]);
  });
  it('implicit expansion', () => {
    const r = run('A = [1;2] + [10 20 30]; B = [1 2 3] .* 2;');
    expect(r.arr('A')).toEqual([11, 12, 21, 22, 31, 32]);
    expect(r.arr('B')).toEqual([2, 4, 6]);
  });
  it('errors with MATLAB messages', () => {
    const r = run('x = [1 2 3]; y = x(5);');
    expect(r.out).toContain('Index exceeds the number of array elements');
    const r2 = run('a = [1 2] * [3 4];');
    expect(r2.out).toContain('Incorrect dimensions for matrix multiplication');
    const r3 = run('undefinedThing + 1');
    expect(r3.out).toContain("Unrecognized function or variable 'undefinedThing'");
  });
});

describe('cells, structs, strings', () => {
  it('cells and cs-lists', () => {
    const r = run("c = {1, 'two', [3 4 5]}; a = c{3}(2); n = numel(c); d = [c{[1 3]}]; c{5} = 'x'; m = numel(c);");
    expect(r.n('a')).toBe(4);
    expect(r.n('n')).toBe(3);
    expect(r.arr('d')).toEqual([1, 3, 4, 5]);
    expect(r.n('m')).toBe(5);
  });
  it('structs and nested assignment', () => {
    const r = run("s.a = 1; s.b.c = [1 2 3]; s.b.c(2) = 20; t(2).x = 5; f = fieldnames(s); q = s.b.c(2); k = numel(t); name = 'a'; v = s.(name);");
    expect(r.n('q')).toBe(20);
    expect(r.n('k')).toBe(2);
    expect(r.n('v')).toBe(1);
    expect((r.v('f') as any).numel).toBe(2);
  });
  it('sprintf / num2str / strings', () => {
    const r = run("a = sprintf('%d-%5.2f|%s', 3, pi, 'ok'); b = num2str(pi); c = sprintf('%d,', [1 2 3]); d = strsplit('a,b,c', ','); e = upper('abc'); f = strrep('hello world', 'o', '0'); g = strjoin({'x','y'}, '+'); h = \"abc\" + \"def\";");
    expect(toStringValue(r.v('a'))).toBe('3- 3.14|ok');
    expect(toStringValue(r.v('b'))).toBe('3.1416');
    expect(toStringValue(r.v('c'))).toBe('1,2,3,');
    expect((r.v('d') as any).numel).toBe(3);
    expect(toStringValue(r.v('e'))).toBe('ABC');
    expect(toStringValue(r.v('f'))).toBe('hell0 w0rld');
    expect(toStringValue(r.v('g'))).toBe('x+y');
    expect(toStringValue(r.v('h'))).toBe('abcdef');
  });
  it('regexp', () => {
    const r = run("[tok] = regexp('x=12, y=7', '(\\w)=(\\d+)', 'tokens'); n = numel(tok); m = regexprep('aaa', 'a', 'b');");
    expect(r.n('n')).toBe(2);
    expect(toStringValue(r.v('m'))).toBe('bbb');
  });
});

describe('functions and control flow', () => {
  it('local functions, multiple outputs, nargin, recursion', () => {
    const code = `
[m, s] = stats([1 2 3 4]);
f = fact(5);
z = addopt(2);
function [mu, sigma] = stats(x)
  mu = mean(x);
  sigma = std(x);
end
function r = fact(n)
  if n <= 1
    r = 1;
  else
    r = n * fact(n - 1);
  end
end
function y = addopt(a, b)
  if nargin < 2, b = 10; end
  y = a + b;
end`;
    const r = run(code);
    expect(r.n('m')).toBe(2.5);
    expect(r.n('s')).toBeCloseTo(1.2909944, 6);
    expect(r.n('f')).toBe(120);
    expect(r.n('z')).toBe(12);
  });
  it('anonymous functions capture by value', () => {
    const r = run('k = 2; f = @(x) k * x.^2; k = 100; y = f(3); g = @() 42; h = g(); c = cellfun(@(v) v * 2, {1, 2, 3}); a = arrayfun(@(v) v + 1, [1 2 3]);');
    expect(r.n('y')).toBe(18);
    expect(r.n('h')).toBe(42);
    expect(r.arr('c')).toEqual([2, 4, 6]);
    expect(r.arr('a')).toEqual([2, 3, 4]);
  });
  it('loops, switch, try/catch, while/break', () => {
    const r = run(`
s = 0; for i = 1:10, if mod(i, 2) == 0, continue; end, s = s + i; end
k = 0; while true, k = k + 1; if k >= 5, break; end, end
switch 'b'
  case {'a', 'b'}
    sw = 1;
  otherwise
    sw = 2;
end
try
  error('my:id', 'Bad %d', 3);
catch err
  msg = err.message; id = err.identifier;
end
cols = 0; for c = magic(3), cols = cols + 1; end`);
    expect(r.n('s')).toBe(25);
    expect(r.n('k')).toBe(5);
    expect(r.n('sw')).toBe(1);
    expect(toStringValue(r.v('msg'))).toBe('Bad 3');
    expect(toStringValue(r.v('id'))).toBe('my:id');
    expect(r.n('cols')).toBe(3);
  });
});

describe('display', () => {
  it('formats like MATLAB', () => {
    expect(run('x = 5').out).toBe('x =\n\n     5\n\n');
    expect(run('y = pi').out).toBe('y =\n\n    3.1416\n\n');
    expect(run('A = [1 2; 3 4]').out).toBe('A =\n\n     1     2\n     3     4\n\n');
    expect(run("s = 'hi'").out).toBe("s =\n\n    'hi'\n\n");
    expect(run('3 + 4').out).toContain('ans =');
    expect(run("disp('hello')").out).toBe('hello\n');
    expect(run("fprintf('%d apples\\n', 3)").out).toBe('3 apples\n');
  });
});

describe('numerics', () => {
  it('linear algebra', () => {
    const r = run('A = [4 1; 2 3]; x = A \\ [1; 2]; d = det(A); B = inv(A); e = sort(eig(A))\'; [Q, R] = qr(A); n = norm(Q*R - A); s = svd([3 0; 0 4])\'; r = rank(magic(4));');
    expect(r.arr('x')[0]).toBeCloseTo(0.1, 10);
    expect(r.arr('x')[1]).toBeCloseTo(0.6, 10);
    expect(r.n('d')).toBeCloseTo(10, 10);
    expect(r.arr('e')[0]).toBeCloseTo(2, 8);
    expect(r.arr('e')[1]).toBeCloseTo(5, 8);
    expect(r.n('n')).toBeLessThan(1e-10);
    expect(r.arr('s')).toEqual([4, 3]);
    expect(r.n('r')).toBe(3);
  });
  it('complex numbers', () => {
    const r = run('z = sqrt(-4); a = abs(3 + 4i); p = roots([1 0 1]); q = real(p(1)); m = imag(exp(1i * pi / 2));');
    expect(Array.from((r.v('z') as Tensor).im!)).toEqual([2]);
    expect(r.n('a')).toBe(5);
    expect(Math.abs(r.n('q'))).toBeLessThan(1e-12);
    expect(r.n('m')).toBeCloseTo(1, 12);
  });
  it('polyfit, interp1, trapz, fzero, fminsearch, integral', () => {
    const r = run(`
p = polyfit([1 2 3 4], [3 5 7 9], 1);
yi = interp1([1 2 3], [10 20 30], 2.5);
ys = interp1([0 1 2 3], [0 1 8 27], 1.5, 'spline');
t = trapz([0 1 2], [0 1 4]);
z = fzero(@(x) x.^2 - 2, 1);
xm = fminsearch(@(v) (v(1)-1)^2 + (v(2)+2)^2, [0 0]);
q = integral(@(x) exp(-x.^2), -Inf, Inf);`);
    expect(r.arr('p')[0]).toBeCloseTo(2, 10);
    expect(r.arr('p')[1]).toBeCloseTo(1, 10);
    expect(r.n('yi')).toBe(25);
    expect(r.n('ys')).toBeCloseTo(3.375, 6);
    expect(r.n('t')).toBe(3);
    expect(r.n('z')).toBeCloseTo(Math.SQRT2, 10);
    expect(r.arr('xm')[0]).toBeCloseTo(1, 3);
    expect(r.arr('xm')[1]).toBeCloseTo(-2, 3);
    expect(r.n('q')).toBeCloseTo(Math.sqrt(Math.PI), 6);
  });
  it('ode45 exponential decay', () => {
    const r = run('[t, y] = ode45(@(t, y) -2 * y, [0 1], 1); yend = y(end); tend = t(end);');
    expect(r.n('tend')).toBe(1);
    expect(r.n('yend')).toBeCloseTo(Math.exp(-2), 4);
  });
  it('fft', () => {
    const r = run('X = fft([1 2 3 4]); a = real(X); b = imag(X); y = real(ifft(fft([1 2 3 4 5])));');
    r.arr('a').forEach((v, i) => expect(v).toBeCloseTo([10, -2, -2, -2][i], 12));
    expect(r.arr('b').map((v) => Math.round(v * 1e9) / 1e9)).toEqual([0, 2, 0, -2]);
    r.arr('y').forEach((v, i) => expect(v).toBeCloseTo(i + 1, 10));
  });
  it('reductions and sorting', () => {
    const r = run('A = [3 1 2; 9 7 8]; s = sum(A); s2 = sum(A, 2); [m, i] = max([4 9 2]); [v, k] = sort([3 1 2], "descend"); u = unique([3 1 3 2]); f = find([0 1 0 1]); md = median([5 3 1 4]); cs = cumsum(1:4);');
    expect(r.arr('s')).toEqual([12, 8, 10]);
    expect(r.arr('s2')).toEqual([6, 24]);
    expect(r.n('m')).toBe(9);
    expect(r.n('i')).toBe(2);
    expect(r.arr('v')).toEqual([3, 2, 1]);
    expect(r.arr('k')).toEqual([1, 3, 2]);
    expect(r.arr('u')).toEqual([1, 2, 3]);
    expect(r.arr('f')).toEqual([2, 4]);
    expect(r.n('md')).toBe(3.5);
    expect(r.arr('cs')).toEqual([1, 3, 6, 10]);
  });
  it('magic squares', () => {
    for (const n of [3, 4, 5, 6, 8]) {
      const r = run(`M = magic(${n}); a = unique(sum(M)); b = unique(sum(M, 2)'); c = sum(diag(M)); d = numel(unique(M));`);
      const target = (n * (n * n + 1)) / 2;
      expect(r.arr('a')).toEqual([target]);
      expect(r.arr('b')).toEqual([target]);
      expect(r.n('c')).toBe(target);
      expect(r.n('d')).toBe(n * n);
    }
  });
});

describe('plotting', () => {
  it('builds figure specs', () => {
    const r = run("x = linspace(0, 2*pi, 50); plot(x, sin(x), 'r--o'); hold on; plot(x, cos(x)); title('Waves'); xlabel('x'); legend('sin', 'cos'); figure; subplot(1,2,1); bar([1 2 3]); subplot(1,2,2); histogram(randn(100,1));");
    const G = r.I.graphics;
    const figs = G.snapshot();
    expect(figs.length).toBe(2);
    const ax = figs[0].spec.axes[0];
    expect(ax.series.length).toBe(2);
    expect(ax.title).toBe('Waves');
    expect((ax.series[0] as any).color).toBe('#FF0000');
    expect((ax.series[0] as any).dash).toBe('dash');
    expect(ax.legend.show).toBe(true);
    expect(figs[1].spec.axes.length).toBe(2);
  });
});

describe('MAT files', () => {
  it('round-trips numeric, char, cell and struct values', () => {
    const r = run("A = magic(3); s = 'text'; c = {1, 'a'}; st.x = 1; st.y = [1 2];");
    const vars: [string, Value][] = ['A', 's', 'c', 'st'].map((n) => [n, r.v(n)]);
    for (const compress of [true, false]) {
      const bytes = writeMat(vars, compress);
      const back = readMat(bytes);
      expect(Array.from((back.get('A') as Tensor).re)).toEqual(r.arr('A'));
      expect(toStringValue(back.get('s')!)).toBe('text');
      expect((back.get('c') as any).numel).toBe(2);
      expect((back.get('st') as any).fields).toEqual(['x', 'y']);
    }
  });
});

describe('equations', () => {
  it('compiles user equations', () => {
    const c = compileUserEquation('Y = A*exp(-k*X) + C');
    expect(c.params).toEqual(['A', 'k', 'C']);
    expect(c.f(1, [2, 0, 3])).toBe(5);
  });
});
