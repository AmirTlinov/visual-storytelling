import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cueSheet } from '../dist/story/cues.js';
import { regroup, swap } from '../dist/recipes/tokens.js';
import { areaAt } from '../examples/area/model.ts';
import { comparisons, sortingAt } from '../examples/sort/model.ts';
import { oscillator } from '../examples/lc/model.ts';
import { transform } from '../examples/vector/model.ts';
import { memoryAt } from '../examples/transfer/model.ts';

test('spoken dimensions and paper units follow their own words in either seek direction', () => {
  const script = JSON.parse(
    readFileSync(new URL('../examples/area/narration.json', import.meta.url), 'utf8'),
  );
  const sheet = cueSheet(script);
  const states = [6.3, 18.4, 48.2, 2, 4.3, 6.3].map((time) => areaAt(sheet.at(time)));
  assert.deepEqual(states[0], states[5]);
  assert.equal(states[3]!.heightText, 0);
  assert.equal(states[4]!.heightText, 1);
  assert.equal(states[4]!.widthText, 0);
  assert.equal(states[1]!.squares.filter((n) => n > 0).length, 1);
  assert.equal(states[2]!.squares.filter((n) => n > 0).length, 20);
  assert.throws(
    () => cueSheet({ duration: 1, cues: { bad: { start: 2, end: 3 } } }),
    /Invalid cue/,
  );
  assert.throws(() => sheet.get('missing'), /Unknown cue/);
});
test('regrouping and swapping preserve identities and endpoints', () => {
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
    swap(before[0], before[1], 1).map((p) => p.map((v) => Math.round(v))),
    [
      [10, 0],
      [0, 0],
    ],
  );
  assert.throws(() => regroup(before, [], 0.5), /preserve/);
});
test('sorting keeps identities and handles equal and negative values', () => {
  for (const values of [
    [5, 2, 4, 1, 3],
    [2, 2, 1],
    [-3, 1, -7],
  ]) {
    const sequence = comparisons(values);
    const final = sortingAt(sequence, sequence.steps.length * 3 + 1);
    assert.deepEqual(
      final.order.map((item) => item.value),
      [...values].sort((a, b) => a - b),
    );
    assert.equal(new Set(final.order.map((item) => item.id)).size, values.length);
  }
});
test('LC energy is conserved and matrix output uses the current inputs', () => {
  for (let time = 0; time < 12; time += 0.071) {
    const state = oscillator(time, 6);
    assert.ok(Math.abs(state.electric + state.magnetic - 1) < 1e-12);
  }
  assert.deepEqual(transform({ x: 1.5, y: -1, a: -2, b: 0.5 }), { x: -3, y: -0.5 });
});
test('shared memory changes only when writes arrive and CPU waits for completion', () => {
  assert.deepEqual(memoryAt(4).memory, ['—', '—', '—', '—']);
  assert.deepEqual(memoryAt(6).memory, [3, 5, 7, 9]);
  assert.deepEqual(memoryAt(16).memory, [3, 5, 7, 9]);
  assert.deepEqual(memoryAt(18).memory, [6, 10, 14, 18]);
  assert.equal(memoryAt(19).completed, false);
  assert.equal(memoryAt(21).completed, true);
  assert.deepEqual(memoryAt(22).cpu, [3, 5, 7, 9]);
  assert.deepEqual(memoryAt(24).cpu, [6, 10, 14, 18]);
});
