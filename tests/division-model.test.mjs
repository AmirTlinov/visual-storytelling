import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: ['src/math/division.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const { divisionState, divisionItemId, divisionGroupId, divisionProgress } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

test('integer division includes zero, smaller collections, exact groups and safe-integer extremes', () => {
  for (const [count, divisor] of [
    [0, 3],
    [2, 3],
    [3, 3],
    [23, 3],
    [24, 3],
    [25, 3],
    [36, 1],
    [Number.MAX_SAFE_INTEGER, 3],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  ]) {
    const state = divisionState(count, divisor);
    assert.equal(state.count, state.quotient * state.divisor + state.remainder);
    assert.ok(state.remainder >= 0 && state.remainder < state.divisor);
    assert.deepEqual(structuredClone(state), state);
  }
  assert.deepEqual(
    [23, 24, 25].map((n) => {
      const s = divisionState(n, 3);
      return [s.quotient, s.remainder];
    }),
    [
      [7, 2],
      [8, 0],
      [8, 1],
    ],
  );
});

test('regrouping conserves all objects before, inside and after every completed group', () => {
  for (let count = 0; count <= 36; count++)
    for (let divisor = 1; divisor <= 12; divisor++) {
      const state = divisionState(count, divisor);
      const times = new Set([0, 0.5, 1]);
      for (let group = 1; group <= state.quotient; group++) {
        const boundary = group / state.quotient;
        times.add(Math.max(0, boundary - 1e-8));
        times.add(boundary);
        times.add(Math.min(1, boundary + 1e-8));
      }
      for (const progress of times) {
        const frame = divisionProgress(state, progress);
        assert.equal(count, frame.completedGroups * divisor + frame.ungrouped);
        assert.ok(Number.isSafeInteger(frame.completedGroups));
        assert.ok(frame.ungrouped >= state.remainder);
        if (frame.complete) assert.equal(frame.ungrouped, state.remainder);
        assert.deepEqual(divisionProgress(state, progress), frame);
      }
    }
});

test('item identity survives count and divisor edits; group identity includes its membership rule', () => {
  const before = divisionState(23, 3, { id: 'sample' });
  const more = divisionState(24, 3, { id: 'sample' });
  const different = divisionState(23, 4, { id: 'sample' });
  for (let i = 0; i < before.count; i++) {
    assert.equal(divisionItemId(before, i), divisionItemId(more, i));
    assert.equal(divisionItemId(before, i), divisionItemId(different, i));
  }
  assert.equal(divisionGroupId(before, 0), divisionGroupId(more, 0));
  assert.notEqual(divisionGroupId(before, 0), divisionGroupId(different, 0));
  assert.throws(() => divisionItemId(before, 23), /outside/);
  assert.throws(() => divisionGroupId(before, 7), /outside/);
});

test('invalid arithmetic and progress fail before a frame can be accepted', () => {
  for (const count of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => divisionState(count, 3), /count/);
  for (const divisor of [-1, 0, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => divisionState(23, divisor), /divisor/);
  assert.throws(() => divisionState(23, 3, { id: ' ' }), /ID/);
  for (const progress of [-0.1, 1.1, NaN, Infinity])
    assert.throws(() => divisionProgress(divisionState(23, 3), progress), /progress/);
});
