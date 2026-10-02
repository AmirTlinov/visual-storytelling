import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cueSheet } from '../dist/story/cues.js';
import { regroup, swap } from '../dist/recipes/tokens.js';
import { transform } from '../examples/vector/model.ts';
test('word intervals preserve timing across reverse seeking and reject invalid cues', () => {
  const sheet = cueSheet({
    duration: 6,
    cues: { height: { start: 1, end: 2 }, width: { start: 3, end: 4 } },
  });
  const before = sheet.at(1.5);
  sheet.at(5);
  const reverse = sheet.at(1.5);
  assert.equal(reverse.progress('height'), before.progress('height'));
  assert.equal(reverse.has('width'), false);
  assert.throws(
    () => cueSheet({ duration: 1, cues: { bad: { start: 2, end: 3 } } }),
    /Invalid cue/,
  );
  assert.throws(() => Reflect.apply(sheet.get, undefined, ['missing']), /Unknown cue/);
});
test('grouping preserves identities and endpoint positions', () => {
  const before = [
      [0, 0],
      [10, 0],
    ] as const,
    after = [
      [30, 40],
      [-10, 0],
    ] as const;
  assert.deepEqual(regroup(before, after, 0), before);
  assert.deepEqual(regroup(before, after, 1), after);
  assert.deepEqual(swap(before[0], before[1], 0), before);
  assert.deepEqual(
    swap(before[0], before[1], 1).map((p) => p.map(Math.round)),
    [
      [10, 0],
      [0, 0],
    ],
  );
  assert.throws(() => regroup(before, [], 0.5), /preserve/);
});
test('matrix output uses both independent coefficients', () =>
  assert.deepEqual(transform({ x: 1.5, y: -1, a: -2, b: 0.5 }), { x: -3, y: -0.5 }));
