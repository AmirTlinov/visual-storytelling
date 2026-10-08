import test from 'node:test';
import assert from 'node:assert/strict';
import { TensorData } from '../dist/math/tensor.js';
import { MathMorph } from '../dist/morph/math.js';
import { Morph } from '../dist/morph/objects.js';
import { compileExpression } from '../dist/morph/formula/expression.js';
import { mathSemantics } from '../dist/morph/semantics.js';

const source = (values = Array.from({ length: 24 }, (_, i) => i + 1)) =>
  new TensorData({ id: 'readings', shape: [2, 3, 4], values });
const selected = (tensor) => tensor.transpose([2, 0, 1]).slice(0, 2).reshape([6]);
const originalAddresses = [
  [0, 0, 2],
  [0, 1, 2],
  [0, 2, 2],
  [1, 0, 2],
  [1, 1, 2],
  [1, 2, 2],
];
const weights = () => new TensorData({ id: 'weights', shape: [6], values: [1, -1, 2, -2, 3, -3] });

test('a transposed, sliced and reshaped tensor keeps original cell addresses through batched dot and a carried result', () => {
  const readings = selected(source()),
    coefficients = weights();
  const operation = MathMorph.dot(readings, coefficients),
    plan = MathMorph.plan(operation),
    raw = MathMorph.plan(MathMorph.dot([3, 7, 11, 15, 19, 23], coefficients.values));
  assert.equal(plan.result, -24);
  assert.equal(plan.stages, raw.stages);
  const origins = plan.sample(1).targets[0].origins;
  assert.deepEqual(
    origins.filter((origin) => origin.operand === 0),
    originalAddresses.map((address, index) => ({
      operand: 0,
      index,
      value: 3 + 4 * index,
      source: { tensor: 'readings', address, index: 2 + 4 * index, value: 3 + 4 * index },
    })),
  );
  assert.deepEqual(
    origins.filter((origin) => origin.operand === 1).map((origin) => origin.source.address),
    Array.from({ length: 6 }, (_, i) => [i]),
  );
  const withoutTensorOrigins = (frame) => ({
    ...frame,
    sources: frame.sources.map(strip),
    targets: frame.targets.map(strip),
  });
  const strip = (part) => ({
    ...part,
    origins: part.origins.map(({ source: _, ...origin }) => origin),
  });
  for (const progress of [0, 0.14, 0.48, 0.51, 0.84, 1, 0.14])
    assert.deepEqual(withoutTensorOrigins(plan.sample(progress)), raw.sample(progress));

  const chain = MathMorph.plan(MathMorph.chain(operation, { operator: 'add', value: 5 }));
  assert.equal(chain.result, -19);
  assert.deepEqual(chain.sample(1).targets[0].origins, origins);
});

test('vector addition uses the same arithmetic and preserves mixed tensor and plain-array inputs', () => {
  const readings = selected(source()),
    plain = [1, 2, 3, 4, 5, 6];
  const plan = MathMorph.plan(MathMorph.vectorAdd(readings, plain));
  plain.fill(999);
  assert.deepEqual(plan.result, [4, 9, 14, 19, 24, 29]);
  assert.deepEqual(
    plan.sample(1).targets.map((target) => target.origins),
    originalAddresses.map((address, index) => [
      {
        operand: 0,
        index,
        value: 3 + 4 * index,
        source: { tensor: 'readings', address, index: 2 + 4 * index, value: 3 + 4 * index },
      },
      { operand: 1, index, value: index + 1 },
    ]),
  );
  const raw = MathMorph.plan(MathMorph.dot([2, -1, 0], [-0.5, 3, 2]));
  assert.equal(raw.result, -4);
  assert.deepEqual(raw.sample(1).targets[0].origins, [
    { operand: 0, index: 0, value: 2 },
    { operand: 1, index: 0, value: -0.5 },
    { operand: 0, index: 1, value: -1 },
    { operand: 1, index: 1, value: 3 },
    { operand: 0, index: 2, value: 0 },
    { operand: 1, index: 2, value: 2 },
  ]);
});

