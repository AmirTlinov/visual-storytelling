import test from 'node:test';
import assert from 'node:assert/strict';
import { integral, derivative } from '../dist/morph/construction/calculus.js';
import { projection } from '../dist/morph/construction/trigonometry.js';
import { distribution, linearMap } from '../dist/morph/construction/algebra.js';
import { spring } from '../dist/morph/construction/dynamics.js';
import { deformation } from '../dist/morph/construction/deformation.js';
import { constructionPlan } from '../dist/morph/construction/plan.js';
import { scalarExpression } from '../dist/morph/formula/expression.js';
import { dampedSpring } from '../dist/physics/spring.js';

const close = (actual, expected, eps = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${actual} ≠ ${expected}`,
  );
const findPath = (frame, id) => frame.panels.flatMap((p) => p.paths ?? []).find((p) => p.id === id);
const area = (points) =>
  points.reduce((sum, a, i) => {
    const b = points[(i + 1) % points.length];
    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0) / 2;
const patchArea = (patch) => {
  const [[x0, y0], [x1, y1]] = patch.domain;
  return area(
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ].map(patch.map),
  );
};

test('integral raises rectangles, converges to the numeric area, and preserves it while flattening', () => {
  for (const [fn, from, to, expected] of [
    ['x^4', 0, 1, 0.2],
    ['sin(8*pi*x)^2', 0, 1, 0.5],
    ['exp(4*x)', 0, 1, (Math.exp(4) - 1) / 4],
    ['x', -1, 2, 1.5],
  ]) {
    const model = integral(fn, from, to);
    close(model.result, expected);
    const measured = (stage, p) => -area(findPath(model.sample(stage, p), 'area').points);
    const coarse = measured(0, 1);
    close(measured(0, 0), 0);
    close(measured(0, 0.37), coarse * 0.37);
    close(measured(1, 0.42), coarse * 0.58 + expected * 0.42);
    for (const p of [0, 0.15, 0.5, 0.85, 1]) close(measured(2, p), expected);
    for (const stage of [0, 1])
      assert.deepEqual(
        findPath(model.sample(stage, 1), 'area'),
        findPath(model.sample(stage + 1, 0), 'area'),
      );
  }
  const signed = integral('x', -1, 2);
  assert.match(signed.sample(2, 1).explanation, /ниже оси вычитаются/);
  let calls = 0;
  const prepared = integral(
    (x) => {
      calls++;
      return x * x;
    },
    2,
    3,
  );
  const count = calls;
  for (let i = 0; i <= 60; i++) prepared.sample(Math.min(2, Math.floor(i / 20)), (i % 20) / 20);
  assert.equal(calls, count, 'rendering reuses the prepared curve and quadrature');
  assert.ok(
    prepared.sample(1, 0.5).panels[0].paths.every((p) => p.id !== 'axis-y'),
    'an off-panel y-axis must not escape the diagram',
  );
});

test('secant joins each stage continuously and ends at a finite two-sided tangent', () => {
  for (const fn of ['x^3', (x) => x * x * x]) {
    const model = derivative(fn, 0.5, 1);
    close(model.result, 0.75, 1e-6);
    for (const stage of [0, 1])
      for (const id of ['secant', 'difference', 'slope-line'])
        assert.deepEqual(
          findPath(model.sample(stage, 1), id),
          findPath(model.sample(stage + 1, 0), id),
        );
    const end = findPath(model.sample(2, 1), 'slope-line').points;
    close(end[1][1], 0.75, 1e-6);
    close(findPath(model.sample(2, 1 - 1e-9), 'slope-line').points[1][1], 0.75, 1e-6);
    for (let i = 0; i <= 30; i++) {
      const frame = model.sample(2, i / 30);
      for (const panel of frame.panels)
        for (const p of panel.paths.flatMap((path) => path.points))
          assert.ok(
            p[0] >= panel.bounds[0][0] - 1e-8 &&
              p[0] <= panel.bounds[1][0] + 1e-8 &&
              p[1] >= panel.bounds[0][1] - 1e-8 &&
              p[1] <= panel.bounds[1][1] + 1e-8,
          );
    }
  }
  assert.throws(() => derivative(Math.abs, 0), /two-sided derivative/);
  assert.throws(() => derivative((x) => Math.abs(x) * 1e-6, 0), /two-sided derivative/);
  assert.throws(() => derivative('abs(x)', 0), /finite real/);
  assert.throws(() => scalarExpression('1').value(Infinity), /argument must be finite/);
  assert.throws(() => scalarExpression('[x]').value(1), /one real number/);
});

test('projection makes one additional revolution and returns to its stated sine', () => {
  for (const angle of [Math.PI / 3, Math.PI, Math.PI * 1.6]) {
    const model = projection(angle),
      end = model.sample(2, 1);
    close(findPath(end, 'radius').points[1][1], model.result);
    const wave = findPath(end, 'wave').points;
    close(wave.at(-1)[0], angle + 2 * Math.PI);
    close(wave.at(-1)[1], model.result);
    assert.ok(end.panels[1].bounds[1][0] > wave.at(-1)[0]);
    for (const stage of [0, 1])
      for (const id of ['radius', 'sine', 'wave'])
        assert.deepEqual(
          findPath(model.sample(stage, 1), id),
          findPath(model.sample(stage + 1, 0), id),
        );
    if (angle === Math.PI) assert.match(end.formula, /sin θ = 0$/);
  }
});

test('linear material identity is stable while its measured area follows the determinant', () => {
  for (const matrix of [
    [
      [2, 0],
      [0, 3],
    ],
    [
      [0, -1],
      [1, 0],
    ],
    [
      [-1, 0],
      [0, 1],
    ],
  ]) {
    const model = linearMap(matrix);
    for (const p of [0, 0.25, 0.75, 1]) {
      const patch = model.sample(0, p).panels[0].patches[0];
      const [[a, b], [c, d]] = matrix;
      close(patchArea(patch), (1 + p * (a - 1)) * (1 + p * (d - 1)) - p * p * b * c);
      assert.equal(patch.text, '1');
    }
    close(patchArea(model.sample(1, 1).panels[0].patches[0]), model.result);
    assert.doesNotMatch(model.sample(1, 1).explanation, /Сдвиг наклоняет/);
  }
  const split = distribution(2, 3, 4);
  for (const stage of [0, 1])
    assert.deepEqual(
      findPath(split.sample(stage, 1), 'cut'),
      findPath(split.sample(stage + 1, 0), 'cut'),
    );
  assert.throws(() => distribution(1e308, 2, 2), /finite/);
  assert.throws(
    () =>
      linearMap([
        [1e308, 0],
        [0, 1e308],
      ]),
    /finite/,
  );
});

test('undamped spring transfers one conserved energy and remains attached to the mass', () => {
  const model = spring(2, 5, 1.3);
  close(model.result, (5 * 1.3 ** 2) / 2);
  for (const stage of [1, 2])
    for (let i = 0; i <= 40; i++) {
      const frame = model.sample(stage, i / 40),
        energy = frame.panels[1].patches;
      close(
        energy.reduce((sum, patch) => sum + patchArea(patch), 0),
        1,
      );
      const mass = frame.panels[0].patches[0],
        attachment = mass.map([mass.domain[0][0], 0]);
      const end = findPath(frame, 'coil').points.at(-1);
      close(end[0], attachment[0]);
      close(end[1], attachment[1]);
    }
  for (const stage of [0, 1])
    assert.deepEqual(
      findPath(model.sample(stage, 1), 'coil'),
      findPath(model.sample(stage + 1, 0), 'coil'),
    );
  assert.throws(() => spring(1, 1e300, 1e100), /finite/);
  const oscillator = dampedSpring(1.7, 0);
  assert.equal(oscillator.settlingTime, Infinity);
  const [x, v] = oscillator.step(0.7, -0.2, 0, 42);
  close(oscillator.stiffness * x * x + v * v, oscillator.stiffness * 0.7 ** 2 + 0.2 ** 2);
});

test('arbitrary material maps keep sampled inputs and reused output buffers independent', () => {
  const buffer = [0, 0];
  const model = deformation({
    kind: 'construction',
    model: 'deform',
    domain: [
      [-2, -1],
      [2, 1],
    ],
    parameter: [0, 1],
    text: 'x',
    map(point, p) {
      point[0] += p * point[1] ** 2;
      buffer[0] = point[0];
      buffer[1] = point[1];
      return buffer;
    },
  });
  const patch = model.sample(0, 1).panels[0].patches[0],
    input = [1, 1];
  const first = patch.map(input),
    second = patch.map([-2, -1]);
  assert.deepEqual(input, [1, 1]);
  assert.deepEqual(first, [2, 1]);
  assert.deepEqual(second, [-1, -1]);
  assert.ok(model.sample(0, 0).panels[0].bounds[0][0] < -2);
  assert.deepEqual(model.sample(0, 0).panels[0].patches[0].map([1, 1]), [1, 1]);
  assert.doesNotMatch(model.sample(0, 0.5).explanation, /взаимное положение сохраняется/);
  const plan = constructionPlan({ kind: 'construction', model: 'projection', angle: 1 });
  assert.equal(plan.sample(0.5).result, undefined);
  close(plan.sample(1).result, Math.sin(1));
  assert.throws(() => plan.sample(NaN), /finite/);
});

test('material framing catches motion between preparation times and accepts a stable mathematical range', () => {
  const operation = {
    kind: 'construction',
    model: 'deform',
    domain: [
      [-1, -1],
      [1, 1],
    ],
    parameter: [0, 1],
    map: ([x, y], p) => [x, y + 10 * Math.sin(64 * Math.PI * p)],
  };
  const moving = deformation(operation);
  const initial = moving.sample(0, 0),
    peak = moving.sample(0, 1 / 128);
  assert.ok(peak.panels[0].bounds[1][1] > 11);
  assert.deepEqual(
    moving.sample(0, 0).panels[0].bounds,
    initial.panels[0].bounds,
    'reverse seeking must restore exactly the same framing',
  );
  const stable = deformation({
    ...operation,
    bounds: [
      [-1, -11],
      [1, 11],
    ],
  });
  assert.deepEqual(
    stable.sample(0, 0).panels[0].bounds,
    stable.sample(0, 1 / 128).panels[0].bounds,
  );
  assert.deepEqual(
    stable.sample(0, 0).panels[0].bounds,
    stable.sample(0, 3 / 128).panels[0].bounds,
  );
  assert.throws(
    () =>
      deformation({
        ...operation,
        bounds: [
          [1, -1],
          [-1, 1],
        ],
      }),
    /increasing bounds/,
  );
  assert.match(derivative('x^20', 1, 0.1).sample(0, 0).panels[0].title, /x\^20/);
});
