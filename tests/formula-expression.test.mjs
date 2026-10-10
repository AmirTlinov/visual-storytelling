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
  assert.deepEqual(array.steps.at(-1).outputs[0].origins, []);
  assert.deepEqual(array.steps.at(-1).outputs[1].origins, [{ operand: 0, index: 0, value: 2 }]);
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

test('elementwise values, immediate dependencies and material groups agree', () => {
  for (const a of [
    [2, 4],
    [2, 9],
  ]) {
    const expression = compile('a .* b', { a, b: [3, 5] });
    const step = expression.steps.at(-1);
    assert.deepEqual(
      step.outputs.map((body) => body.value),
      [6, a[1] * 5],
    );
    assert.deepEqual(
      step.outputs.map((body) => body.inputIds),
      [
        [expression.initial[0].id, expression.initial[2].id],
        [expression.initial[1].id, expression.initial[3].id],
      ],
    );
    assert.ok(step.outputs.every((body) => body.originPrecision === 'exact'));
    const plan = MathMorph.plan(MathMorph.formula('a .* b', { a, b: [3, 5] }));
    const frame = plan.sample(0.3);
    for (const target of frame.targets)
      assert.deepEqual(
        new Set(
          frame.sources.filter((body) => body.material === target.material).map((body) => body.id),
        ),
        new Set(target.inputIds),
      );
    const saved = plan.sample(0.3);
    plan.sample(1);
    plan.sample(0);
    assert.deepEqual(plan.sample(0.3), saved);
  }
});

test('transpose, matrix products, reductions and partitions preserve exact structural dependencies', () => {
  const sourceIds = (expression) =>
    expression.steps
      .at(-1)
      .outputs.map((body) => body.origins.map(({ operand, index }) => [operand, index]));
  assert.deepEqual(
    sourceIds(
      compile("A'", {
        A: [
          [1, 2],
          [3, 4],
        ],
      }),
    ),
    [[[0, 0]], [[0, 2]], [[0, 1]], [[0, 3]]],
  );
  assert.deepEqual(
    sourceIds(
      compile('A * b', {
        A: [
          [1, 2],
          [3, 4],
        ],
        b: [5, 6],
      }),
    ),
    [
      [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ],
      [
        [0, 2],
        [1, 0],
        [0, 3],
        [1, 1],
      ],
    ],
  );
  assert.deepEqual(
    sourceIds(
      compile('a * B', {
        a: [1, 2],
        B: [
          [3, 4],
          [5, 6],
        ],
      }),
    ),
    [
      [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 2],
      ],
      [
        [0, 0],
        [1, 1],
        [0, 1],
        [1, 3],
      ],
    ],
  );
  assert.deepEqual(
    sourceIds(
      compile('sum(A, 0)', {
        A: [
          [1, 2],
          [3, 4],
        ],
      }),
    ),
    [
      [
        [0, 0],
        [0, 2],
      ],
      [
        [0, 1],
        [0, 3],
      ],
    ],
  );
  assert.deepEqual(
    sourceIds(
      compile('sum(A, 1)', {
        A: [
          [1, 2],
          [3, 4],
        ],
      }),
    ),
    [
      [
        [0, 0],
        [0, 1],
      ],
      [
        [0, 2],
        [0, 3],
      ],
    ],
  );
  assert.deepEqual(sourceIds(compile('partition(x, n)', { x: 8, n: 2 })), [
    [
      [0, 0],
      [1, 0],
    ],
    [
      [0, 0],
      [1, 0],
    ],
  ]);
  assert.deepEqual(
    sourceIds(compile('a .* b', { a: [0, 4], b: [3, 0] })),
    [
      [
        [0, 0],
        [1, 0],
      ],
      [
        [0, 1],
        [1, 1],
      ],
    ],
    'zero factors retain structural dependence',
  );
});

test('matrix denominators retain all call inputs while scalar and elementwise division stay exact', () => {
  const A = [
      [1, 2],
      [3, 4],
    ],
    operation = MathMorph.formula('2 / A', { A }, { measure: 'value' }),
    expression = compileExpression(operation),
    inverse = expression.steps.at(-1);
  assert.deepEqual(expression.result, [
    [-4, 2],
    [3, -1],
  ]);
  for (const output of inverse.outputs) {
    assert.equal(output.originPrecision, 'conservative');
    assert.deepEqual(
      output.inputIds,
      expression.initial.map((input) => input.id),
    );
    assert.deepEqual(
      output.origins.map((origin) => origin.index),
      [0, 1, 2, 3],
    );
  }
  const changed = compile('2 / A', {
    A: [
      [1, 2.5],
      [3, 4],
    ],
  });
  assert.notEqual(changed.result[0][0], expression.result[0][0]);
  assert.ok(
    inverse.outputs[0].origins.some((origin) => origin.index === 1),
    'the first result must retain the off-diagonal input that changes it',
  );
  const plan = MathMorph.plan(operation),
    frame = plan.sample(0.3);
  assert.equal(new Set(frame.sources.map((part) => part.material)).size, 1);
  assert.equal(new Set(frame.targets.map((part) => part.material)).size, 1);
  assert.equal(frame.sources.length, 4);
  assert.equal(frame.targets.length, 4);
  plan.sample(1);
  plan.sample(0);
  assert.deepEqual(plan.sample(0.3), frame);

  for (const formula of ['A / x', 'x ./ A']) {
    const divided = compile(formula, { A, x: 2 });
    for (const [index, output] of divided.steps.at(-1).outputs.entries()) {
      assert.equal(output.originPrecision, 'exact');
      assert.deepEqual(output.origins.map(({ operand, index }) => [operand, index]).sort(), [
        [0, index],
        [1, 0],
      ]);
    }
  }
  assert.equal(compile('x / 2', { x: 4 }).steps.at(-1).outputs[0].originPrecision, 'exact');
});

