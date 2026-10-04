import test from 'node:test';
import assert from 'node:assert/strict';
import { integral, derivative } from '../dist/morph/construction/calculus.js';
import { projection } from '../dist/morph/construction/trigonometry.js';
import { distribution, linearMap } from '../dist/morph/construction/algebra.js';
import { spring } from '../dist/morph/construction/dynamics.js';
import { deformation } from '../dist/morph/construction/deformation.js';
import { scalarExpression } from '../dist/morph/formula/expression.js';
import { dampedSpring } from '../dist/physics/spring.js';

const close = (actual, expected, eps = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${actual} ≠ ${expected}`,
  );
const findPath = (frame, id) => {
  if (id === 'area') return frame.panels[0].paths.find((p) => p.fill && p.pigment === 'blue');
  if (id === 'difference')
    return frame.panels[0].paths.find((p) => p.fill && p.pigment === 'orange');
  if (id === 'secant') return frame.panels[0].paths.find((p) => p.pigment === 'purple');
  if (id === 'slope-line') return frame.panels[1].paths.find((p) => p.pigment === 'purple');
};
// Ask the public narrative plan for a specified mathematical interpolation fraction.
const atMotion = (plan, stage, motion) => {
  if (motion === 0) return plan.sample(stage / plan.stages);
  if (motion === 1) return plan.sample((stage + 0.9) / plan.stages);
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 50; i++) {
    const p = (lo + hi) / 2;
    if (p * p * (3 - 2 * p) < motion) lo = p;
    else hi = p;
  }
  return plan.sample((stage + 0.1 + (0.72 * (lo + hi)) / 2) / plan.stages);
};
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
    const measured = (stage, p) => -area(findPath(atMotion(model, stage, p), 'area').points);
    const coarse = measured(0, 1);
    close(measured(0, 0), 0);
    close(measured(0, 0.37), coarse * 0.37);
    close(measured(1, 0.42), coarse * 0.58 + expected * 0.42);
    for (const p of [0, 0.15, 0.5, 0.85, 1]) close(measured(2, p), expected);
    for (const stage of [0, 1])
      assert.deepEqual(
        findPath(atMotion(model, stage, 1), 'area'),
        findPath(atMotion(model, stage + 1, 0), 'area'),
      );
  }
  const signed = integral('x', -1, 2);
  assert.match(signed.sample(1).explanation, /ниже оси вычитаются/);
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
  for (let i = 0; i <= 60; i++) prepared.sample(i / 60);
  assert.equal(calls, count, 'rendering reuses the prepared curve and quadrature');
  assert.ok(
    prepared.sample(0.5).panels[0].paths.every((p) => p.id !== 'axis-y'),
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
          findPath(atMotion(model, stage, 1), id),
          findPath(atMotion(model, stage + 1, 0), id),
        );
    const end = findPath(atMotion(model, 2, 1), 'slope-line').points;
    close(end[1][1], 0.75, 1e-6);
    close(findPath(atMotion(model, 2, 1 - 1e-9), 'slope-line').points[1][1], 0.75, 1e-6);
    for (let i = 0; i <= 30; i++) {
      const frame = atMotion(model, 2, i / 30);
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

const curvePath = (frame, pigment) =>
  frame.panels
    .flatMap((p) => p.paths ?? [])
    .find((p) => p.pigment === pigment && p.points.length > 2 && !p.quiet);
const geometry = (frame) =>
  frame.panels.flatMap((panel) => [
    ...panel.bounds.flat(),
    ...(panel.paths ?? []).flatMap((p) => [...p.points.flat(), p.opacity ?? 1]),
    ...(panel.marks ?? []).flatMap((p) => [...p.at, p.opacity ?? 1]),
    ...(panel.patches ?? []).flatMap((p) => {
      const [[x0, y0], [x1, y1]] = p.domain;
      return [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ].flatMap(p.map);
    }),
  ]);
const joinedStages = (plan) => {
  for (let stage = 0; stage < plan.stages - 1; stage++) {
    const before = geometry(plan.sample((stage + 0.9) / plan.stages));
    const after = geometry(plan.sample((stage + 1) / plan.stages));
    assert.equal(before.length, after.length);
    before.forEach((v, i) => close(v, after[i]));
  }
};

test('projection graph makes one additional revolution and returns to its stated sine', () => {
  for (const angle of [Math.PI / 3, Math.PI, Math.PI * 1.6]) {
    const plan = projection(angle),
      end = plan.sample(1);
    assert.equal(plan.stages, 3);
    const radius = end.panels[0].paths.find((p) => p.arrow && p.pigment === 'blue');
    close(radius.points[1][1], plan.result);
    const wave = curvePath(end, 'orange').points;
    close(wave.at(-1)[0], angle + 2 * Math.PI);
    close(wave.at(-1)[1], plan.result);
    assert.ok(end.panels[1].bounds[1][0] > wave.at(-1)[0]);
    joinedStages(plan);
    if (angle === Math.PI) assert.match(end.formula, /sin θ = 0$/);
  }
});

test('linear and distribution graphs preserve material identity, measurements and reveal', () => {
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
    const plan = linearMap(matrix);
    assert.equal(plan.stages, 2);
    for (const p of [0, 0.125, 0.3, 0.5, 1]) {
      const frame = plan.sample(p),
        patch = frame.panels[0].patches.find((p) => p.text === '1');
      const e1 = frame.panels[0].paths.find((p) => p.arrow && p.pigment === 'orange').points[1];
      const e2 = frame.panels[0].paths.find((p) => p.arrow && p.pigment === 'purple').points[1];
      close(patchArea(patch), e1[0] * e2[1] - e1[1] * e2[0]);
    }
    close(patchArea(plan.sample(1).panels[0].patches.find((p) => p.text === '1')), plan.result);
    joinedStages(plan);
  }
  const split = distribution(2, 3, 4);
  assert.equal(split.stages, 3);
  for (const p of [0, 0.3, 0.5, 0.67, 0.8, 1]) {
    const panel = split.sample(p).panels[0];
    close(
      panel.patches.reduce((sum, patch) => sum + patchArea(patch), 0),
      14,
    );
    for (const label of panel.labels)
      if (label.to) {
        const distance = Math.hypot(label.to[0] - label.at[0], label.to[1] - label.at[1]);
        assert.ok([2, 3, 4].some((expected) => Math.abs(distance - expected) < 1e-10));
      }
  }
  assert.equal(split.sample(0.6).result, undefined);
  assert.doesNotMatch(split.sample(0.6).formula, /14/);
  close(split.sample(1).result, 14);
  joinedStages(split);
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

test('spring graph transfers one conserved energy and remains attached to its material', () => {
  const plan = spring(2, 5, 1.3);
  assert.equal(plan.stages, 3);
  close(plan.result, (5 * 1.3 ** 2) / 2);
  for (let i = 0; i <= 80; i++) {
    const frame = plan.sample(1 / 3 + ((i / 80) * 2) / 3),
      energy = frame.panels[1].patches;
    close(
      energy.reduce((sum, patch) => sum + patchArea(patch), 0),
      1,
    );
    const mass = frame.panels[0].patches[0],
      attachment = mass.map([mass.domain[0][0], 0]);
    const end = curvePath(frame, 'purple').points.at(-1);
    close(end[0], attachment[0]);
    close(end[1], attachment[1]);
    const potential = energy[0],
      kinetic = energy[1];
    const labels = frame.panels[1].labels;
    const pLabel = labels.find((l) => l.pigment === 'purple'),
      kLabel = labels.find((l) => l.pigment === 'orange');
    close(pLabel.at[1], potential.map([1, 0.5])[1]);
    close(kLabel.at[1], kinetic.map([1, 0.5])[1]);
  }
  joinedStages(plan);
  assert.throws(() => spring(1, 1e300, 1e100), /finite/);
  const oscillator = dampedSpring(1.7, 0);
  assert.equal(oscillator.settlingTime, Infinity);
  const [x, v] = oscillator.step(0.7, -0.2, 0, 42);
  close(oscillator.stiffness * x * x + v * v, oscillator.stiffness * 0.7 ** 2 + 0.2 ** 2);
});

test('material recipes isolate callback inputs and reused output buffers through the graph', () => {
  const buffer = [0, 0];
  const plan = deformation({
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
  const patch = plan.sample(1).panels[0].patches[0],
    input = [1, 1];
  const first = patch.map(input),
    second = patch.map([-2, -1]);
  assert.deepEqual(input, [1, 1]);
  assert.deepEqual(first, [2, 1]);
  assert.deepEqual(second, [-1, -1]);
  assert.ok(plan.sample(0).panels[0].bounds[0][0] < -2);
  assert.deepEqual(plan.sample(0).panels[0].patches[0].map([1, 1]), [1, 1]);
  assert.doesNotMatch(plan.sample(0.5).explanation, /взаимное положение сохраняется/);
  const publicPlan = projection(1);
  assert.equal(publicPlan.sample(0.5).result, undefined);
  close(publicPlan.sample(1).result, Math.sin(1));
  assert.throws(() => publicPlan.sample(NaN), /finite/);
});

test('mapped framing catches motion between preparation times and accepts a stable mathematical range', () => {
  const operation = {
    domain: [
      [-1, -1],
      [1, 1],
    ],
    parameter: [0, 1],
    map: ([x, y], p) => [x, y + 10 * Math.sin(64 * Math.PI * p)],
  };
  const moving = deformation(operation);
  const initial = moving.sample(0),
    peak = moving.sample(0.14);
  const top = peak.panels[0].patches[0].map([0, 1])[1];
  assert.ok(top > 10, 'the motion lies between precomputed times');
  assert.ok(peak.panels[0].bounds[1][1] > top);
  assert.deepEqual(moving.sample(0).panels[0].bounds, initial.panels[0].bounds);
  const stable = deformation({
    ...operation,
    bounds: [
      [-1, -11],
      [1, 11],
    ],
  });
  assert.deepEqual(stable.sample(0).panels[0].bounds, stable.sample(0.14).panels[0].bounds);
  assert.deepEqual(stable.sample(0).panels[0].bounds, stable.sample(0.55).panels[0].bounds);
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
  assert.match(derivative('x^20', 1, 0.1).sample(0).panels[0].title, /x\^20/);
});
