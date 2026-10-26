import test from 'node:test';
import assert from 'node:assert/strict';
import { fractionState } from '../dist/recipes/fractions-model.js';
import { fractionsMotion } from '../dist/recipes/fractions-motion.js';
import { rationalNumber } from '../dist/math/rational.js';
import { MathMorph } from '../dist/morph/math.js';
function layout(state) {
  const width = 240,
    height = 20,
    cell = width / state.denominator;
  const sorted = state.parts
    .filter((part) => part.container === 'result')
    .sort(
      (a, b) =>
        Number(a.origins[0].id === state.roots[1].id) -
        Number(b.origins[0].id === state.roots[1].id),
    );
  const offsets = new Map(sorted.map((part, index) => [part.id, index]));
  const counts = { left: 0, right: 0 };
  return state.parts.map((part) => {
    const side = part.origins[0].id === state.roots[1].id ? 'right' : 'left';
    const index = part.copiedFrom ? Number(part.copiedFrom.split(':').at(-1)) : counts[side]++;
    const from = [index * cell, (side === 'left' ? 0 : 50) + (part.copiedFrom ? 22 : 0)];
    const i = offsets.get(part.id);
    const to =
      i === undefined
        ? from
        : [(i % state.denominator) * cell, 100 + Math.floor(i / state.denominator) * 50];
    return {
      id: part.id,
      from,
      to,
      width: width * rationalNumber(part.amount),
      height,
      side,
      moving: part.container === 'result',
    };
  });
}
test('MathMorph geometry preserves calibrated area and every material identity without occlusion during every move', () => {
  for (const [a, b, c, d] of [
    [1, 2, 1, 3],
    [1, 1, 1, 1],
    [7, 8, 11, 12],
    [0, 2, 1, 3],
    [1, 2, 0, 3],
  ])
    for (const action of ['move', 'copy']) {
      const state = fractionState(
        { leftNumerator: a, leftDenominator: b, rightNumerator: c, rightDenominator: d, action },
        2,
      );
      const pieces = layout(state);
      const plan = fractionsMotion(state, pieces);
      assert.equal(MathMorph.plan(plan), plan);
      assert.ok(Math.abs(plan.result - rationalNumber(state.total)) < 1e-12);
      for (let step = 0; step <= 200; step++) {
        const frame = plan.sample(step / 200);
        assert.deepEqual(
          frame.sources.map((part) => part.id),
          state.parts.map((part) => part.id),
        );
        for (const part of frame.sources)
          for (const origin of part.origins) {
            assert.equal(origin.value, origin.source.value);
            assert.equal(origin.value, rationalNumber(state.roots[origin.operand].amount));
            assert.deepEqual(origin.source.address, [origin.operand]);
          }
        const area = frame.sources.reduce((sum, part) => sum + part.size[0] * part.size[1], 0);
        assert.ok(Math.abs(area - rationalNumber(state.total) * 240 * 20) < 1e-8);
        for (let i = 0; i < frame.sources.length; i++)
          for (let j = i + 1; j < frame.sources.length; j++) {
            const p = frame.sources[i],
              q = frame.sources[j];
            const overlapX =
              Math.min(p.position[0] + p.size[0] / 2, q.position[0] + q.size[0] / 2) -
              Math.max(p.position[0] - p.size[0] / 2, q.position[0] - q.size[0] / 2);
            const overlapY =
              Math.min(p.position[1] + p.size[1] / 2, q.position[1] + q.size[1] / 2) -
              Math.max(p.position[1] - p.size[1] / 2, q.position[1] - q.size[1] / 2);
            assert.ok(
              overlapX < 1e-8 || overlapY < 1e-8,
              JSON.stringify({ a, b, c, d, action, step, p: p.id, q: q.id, overlapX, overlapY }),
            );
          }
      }
      assert.deepEqual(plan.sample(0.45), plan.sample(0.45));
    }
});
