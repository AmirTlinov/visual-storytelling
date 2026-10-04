import test from 'node:test';
import assert from 'node:assert/strict';
import { MathMorph } from '../dist/morph/math.js';
import { Morph } from '../dist/morph/objects.js';
import { mathBodies } from '../dist/morph/math-bodies.js';
import { volumeField } from '../dist/viewport/morph/field.js';

function field(frame) {
  const body = mathBodies(frame, false);
  const result = volumeField(
    body.sources.map((p) => p.shape),
    body.targets.map((p) => p.shape),
  );
  result.update(body);
  return result;
}
const operations = [
  MathMorph.formula('sum(partition(x,3)*2)', { x: MathMorph.body(6, Morph.capsule(0.62, 2.8)) }),
  MathMorph.formula('sqrt(a^2+b^2)', {
    a: MathMorph.body(3, Morph.box([1.4, 1.4, 1.4])),
    b: MathMorph.body(4, Morph.sphere(0.7)),
  }),
  MathMorph.formula('1/(1+exp(-x))', { x: 2 }),
  MathMorph.formula('A * B', {
    A: [
      [1, 2],
      [3, 4],
    ],
    B: [
      [2, 1],
      [1, 3],
    ],
  }),
  MathMorph.formula(
    'sum(expand(x))',
    { x: [1, 2, 3] },
    { functions: { expand: () => [1, 2, 3, 4, 5] } },
  ),
  MathMorph.formula(
    'sum(reduce(x))',
    { x: [1, 2, 3, 4, 5] },
    { functions: { reduce: () => [2, 4, 9] } },
  ),
];
test('formula stages retain the exact visible surface through forward and backward handoffs', () => {
  for (const op of operations)
    for (const columns of [2, 4]) {
      const plan = MathMorph.plan(op);
      for (let stage = 1; stage < plan.stages; stage++) {
        const before = field(plan.sample((stage - 1e-8) / plan.stages, { columns }));
        const after = field(plan.sample(stage / plan.stages, { columns }));
        for (let x = -9; x <= 9; x += 0.3)
          for (let y = -5; y <= 5; y += 0.4) {
            assert.ok(
              Math.abs(before.distance(x, y, 0) - after.distance(x, y, 0)) < 2e-5,
              `${op.expression}: stage ${stage}, ${columns} columns at ${x}/${y}`,
            );
          }
      }
      const saved = plan.sample(0.31, { columns });
      plan.sample(0.9, { columns });
      plan.sample(0, { columns });
      assert.deepEqual(plan.sample(0.31, { columns }), saved);
    }
});
test('independent material clocks equal the union of their separately rendered fields', () => {
  const plan = MathMorph.plan(operations[4]);
  for (const p of [0.04, 0.15, 0.25, 0.36]) {
    const body = mathBodies(plan.sample(p), false),
      combined = field(plan.sample(p));
    const separate = Object.entries(body.materials).map(([id, state]) => {
      const sources = body.sources.filter((part) => part.material === id);
      const targets = body.targets.filter((part) => part.material === id);
      const material = volumeField(
        sources.map((p) => p.shape),
        targets.map((p) => p.shape),
      );
      material.update({ sources, targets, ...state });
      return material;
    });
    for (let x = -8; x <= 8; x += 0.3)
      for (let y = -3; y <= 3; y += 0.3)
        assert.ok(
          Math.abs(
            combined.distance(x, y, 0) - Math.min(...separate.map((f) => f.distance(x, y, 0))),
          ) < 1e-6,
        );
  }
});
test('formulas show arithmetic with the visible values and do not present partition as scalar division', () => {
  const plan = MathMorph.plan(operations[0]);
  assert.equal(plan.sample(0).formula, '6 → 3 части');
  assert.equal(plan.sample(0.32).formula, '6 = 2 + 2 + 2');
  assert.equal(plan.sample(1).formula, '4 + 4 + 4 = 12');
});
test('responsive envelopes contain every moving material, including row reflow and contact', () => {
  const operations = [
    MathMorph.formula(
      'det(A)',
      {
        A: [
          [2, 1],
          [1, 3],
        ],
      },
      { measure: 'value' },
    ),
    MathMorph.formula('sum(partition(x,3)*2)', { x: 6 }),
    MathMorph.formula(
      'sum(expand(x))',
      { x: [1, 2, 3] },
      { functions: { expand: () => [1, 2, 3, 4, 5] } },
    ),
  ];
  for (const op of operations)
    for (const columns of [1, 2, 4]) {
      const plan = MathMorph.plan(op),
        bounds = plan.boundsFor(columns);
      for (let step = 0; step <= 60; step++) {
        const surface = field(plan.sample(step / 60, { columns }));
        for (let axis = 0; axis < 3; axis++) {
          assert.ok(
            surface.bounds.min.getComponent(axis) >= bounds[0][axis] - 1e-6,
            `${op.expression}, ${columns} cols, ${step}/60, min ${axis}`,
          );
          assert.ok(
            surface.bounds.max.getComponent(axis) <= bounds[1][axis] + 1e-6,
            `${op.expression}, ${columns} cols, ${step}/60, max ${axis}`,
          );
        }
      }
    }
});
test('independent operands keep one material owner and no change of their own shape', () => {
  const plan = MathMorph.plan(operations[1]);
  for (let i = 0; i <= 24; i++) {
    const frame = plan.sample(i / 100);
    const passive = frame.sources.filter((p) => p.material?.startsWith('passive:'));
    for (const p of passive)
      assert.deepEqual(
        frame.targets.find((t) => t.material === p.material),
        p,
      );
    field(frame);
  }
});
test('volume encoding preserves exact endpoint amounts for primitive shapes', () => {
  const plan = MathMorph.plan(operations[0]);
  assert.equal(plan.measure, 'volume');
  const final = plan.sample(1).targets[0];
  assert.equal(final.value, 12);
  const input = plan.sample(0).targets[0];
  const volume = (p) =>
    Math.PI * p.shape.radius ** 2 * (p.shape.length - 2 * p.shape.radius) +
    (4 * Math.PI * p.shape.radius ** 3) / 3;
  assert.ok(Math.abs(volume(final) / volume(input) - 2) < 1e-10);
  assert.equal(MathMorph.plan(operations[2]).measure, 'value');
});
