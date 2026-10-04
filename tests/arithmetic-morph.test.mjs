import test from 'node:test';
import assert from 'node:assert/strict';
import { MathMorph } from '../dist/morph/math.js';
import { volumeBox, volumeField } from '../dist/viewport/morph/field.js';
import { fieldSection } from '../dist/viewport/morph/section.js';

const fieldAt = (frame) => {
  const box = volumeBox([1, 1, 1]);
  const field = volumeField(
    frame.sources.map(() => box),
    frame.targets.map(() => box),
  );
  const pose = (part) => ({ position: part.position, scale: part.size });
  field.update({
    sources: frame.sources.map(pose),
    targets: frame.targets.map(pose),
    morph: frame.morph,
    tension: frame.tension ?? 0,
  });
  return field;
};

test('signed dot product keeps zeros, original inputs and products through the two visible steps', () => {
  const plan = MathMorph.plan(MathMorph.dot([2, -1, 0], [-0.5, 3, 2]));
  assert.equal(plan.encoding, 'cells');
  assert.equal(plan.result, -4);
  const collecting = plan.sample(0.55);
  for (const source of collecting.sources) {
    const note = collecting.notes.find((note) => note.id === source.id);
    assert.equal(note.position[0], source.position[0]);
  }
  const products = plan.sample(0.499999).targets;
  assert.deepEqual(
    products.map((p) => p.value),
    [-1, -3, 0],
  );
  assert.deepEqual(plan.sample(0.5).sources, products);
  assert.deepEqual(plan.sample(1).targets[0].origins, [
    { operand: 0, index: 0, value: 2 },
    { operand: 1, index: 0, value: -0.5 },
    { operand: 0, index: 1, value: -1 },
    { operand: 1, index: 1, value: 3 },
    { operand: 0, index: 2, value: 0 },
    { operand: 1, index: 2, value: 2 },
  ]);
  const earlier = structuredClone(plan.sample(0.15));
  for (const p of [0.85, 0.5, 0.91, 0]) plan.sample(p);
  assert.deepEqual(plan.sample(0.15), earlier);
});

test('sources meet before their shared shape transforms', () => {
  for (const operation of [
    MathMorph.calculate('add', 1, 2, 3),
    MathMorph.dot([2, -1, 0], [-0.5, 3, 2]),
    MathMorph.vectorAdd([1, -2, 0], [-1, 4, 0]),
  ]) {
    const plan = MathMorph.plan(operation);
    for (let step = 0; step <= 100; step++) {
      const f = plan.sample(step / 100);
      if (f.phase === 'approach') {
        assert.equal(f.morph, 0, 'the shared contour waits for contact');
        assert.equal(f.tension, 0, 'separated cells carry no contact tension');
        const a = f.sources[0],
          b = f.sources[f.targets.length > 1 ? f.targets.length : 1];
        const middle = a.position.map((v, axis) => (v + b.position[axis]) / 2);
        const gap = Math.max(
          ...a.position.map(
            (v, axis) => Math.abs(v - b.position[axis]) - (a.size[axis] + b.size[axis]) / 2,
          ),
        );
        // A stage boundary can round down into "approach" after the poses have
        // already reached exact contact; the packed field stores Float32 poses.
        const distance = fieldAt(f).distance(...middle);
        if (gap > 1e-6) assert.ok(distance > 0, 'the closing gap stays empty');
        else assert.ok(Math.abs(distance) < 1e-6, 'exact contact adds no premature bridge');
      }
      for (let i = 0; i < f.sources.length; i++)
        for (let j = i + 1; j < f.sources.length; j++) {
          const a = f.sources[i],
            b = f.sources[j];
          assert.ok(
            a.position.some(
              (v, axis) =>
                Math.abs(v - b.position[axis]) >= (a.size[axis] + b.size[axis]) / 2 - 1e-8,
            ),
            'source cells never interpenetrate',
          );
        }
    }
  }
  assert.deepEqual(MathMorph.plan(MathMorph.vectorAdd([1, -2, 0], [-1, 4, 0])).result, [0, 2, 0]);
});

test('scalar calculation validates real arithmetic before changing a view', () => {
  assert.equal(MathMorph.plan(MathMorph.calculate('multiply', 2, -0.5)).result, -1);
  assert.equal(MathMorph.plan(MathMorph.calculate('divide', 0, -3)).result, 0);
  assert.equal(MathMorph.plan(MathMorph.calculate('power', -2, 3)).result, -8);
  assert.throws(() => MathMorph.plan(MathMorph.calculate('divide', 1, 0)), /zero/);
  assert.throws(() => MathMorph.plan(MathMorph.calculate('power', -2, 0.5)), /real/);
  assert.throws(() => MathMorph.plan(MathMorph.dot([1], [1, 2])), /equally/);
  assert.throws(() => MathMorph.plan(MathMorph.dot([Infinity], [2])), /finite/);
});

test('local operators clear the contact across the dot stages', () => {
  const plan = MathMorph.plan(MathMorph.dot([2, -1, 0], [-0.5, 3, 2]));
  const operators = (frame) => frame.notes.filter((note) => note.id.startsWith('operator:'));
  assert.ok(operators(plan.sample(0)).every((note) => note.opacity === 1));
  for (let i = 0; i <= 100; i++) {
    const frame = plan.sample(i / 100);
    for (const note of operators(frame).filter((note) => note.opacity > 0))
      for (const part of frame.sources)
        assert.ok(
          [0, 1].some(
            (axis) =>
              Math.abs(note.position[axis] - part.position[axis]) >=
              (note.size[axis] + part.size[axis]) / 2,
          ),
          'operation ink stays outside its moving participants',
        );
  }
  assert.ok(operators(plan.sample(0.5)).every((note) => note.opacity === 0));
  assert.ok(operators(plan.sample(0.52)).some((note) => note.opacity > 0));
});

test('flat contours follow the shared field continuously through the previous midpoint switch', () => {
  const plan = MathMorph.plan(MathMorph.dot([2, -1, 0], [-0.5, 3, 2]));
  let previous;
  for (let i = 0; i <= 40; i++) {
    const p = 0.48 + (i / 40) * 0.34;
    const frame = plan.sample(p / 2);
    const field = fieldAt(frame),
      paths = fieldSection(field);
    assert.equal(paths.length, 3, 'each pair has one continuous result surface');
    for (const path of paths)
      for (const [x, y] of path) assert.ok(Math.abs(field.distance(x, y, 0)) < 0.025);
    const height = Math.max(...paths[0].map((v) => v[1])) - Math.min(...paths[0].map((v) => v[1]));
    if (previous !== undefined)
      assert.ok(Math.abs(height - previous) < 0.08, 'no half-way shape replacement');
    previous = height;
  }
});

test('long thin measured quantities remain present in the planar section on either axis', () => {
  for (const size of [
    [128, 1, 1],
    [1, 128, 1],
    [1000, 1, 1],
    [1, 1000, 1],
  ]) {
    const box = volumeBox(size),
      field = volumeField([box], [box]);
    field.update({ sources: [{}], targets: [{}], morph: 0 });
    const paths = fieldSection(field);
    assert.equal(paths.length, 1);
    const width = Math.max(...paths[0].map(([x]) => x)) - Math.min(...paths[0].map(([x]) => x));
    const height =
      Math.max(...paths[0].map(([, y]) => y)) - Math.min(...paths[0].map(([, y]) => y));
    assert.ok(Math.abs(width - size[0]) < 0.01);
    assert.ok(Math.abs(height - size[1]) < 0.01);
  }
});
