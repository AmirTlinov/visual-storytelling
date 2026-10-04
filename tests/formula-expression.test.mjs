import test from 'node:test';
import assert from 'node:assert/strict';
import { compileExpression } from '../dist/morph/formula/expression.js';
import { integrate } from '../dist/morph/formula/calculus.js';
import { MathMorph } from '../dist/morph/math.js';

const compile = (expression, inputs = {}, functions) =>
  compileExpression(MathMorph.formula(expression, inputs, { functions }));
const close = (actual, expected, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);

test('formula playback reuses computed functions and preserves the original contributions', () => {
  let calls = 0;
  const operation = MathMorph.formula(
    'sum(double(partition(x, 3)))',
    { x: 6 },
    {
      measure: 'value',
      functions: {
        double(values) {
          calls++;
          return values.map((value) => value * 2);
        },
      },
    },
  );
  const expression = compileExpression(operation);
  assert.equal(calls, 1);
  assert.equal(expression.result, 12);
  assert.deepEqual(expression.steps.at(-1).outputs[0].origins, [
    { operand: 0, index: 0, value: 6 },
  ]);
  assert.deepEqual(
    expression.steps.map((step) => step.operator),
    ['partition', 'double', 'sum'],
  );
  assert.deepEqual(expression.steps[0].arguments, [6, 3]);
  const plan = MathMorph.plan(operation);
  assert.equal(calls, 2);
  for (const progress of [0, 0.3, 0.9, 0.2, 1, 0]) plan.sample(progress);
  assert.equal(calls, 2, 'sampling and reverse seek do not reevaluate a user function');
  assert.equal(plan.result, 12);
});

test('literal tensor components remain outputs and matrix operations retain their dependencies', () => {
  const array = compile('[1, x]', { x: 2 });
  assert.deepEqual(array.result, [1, 2]);
  assert.deepEqual(
    array.steps.at(-1).outputs.map((body) => body.value),
    [1, 2],
  );
  assert.equal(array.steps.at(-1).operator, 'array');
  const matrix = [
      [1, 2],
      [3, 4],
    ],
    original = structuredClone(matrix);
  assert.equal(compile('det(A)', { A: matrix }).result, -2);
  assert.deepEqual(compile('A * v', { A: matrix, v: [2, 3] }).result, [8, 18]);
  const transpose = compile("A'", { A: matrix });
  assert.deepEqual(transpose.result, [
    [1, 3],
    [2, 4],
  ]);
  assert.ok(
    transpose.steps.at(-1).outputs[1].origins.some((o) => o.index === 2 && o.value === 3),
    'transposition must not claim that output 3 derives solely from former position 2',
  );
  assert.deepEqual(matrix, original);
});

test('calculus keeps coefficients and lexical integration variables with exact notation metadata', () => {
  const derivative = compile('diff(a*x^3, x)', { a: 2, x: 3 });
  close(derivative.result, 54);
  assert.deepEqual(derivative.initial.map((body) => body.value).sort(), [2, 3]);
  assert.deepEqual(derivative.steps[0].calculus, { expression: 'a * x ^ 3', variable: 'x' });
  assert.deepEqual(derivative.steps[0].arguments, [3]);
  const integral = compile('integral(a*t^2, t, 0, x)', { a: 2, x: 3, t: 999 });
  close(integral.result, 18);
  assert.deepEqual(integral.initial.map((body) => body.value).sort(), [2, 3]);
  assert.deepEqual(integral.steps[0].arguments, [0, 3]);
  assert.deepEqual(integral.steps[0].calculus, { expression: 'a * t ^ 2', variable: 't' });
  close(compile('diff(2*x, x)').result, 2);
  close(compile('diff(sin(x), x)', { x: 0 }).result, 1);
});

test('custom function names cannot change operators or silently acquire a false derivative', () => {
  let calls = 0;
  const functions = {
    add(x, y) {
      calls++;
      return x * y;
    },
  };
  const expression = compile('add(x, 2) + 1', { x: 3 }, functions);
  assert.equal(expression.result, 7);
  assert.equal(expression.steps[0].custom, true);
  assert.equal(expression.steps[1].custom, undefined);
  assert.equal(calls, 1);
  assert.throws(
    () => compile('diff(sin(x), x)', { x: 3 }, { sin: (x) => x * x }),
    /derivative rule/,
  );
  assert.throws(
    () =>
      compile('diff(x^2, x)', {
        x: [
          [1, 2],
          [3, 4],
        ],
      }),
    /point.*scalar/,
  );
  assert.throws(() => compile('x', { x: 1 }, { partition: (x) => x }), /Invalid formula function/);
});

test('all expression paths reject nonfinite, nonnumeric and oversized results', () => {
  for (const [expression, inputs] of [
    ['1 / 0', {}],
    ['sqrt(-1)', {}],
    ['[]', {}],
    ['[x, 0]', { x: Array(64).fill(1) }],
    ['x', { x: Infinity }],
    ['integral([t], t, 0, 1)', {}],
    ['integral(t, t, [0], 1)', {}],
    ['x = 2', { x: 1 }],
  ])
    assert.throws(() => compile(expression, inputs), /finite|64|scalar|syntax/);
  assert.throws(() => compile('f(x)', { x: 1 }, { f: () => NaN }), /finite/);
});

test('quadrature resolves oscillation, reversal and finite scale extremes, and bounds failed work', () => {
  close(
    integrate((x) => x ** 4, -1, 2),
    33 / 5,
  );
  close(integrate(Math.exp, 1, 0), 1 - Math.E);
  for (const frequency of [4, 32])
    close(
      integrate((x) => Math.sin(frequency * Math.PI * x) ** 2, 0, 1),
      0.5,
    );
  close(
    integrate(() => 1e308, 0, 1e-308),
    1,
  );
  close(
    integrate(
      (x) => {
        assert.ok(Number.isFinite(x));
        return 1e-308;
      },
      1e308,
      1.1e308,
    ),
    0.1,
  );
  assert.equal(
    integrate(
      () => {
        throw new Error('empty interval must not evaluate');
      },
      2,
      2,
    ),
    0,
  );
  assert.throws(() => integrate((x) => 1 / x, 0, 1), /integrand.*finite/);
  assert.throws(() => integrate(() => 1e308, 0, 10), /finite real value/);
  let calls = 0;
  assert.throws(
    () =>
      integrate(
        (x) => {
          calls++;
          return Math.sin(1e6 * x) ** 2;
        },
        0,
        1,
      ),
    /did not converge/,
  );
  assert.ok(calls <= 8192, 'failure is bounded before a scene is published');
});
