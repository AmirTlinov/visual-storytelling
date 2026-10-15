import test from 'node:test';
import assert from 'node:assert/strict';
import { MathMorph } from '../dist/morph/math.js';
import { mathPlan } from '../dist/morph/plan.js';
import { calculationFraming } from '../dist/morph/scene-framing.js';

test('deforming quantity and vector bodies stay within their analytic framing through reverse seeks', () => {
  for (const operation of [MathMorph.multiply(2, 5), MathMorph.vectorAdd([1, 2], [3, 4])]) {
    const plan = mathPlan(operation);
    for (const p of [0.25, 0.9, 0, 1, 0.5, 0.25]) {
      const frame = plan.sample(p),
        bounds = calculationFraming(plan, frame, p);
      for (const part of [...frame.sources, ...frame.targets])
        for (let axis = 0; axis < 3; axis++) {
          const key = ['x', 'y', 'z'][axis],
            half = (part.size[axis] * (part.scale?.[axis] ?? 1)) / 2;
          assert.ok(part.position[axis] - half >= bounds.min[key] - 1e-7);
          assert.ok(part.position[axis] + half <= bounds.max[key] + 1e-7);
        }
    }
  }
});

test('framing uses the exact responsive arrangement chosen by the mathematical drawing', async () => {
  const { cellLayout } = await import('../dist/morph/layout.js');
  for (const operation of [
    MathMorph.dot([1, 2, 3, 4], [5, 6, 7, 8]),
    MathMorph.vectorAdd([1, 2, 3, 4], [5, 6, 7, 8]),
    MathMorph.formula('x+y', { x: [1, 2, 3, 4], y: [5, 6, 7, 8] }, { measure: 'value' }),
  ]) {
    const plan = mathPlan(operation);
    for (const width of [300, 1800, 300]) {
      const arrangement = cellLayout(plan, width);
      for (const p of [0.1, 0.7, 0.1]) {
        const frame = plan.sample(p, { columns: arrangement.columns }),
          bounds = calculationFraming(plan, frame, p, { arrangement });
        for (const part of [...frame.sources, ...frame.targets])
          for (let axis = 0; axis < 3; axis++) {
            const key = ['x', 'y', 'z'][axis],
              half = (part.size[axis] * (part.scale?.[axis] ?? 1)) / 2;
            assert.ok(
              part.position[axis] - half >= bounds.min[key] - 1e-7,
              `${plan.encoding}/${width}/${p}/min${key}`,
            );
            assert.ok(
              part.position[axis] + half <= bounds.max[key] + 1e-7,
              `${plan.encoding}/${width}/${p}/max${key}`,
            );
          }
      }
    }
  }
});
