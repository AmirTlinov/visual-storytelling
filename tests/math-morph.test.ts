import test from 'node:test';
import assert from 'node:assert/strict';
import { MathMorph, mathPlan } from '../dist/morph/math.js';
import { cellLayout } from '../dist/morph/layout.js';
import type { MathPart } from '../dist/morph/types.js';
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const volume = (a: MathPart) => a.size[0] * a.size[1] * a.size[2];

test('authored rows keep an embedded vector calculation stable through resize and reduction', () => {
  const plan = mathPlan(MathMorph.dot([1, 2, 3, 4, 5, 6, 7, 8], [8, 7, 6, 5, 4, 3, 2, 1]));
  const wide = cellLayout(plan, 1600, 4),
    narrow = cellLayout(plan, 360, 4);
  assert.deepEqual(
    wide.bounds,
    narrow.bounds,
    'Host width must not rearrange an authored workbench',
  );
  const first = plan.sample(0, { columns: wide.columns });
  assert.ok(new Set(first.sources.map((part) => part.position[1])).size > 1);
  for (let i = 0; i <= 100; i++) {
    const frame = plan.sample(i / 100, { columns: wide.columns });
    for (const part of [...frame.sources, ...frame.targets])
      for (let axis = 0; axis < 3; axis++) {
        assert.ok(part.position[axis]! - part.size[axis]! / 2 >= wide.bounds[0][axis]! - 1e-8);
        assert.ok(part.position[axis]! + part.size[axis]! / 2 <= wide.bounds[1][axis]! + 1e-8);
      }
  }
  close(plan.result, 120);
  for (const columns of [0, -1, 1.5, Infinity, NaN])
    assert.throws(() => cellLayout(plan, 640, columns), /positive integer/);
});

test('join and cut preserve measured matter and reach contact without interpenetration', () => {
  for (const operation of [MathMorph.add(2, 4), MathMorph.divide(6, 3)]) {
    const plan = mathPlan(operation);
    for (let i = 0; i <= 100; i++) {
      const frame = plan.sample(i / 100);
      close(
        frame.sources.reduce((s, p) => s + volume(p), 0),
        6,
      );
      close(
        frame.targets.reduce((s, p) => s + volume(p), 0),
        6,
      );
      for (const parts of [frame.sources, frame.targets])
        for (let j = 1; j < parts.length; j++)
          assert.ok(
            parts[j]!.position[0] - parts[j]!.size[0] / 2 >=
              parts[j - 1]!.position[0] + parts[j - 1]!.size[0] / 2 - 1e-10,
          );
    }
    assert.deepEqual(plan.sample(0.42), plan.sample(0.42));
  }
});
test('multiplication builds an area and then reshapes the same quantity continuously', () => {
  const plan = mathPlan(MathMorph.multiply(2, 3));
  close(volume(plan.sample(0.5).sources[0]!), 6);
  for (let i = 50; i <= 100; i++) close(volume(plan.sample(i / 100).sources[0]!), 6);
  const before = plan.sample(0.5 - 1e-7).sources[0]!,
    after = plan.sample(0.5 + 1e-7).sources[0]!;
  before.size.forEach((v, i) => assert.ok(Math.abs(v - after.size[i]!) < 1e-5));
  close(plan.result, 6);
  assert.equal(
    plan.sample(0.49).formula,
    plan.sample(0.51).formula,
    'The proven result remains while its area is rearranged',
  );
  for (const p of [0, 0.2, 0.49, 0.5, 0.7, 1]) {
    const body = plan.sample(p).sources[0]!;
    close(body.position[1] - body.size[1] / 2, -0.5);
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(body.position[axis]! - body.size[axis]! / 2 >= plan.bounds[0][axis]! - 1e-9);
      assert.ok(body.position[axis]! + body.size[axis]! / 2 <= plan.bounds[1][axis]! + 1e-9);
    }
  }
});
test('growth remains tied to one left origin and a fixed measurement scale', () => {
  const plan = mathPlan(MathMorph.exponential(0, 3, 2));
  for (const p of [0, 0.2, 0.6, 1]) {
    const frame = plan.sample(p),
      body = frame.sources[0]!;
    close(body.value, 2 ** (3 * p));
    close(body.position[0] - body.size[0] / 2, -4);
  }
  const square = mathPlan(
    MathMorph.map({
      from: 1,
      to: 3,
      range: [1, 9],
      value: (x) => x * x,
      label: (x, y) => `${x}²=${y}`,
    }),
  );
  close(square.sample(0.5).sources[0]!.value, 4);
  assert.throws(
    () =>
      mathPlan(
        MathMorph.map({ from: 1, to: 3, range: [1, 2], value: (x) => x * x, label: String }),
      ).sample(1),
    /range/,
  );
});

test('large powers preserve readable proportions and measured area', () => {
  const plan = mathPlan(MathMorph.power(6, 4));
  const last = plan.sample(1).sources[0]!;
  assert.deepEqual(last.size, [36, 36, 1]);
  close(volume(last), 1296);
  assert.throws(() => mathPlan(MathMorph.divide(Number.MIN_VALUE, 2)), /positive/);
});

test('rounded results are approximate while exact arithmetic keeps equality', () => {
  assert.equal(mathPlan(MathMorph.divide(1, 3)).sample(1).formula, '1 ÷ 3 ≈ 0.3333');
  assert.equal(mathPlan(MathMorph.divide(1, 3)).sample(0).formula, '1 ÷ 3');
  assert.equal(mathPlan(MathMorph.multiply(2, 3)).sample(1).formula, '2 × 3 = 6');
  assert.equal(mathPlan(MathMorph.add(0.1, 0.2)).sample(1).formula, '0.1 + 0.2 = 0.3');
  assert.equal(mathPlan(MathMorph.exponential(0, 1)).sample(1).formula, 'e^1 ≈ 2.718');
});