test('variadic multiplication follows each contraction and keeps animation sources honest', () => {
  const A = [
      [1, 2],
      [3, 4],
    ],
    B = [
      [5, 6],
      [7, 8],
    ];
  for (const formula of ['multiply(A, 2, B)', 'multiply(2, A, B)', 'multiply(A, B, 2)']) {
    const expression = compile(formula, { A, B }),
      first = expression.steps.at(-1).outputs[0];
    assert.deepEqual(expression.result, [
      [38, 44],
      [86, 100],
    ]);
    assert.deepEqual(
      new Set(first.origins.map(({ operand, index }) => `${operand}:${index}`)),
      new Set(['0:0', '0:1', '1:0', '1:2']),
      formula,
    );
    assert.ok(expression.steps.at(-1).outputs.every((body) => body.originPrecision === 'exact'));
    assert.equal(
      compile(formula, {
        A: [
          [1, 3],
          [3, 4],
        ],
        B,
      }).result[0][0],
      52,
    );
    assert.equal(
      compile(formula, {
        A: [
          [1, 2],
          [9, 4],
        ],
        B,
      }).result[0][0],
      38,
    );
    const plan = MathMorph.plan(MathMorph.formula(formula, { A, B })),
      frame = plan.sample(0.3);
    for (const target of frame.targets) {
      const group = frame.sources.filter((source) => source.material === target.material);
      for (const id of target.inputIds) assert.ok(group.some((source) => source.id === id));
    }
    plan.sample(1);
    plan.sample(0);
    assert.deepEqual(plan.sample(0.3), frame);
  }

  const scaled = compile('multiply(A, s, B)', { A, s: 0, B }).steps.at(-1);
  assert.ok(scaled.outputs.every((body) => body.origins.some((origin) => origin.operand === 1)));
  assert.equal(scaled.outputs[0].origins.length, 5, 'a zero scalar retains the full contraction');

  const dotThenMatrix = compile('multiply(a, b, M)', { a: [1, 2], b: [3, 4], M: A });
  assert.deepEqual(dotThenMatrix.result, [
    [11, 22],
    [33, 44],
  ]);
  for (const [i, output] of dotThenMatrix.steps.at(-1).outputs.entries()) {
    assert.equal(output.originPrecision, 'exact');
    assert.deepEqual(
      new Set(output.origins.map(({ operand, index }) => `${operand}:${index}`)),
      new Set(['0:0', '0:1', '1:0', '1:1', `2:${i}`]),
      'the vector dot product becomes one scalar, then scales each matrix cell',
    );
  }

  const chain = compile('multiply(A, B, C)', { A, B, C: [[1], [2]] }),
    chainOutput = chain.steps.at(-1).outputs[0];
  assert.deepEqual(chain.result, [[63], [143]]);
  assert.equal(chainOutput.originPrecision, 'exact');
  assert.deepEqual(
    new Set(chainOutput.origins.map(({ operand, index }) => `${operand}:${index}`)),
    new Set(['0:0', '0:1', '1:0', '1:1', '1:2', '1:3', '2:0', '2:1']),
    'the second contraction retains both intermediate column dependencies and no other row',
  );
});

test('opaque functions label call inputs conservatively and keep one whole material group', () => {
  let calls = 0;
  const functions = {
    f: (values) => {
      calls++;
      return [values[1], values[0]];
    },
  };
  const operation = MathMorph.formula('f(x) + y', { x: [2, 4], y: [1, 3] }, { functions });
  const expression = compileExpression(operation);
  assert.equal(calls, 1);
  for (const step of expression.steps)
    assert.ok(step.outputs.every((body) => body.originPrecision === 'conservative'));
  assert.deepEqual(
    expression.steps[0].outputs[0].inputIds,
    expression.initial.slice(0, 2).map((body) => body.id),
  );
  const plan = MathMorph.plan(operation);
  const frame = plan.sample(0.1);
  assert.equal(
    new Set(
      frame.sources
        .filter((body) => !body.material.startsWith('passive:'))
        .map((body) => body.material),
    ).size,
    1,
  );
  for (const time of [1, 0, 0.2, 0.9, 0.2]) plan.sample(time);
  assert.equal(calls, 2);
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

test('opaque integrands retain conservative precision through subsequent arithmetic and seeking', () => {
  let calls = 0;
  const operation = MathMorph.formula(
    'integral(f(a,t),t,0,x) + y',
    { a: [2, 100], x: 3, y: 4 },
    {
      measure: 'value',
      functions: {
        f: (a, t) => {
          calls++;
          return a[0] * t;
        },
      },
    },
  );
  const expression = compileExpression(operation),
    integral = expression.steps[0];
  close(expression.result, 13);
  assert.equal(integral.operator, 'integral');
  assert.equal(
    integral.custom,
    undefined,
    'an opaque integrand does not replace integral notation',
  );
  assert.deepEqual(
    integral.outputs[0].origins.map(({ operand, index }) => [operand, index]),
    [
      [1, 0],
      [0, 0],
      [0, 1],
    ],
  );
  for (const step of expression.steps)
    assert.ok(step.outputs.every((part) => part.originPrecision === 'conservative'));
  const plan = MathMorph.plan(operation),
    preparedCalls = calls,
    saved = plan.sample(0.7);
  assert.match(plan.sample(0).formula, /^∫/);
  for (const progress of [1, 0, 0.9, 0.2, 0.7]) plan.sample(progress);
  assert.equal(calls, preparedCalls, 'seeking does not reevaluate the integrand');
  assert.deepEqual(plan.sample(0.7), saved);
  assert.ok(plan.sample(1).targets.every((part) => part.originPrecision === 'conservative'));
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
