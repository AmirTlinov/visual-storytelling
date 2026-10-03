import test from 'node:test';
import assert from 'node:assert/strict';
import { Morph } from '../dist/morph/objects.js';
import { volumeField } from '../dist/viewport/morph/field.js';

const visibleEndpoint = (frame) => {
  assert.ok(frame.morph === 0 || frame.morph === 1);
  return frame.morph === 0 ? frame.sources : frame.targets;
};
const identity = (objects) => objects.map(({ shape, text }) => ({ shape, text }));
const fieldFor = (plan) => {
  const frame = plan.sample(0);
  return volumeField(
    frame.sources.map((p) => p.shape),
    frame.targets.map((p) => p.shape),
  );
};

test('written operations preserve their endpoint bodies and inscriptions through arbitrary seeks', () => {
  const parts = [
    Morph.box([0.7, 1.2, 0.4], 'Свет'),
    Morph.sphere(0.55, 'Тень'),
    Morph.box([1.3, 0.6, 0.8], 0),
  ];
  const whole = Morph.capsule(0.65, 3.5, 'Объём');
  for (const operation of [
    Morph.transform(parts[0], whole),
    Morph.merge(parts, whole),
    Morph.split(whole, parts),
  ]) {
    const plan = Morph.plan(operation);
    assert.deepEqual(identity(visibleEndpoint(plan.sample(0))), identity(operation.sources));
    assert.deepEqual(identity(visibleEndpoint(plan.sample(1))), identity(operation.targets));
    assert.deepEqual(plan.sample(-1), plan.sample(0));
    assert.deepEqual(plan.sample(2), plan.sample(1));
    const before = structuredClone(plan.sample(0.413));
    const field = fieldFor(plan);
    for (const p of [1, 0.2, 0.413, 0.75, 0, 0.94]) {
      field.update(plan.sample(p));
      for (let axis = 0; axis < 3; axis++) {
        assert.ok(field.bounds.min.getComponent(axis) >= plan.bounds[0][axis] - 1e-6);
        assert.ok(field.bounds.max.getComponent(axis) <= plan.bounds[1][axis] + 1e-6);
      }
    }
    assert.deepEqual(
      plan.sample(0.413),
      before,
      'seeking must not change a later visit to the same frame',
    );
    for (const p of [NaN, Infinity, -Infinity]) assert.throws(() => plan.sample(p), /finite/);
  }
});

test('splitting reverses the actual contact surface of the corresponding merge', () => {
  const scenarios = [
    [[Morph.sphere(0.5, 1), Morph.sphere(0.5, 2)], Morph.capsule(0.5, 2, 3)],
    [[Morph.box([1, 1, 0.8], 'А'), Morph.sphere(0.5, 'Б')], Morph.capsule(0.6, 2.2, 'АБ')],
    [
      [Morph.box([1, 1, 1], 2), Morph.box([1, 1, 1], 2), Morph.box([1, 1, 1], 2)],
      Morph.box([3, 1, 1], 6),
    ],
  ];
  for (const [parts, whole] of scenarios) {
    const merging = Morph.plan(Morph.merge(parts, whole));
    const splitting = Morph.plan(Morph.split(whole, parts));
    const forward = fieldFor(merging),
      backward = fieldFor(splitting);
    for (const p of [0, 0.15, 0.29, 0.3, 0.41, 0.6, 0.9, 1]) {
      forward.update(merging.sample(p));
      backward.update(splitting.sample(1 - p));
      for (const x of [-1.5, -0.5, 0, 0.5, 1.5])
        for (const y of [0, 0.2, 0.55])
          for (const z of [0, 0.35])
            assert.ok(
              Math.abs(forward.distance(x, y, z) - backward.distance(x, y, z)) < 1e-6,
              `contact must survive reversed playback at progress ${p}, point ${x},${y},${z}`,
            );
    }
  }
});

test('a malformed measurement grid is rejected before a renderer can enter its line loop', () => {
  const box = Morph.box([1, 1, 1], 1);
  for (const grid of [-1, NaN, Infinity, 1e-12])
    assert.throws(() => Morph.plan(Morph.transform({ ...box, grid }, box)), /grid|step|lines/);
  assert.doesNotThrow(() => Morph.plan(Morph.transform({ ...box, grid: 0.25 }, box)));
});
