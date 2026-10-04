import test from 'node:test';
import assert from 'node:assert/strict';
import { MathMorph } from '../dist/morph/math.js';
import { cellLayout } from '../dist/morph/layout.js';
import { mathMotionFrame, morphTiming } from '../dist/morph/timing.js';
import { cueSheet } from '../dist/story/cues.js';

const operation = () =>
  MathMorph.chain(
    MathMorph.dot([2, -1, 0], [-0.5, 3, 2]),
    { operator: 'add', value: 3 },
    { operator: 'apply', label: 'ReLU', value: (x) => Math.max(0, x) },
    { operator: 'multiply', value: 2 },
  );

test('a computed result becomes the same body and provenance at every following step', () => {
  const plan = MathMorph.plan(operation());
  assert.equal(plan.result, 0);
  assert.equal(plan.stages, 5);
  for (const columns of [1, 2, 3]) {
    for (let stage = 1; stage < plan.stages; stage++) {
      const before = plan.sample((stage - 1e-9) / plan.stages, { columns });
      const after = plan.sample(stage / plan.stages, { columns });
      assert.deepEqual(after.sources, before.targets);
    }
  }
  const frame = structuredClone(plan.sample(0.73));
  for (const p of [1, 0, 0.15, 0.9]) plan.sample(p);
  assert.deepEqual(plan.sample(0.73), frame);
  assert.throws(
    () =>
      MathMorph.plan(
        MathMorph.chain(MathMorph.calculate('add', 1, 2), {
          operator: 'apply',
          label: 'f',
          value: () => Infinity,
        }),
      ),
    /finite/,
  );
  assert.throws(
    () =>
      MathMorph.plan(MathMorph.chain(MathMorph.vectorAdd([1], [2]), { operator: 'add', value: 1 })),
    /scalar/,
  );
});

test('reduced motion and continuous motion disclose each result at the same narrative instant', () => {
  const plan = MathMorph.plan(operation());
  const cues = Object.fromEntries(
    Array.from({ length: plan.stages }, (_, i) => [String(i), { start: i * 10, end: i * 10 + 8 }]),
  );
  const sheet = cueSheet({ duration: 50, cues });
  for (let i = 0; i < plan.stages; i++) {
    for (const offset of [0, 2, 6, 7.19, 7.21, 8, 9]) {
      const at = (reduced) =>
        mathMotionFrame(
          plan,
          morphTiming(sheet.at(i * 10 + offset, reduced), Object.keys(cues), plan.stages),
        );
      const moving = at(false),
        still = at(true);
      assert.equal(still.stage, moving.stage);
      assert.deepEqual(still.result, moving.result);
      assert.equal(still.result !== undefined, offset >= 7.2);
      assert.ok(still.morph === 0 || still.morph === 1);
      assert.equal(still.formula.includes('='), moving.formula.includes('='));
    }
  }
});

test('narrow arithmetic wraps pairs without shrinking cells or colliding inscriptions', () => {
  const plan = MathMorph.plan(MathMorph.dot([1, 2, 3, 4], [5, 6, 7, 8]));
  const layout = cellLayout(plan, 343);
  assert.equal(layout.columns, 2);
  assert.ok(layout.scale * 1.4 >= 60, 'cells remain readable');
  for (let i = 0; i <= 100; i++) {
    const frame = plan.sample(i / 100, { columns: layout.columns });
    const notes = frame.notes.filter((n) => !n.id.startsWith('operator:') && n.opacity > 0.01);
    for (let a = 0; a < notes.length; a++)
      for (let b = a + 1; b < notes.length; b++) {
        assert.ok(
          [0, 1].some(
            (axis) =>
              Math.abs(notes[a].position[axis] - notes[b].position[axis]) >=
              (notes[a].size[axis] + notes[b].size[axis]) / 2,
          ),
          'provenance notes do not overlap',
        );
      }
    for (const note of frame.notes.filter((n) => n.opacity > 0.01))
      for (const part of frame.sources) {
        assert.ok(
          [0, 1].some(
            (axis) =>
              Math.abs(note.position[axis] - part.position[axis]) >=
              (note.size[axis] + part.size[axis]) / 2,
          ),
          'notes do not cross a body',
        );
      }
  }
});

test('one speech interval can cover consecutive stages and holds before the next cue', () => {
  const sheet = cueSheet({
    duration: 30,
    cues: { a: { start: 0, end: 10 }, b: { start: 20, end: 30 } },
  });
  assert.ok(Math.abs(morphTiming(sheet.at(5), ['a', 'a', 'b'], 3).progress - 1 / 3) < 1e-9);
  const held = morphTiming(sheet.at(15), ['a', 'a', 'b'], 3).progress;
  assert.ok(held < 2 / 3 && held > 0.66);
  assert.throws(() => morphTiming(sheet.at(5), ['a', 'b', 'a'], 3), /consecutive/);
  const plan = MathMorph.plan(MathMorph.exponential(0, 2, 2));
  assert.equal(mathMotionFrame(plan, { progress: 1, reduced: true }).result, 4);
});