test('formula inputs and authored bodies use tensor values and retain original leaf provenance', () => {
  const matrix = selected(source()).reshape([2, 3]),
    vector = new TensorData({ id: 'coefficient', shape: [3], values: [1, 2, 3] });
  const operation = MathMorph.formula(
    'A * v',
    { A: MathMorph.body(matrix, Morph.box([1, 1, 1])), v: vector },
    { measure: 'value' },
  );
  const compiled = compileExpression(operation);
  assert.deepEqual(compiled.result, [50, 122]);
  assert.deepEqual(
    compiled.initial
      .filter((body) => body.origins[0].operand === 0)
      .map((body) => body.origins[0].source.address),
    originalAddresses,
  );
  for (const output of compiled.steps.at(-1).outputs)
    assert.deepEqual(
      output.origins
        .filter((origin) => origin.operand === 0)
        .map((origin) => origin.source.address),
      originalAddresses,
      'a generic matrix output carries the complete truthful input dependency set',
    );
  const plan = MathMorph.plan(operation);
  assert.deepEqual(plan.result, [50, 122]);
  assert.deepEqual(plan.sample(1).result, [50, 122]);

  const volume = source();
  assert.deepEqual(MathMorph.plan(MathMorph.formula('T', { T: volume })).result, volume.toValue());
  const scalar = volume.slice(0, 1).slice(0, 2).slice(0, 3);
  const scalarExpression = compileExpression(MathMorph.formula('x ^ 2', { x: scalar }));
  assert.equal(scalarExpression.result, 576);
  assert.deepEqual(scalarExpression.steps.at(-1).outputs[0].origins[0].source, {
    tensor: 'readings',
    address: [1, 2, 3],
    index: 23,
    value: 24,
  });
});

test('selected arithmetic results and operation roots expose original tensor cell IDs after a direct seek and a new snapshot', () => {
  let operation = MathMorph.dot(selected(source()), weights());
  const semantics = mathSemantics('calculation', 'src/morph/three.ts', () => operation);
  semantics.update(MathMorph.plan(operation).sample(1));
  const expectedIds = [
    ...originalAddresses.map((address) => `readings:${address.join(',')}`),
    ...Array.from({ length: 6 }, (_, i) => `weights:${i}`),
  ];
  assert.deepEqual(new Set(semantics.meaning.inputs()), new Set(expectedIds));
  const result = semantics.parts.get('calculation:result');
  assert.equal(result.visible, true);
  assert.equal(result.meaning.value(), -24);
  assert.deepEqual(new Set(result.meaning.inputs()), new Set(expectedIds));
  assert.deepEqual(
    result.meaning
      .provenance()
      .origins.filter((origin) => origin.operand === 0)
      .map((origin) => origin.source.address),
    originalAddresses,
  );

  const changedValues = Array.from({ length: 24 }, (_, i) => i + 1);
  changedValues[2] = 103;
  operation = MathMorph.dot(selected(source(changedValues)), weights());
  semantics.clear();
  semantics.update(MathMorph.plan(operation).sample(1));
  const updated = semantics.parts.get('calculation:result');
  assert.equal(updated.meaning.value(), 76);
  assert.deepEqual(new Set(updated.meaning.inputs()), new Set(expectedIds));
  assert.equal(updated.meaning.provenance().origins[0].source.value, 103);
  assert.equal(result.meaning.value(), -24, 'the earlier snapshot still describes its own values');
});

test('tensor operations reject unsuitable ranks and retain the existing finite rendering limits', () => {
  const scalar = new TensorData({ id: 'scalar', shape: [], values: [3] });
  const matrix = new TensorData({ id: 'matrix', shape: [1, 2], values: [1, 2] });
  for (const input of [scalar, matrix]) {
    assert.throws(() => MathMorph.plan(MathMorph.dot(input, [1, 2])), /rank-1/);
    assert.throws(() => MathMorph.plan(MathMorph.vectorAdd([1, 2], input)), /rank-1/);
  }
  const long = new TensorData({ id: 'long', shape: [65], values: Array(65).fill(1) });
  assert.throws(() => MathMorph.plan(MathMorph.dot(long, long)), /64/);
  assert.throws(() => MathMorph.plan(MathMorph.formula('sum(x)', { x: long })), /64/);
  assert.throws(() => MathMorph.plan(MathMorph.dot(weights(), [1])), /equally/);
});
