import test from 'node:test';
import assert from 'node:assert/strict';
import { TensorData, tensorOriginId } from '../dist/math/tensor.js';

test('a transposed slice and reshape retain original tensor identities and values', () => {
  const original = new TensorData({
    id: 'measurements',
    shape: [2, 3, 4],
    values: Array.from({ length: 24 }, (_, i) => i),
    axes: ['batch', 'row', 'feature'],
  });
  const transposed = original.transpose([2, 0, 1]);
  assert.deepEqual(transposed.shape, [4, 2, 3]);
  assert.deepEqual(transposed.axes, ['feature', 'batch', 'row']);
  const selected = transposed.slice(1, 1);
  assert.deepEqual(selected.shape, [4, 3]);
  assert.deepEqual(selected.axes, ['feature', 'row']);
  const reshaped = selected.reshape([2, 6], ['line', 'column']);
  const expected = [12, 16, 20, 13, 17, 21, 14, 18, 22, 15, 19, 23];
  assert.equal(reshaped.id, original.id);
  assert.equal(reshaped.size, 12);
  assert.deepEqual(reshaped.values, expected);
  assert.deepEqual(reshaped.toValue(), [expected.slice(0, 6), expected.slice(6)]);
  for (let index = 0; index < reshaped.size; index++) {
    const originalIndex = expected[index];
    const address = [1, Math.floor((originalIndex - 12) / 4), originalIndex % 4];
    assert.equal(reshaped.offset(reshaped.indices(index)), index);
    assert.equal(reshaped.at(...reshaped.indices(index)), originalIndex);
    assert.deepEqual(reshaped.origin(index), {
      tensor: 'measurements',
      address,
      index: originalIndex,
      value: originalIndex,
    });
    assert.equal(reshaped.originId(index), original.originId(originalIndex));
    assert.equal(reshaped.originId(index), tensorOriginId(reshaped.origin(index)));
  }
  assert.deepEqual(original.slice(1, 2).values, [8, 9, 10, 11, 20, 21, 22, 23]);
  assert.deepEqual(transposed.transpose([1, 2, 0]).toValue(), original.toValue());
});

test('scalars and signed small values preserve their exact numerical meaning', () => {
  const scalar = new TensorData({ id: 'coefficient', shape: [], values: [-0.00000004] });
  assert.equal(scalar.size, 1);
  assert.equal(scalar.at(), -0.00000004);
  assert.equal(scalar.offset([]), 0);
  assert.deepEqual(scalar.indices(0), []);
  assert.equal(scalar.toValue(), -0.00000004);
  assert.equal(scalar.originId(0), 'coefficient:scalar');
  assert.deepEqual(scalar.reshape([1]).values, [-0.00000004]);
  assert.equal(scalar.transpose([]), scalar);

  const vector = new TensorData({ id: 'signed', shape: [3], values: [0, -2, 1e-12] });
  const element = vector.slice(0, 2);
  assert.deepEqual(element.shape, []);
  assert.equal(element.at(), 1e-12);
  assert.equal(element.toValue(), 1e-12);
  assert.equal(element.originId(0), 'signed:2');
  assert.equal(vector.at(1), -2);
});

test('snapshots and derived selections stay immutable when input arrays change', () => {
  const shape = [2, 2];
  const values = [1, 2, 3, 4];
  const axes = ['row', 'column'];
  const original = new TensorData({ id: 'matrix', shape, values, axes });
  const selection = original.transpose([1, 0]).slice(0, 1);
  const nested = original.toValue();
  shape[0] = 4;
  values[1] = 200;
  axes[0] = 'changed';
  assert.deepEqual(original.shape, [2, 2]);
  assert.deepEqual(original.values, [1, 2, 3, 4]);
  assert.deepEqual(original.axes, ['row', 'column']);
  assert.deepEqual(selection.values, [2, 4]);
  assert.equal(selection.values, selection.values, 'Reuse immutable materialized values');
  assert.equal(selection.origin(0).value, 2);
  assert.throws(() => (original.id = 'changed'), TypeError);
  assert.throws(() => (selection.shape[0] = 20), TypeError);
  assert.throws(() => (selection.values[0] = 200), TypeError);
  assert.throws(() => (selection.axes[0] = 'changed'), TypeError);
  assert.throws(() => (selection.origin(0).address[0] = 20), TypeError);
  assert.throws(() => (nested[0][0] = 20), TypeError);

  const fresh = new TensorData({ id: 'matrix', shape: [2, 2], values }).transpose([1, 0]);
  assert.equal(fresh.at(1, 0), 200);
  assert.equal(fresh.originId(2), original.originId(1));
  assert.equal(selection.at(0), 2);
});

test('invalid shapes, values, axes and addresses fail before allocating selections', () => {
  const make = (options) => new TensorData({ id: 'invalid', shape: [1], values: [0], ...options });
  for (const shape of [[0], [-1], [1.5], [NaN], [Infinity], [2 ** 32], [2 ** 31, 2], Array(1)])
    assert.throws(() => make({ shape }), /dimensions|capacity/);
  for (const values of [[], [0, 1], [NaN], [Infinity], Array(1), [[1]]])
    assert.throws(() => make({ values }), /shape|finite/);
  assert.throws(() => make({ id: ' ' }), /id/);
  for (const axes of [[], [''], [' '], [undefined]]) assert.throws(() => make({ axes }), /axis/);
  assert.throws(() => make({ shape: [1, 1], axes: ['x', 'x'] }), /axis/);

  const tensor = new TensorData({ id: 'matrix', shape: [2, 2], values: [1, 2, 3, 4] });
  for (const address of [[], [1], [0, 0, 0], [2, 0], [-1, 0], [0.5, 0], [0, NaN]])
    assert.throws(() => tensor.offset(address), /coordinate/);
  for (const index of [-1, 4, 0.1, NaN, Infinity]) {
    assert.throws(() => tensor.indices(index), /index/);
    assert.throws(() => tensor.origin(index), /index/);
  }
  for (const [axis, index] of [
    [-1, 0],
    [2, 0],
    [0.5, 0],
    [0, -1],
    [0, 2],
    [0, 0.5],
  ])
    assert.throws(() => tensor.slice(axis, index), /slice/);
  for (const order of [[], [0], [0, 0], [0, 2], [1, 0.5], [1, NaN]])
    assert.throws(() => tensor.transpose(order), /permutation/);
  assert.throws(() => tensor.reshape([3]), /size/);
  assert.throws(() => tensor.reshape([4], ['x', 'y']), /axis/);
});

test('data sizes are independent of renderer limits and singleton ranks need no recursion', () => {
  const data = new TensorData({
    id: 'large-data',
    shape: [100, 100],
    values: Array.from({ length: 10_000 }, (_, i) => i),
  });
  assert.equal(data.transpose([1, 0]).at(99, 50), 5099);
  assert.equal(data.slice(0, 99).at(99), 9999);
  const singleton = new TensorData({ id: 'many-axes', shape: Array(1000).fill(1), values: [2] });
  let nested = singleton.toValue();
  for (let axis = 0; axis < 1000; axis++) {
    assert.equal(nested.length, 1);
    nested = nested[0];
  }
  assert.equal(nested, 2);
});
