import test from 'node:test';
import assert from 'node:assert/strict';
import { composeInkField, inkGeometry } from '../dist/ink/fusion/geometry.js';

const stroke = (a, b, y = 0) => Float32Array.of(a, y, b, y, 0.1, 0.1);
const geometry = (sources, tension) =>
  inkGeometry(
    sources,
    sources.map((data) => new Float32Array(data.length / 6).fill(1)),
    [],
    tension,
    0,
  );

// Exercise the shared GPU pass order with the existing CPU stroke reference.
function composite(sources, groups, x, y) {
  const fields = Array(4).fill(Infinity);
  const active = composeInkField(
    groups,
    (source, target) => {
      assert.ok(target >= 0 && target < 4);
      fields[target] = geometry([sources[source]], 0).distance(x, y);
    },
    (first, second, target, tension) => {
      assert.notEqual(target, first, 'a pass cannot overwrite a texture it samples');
      assert.notEqual(target, second, 'a pass cannot overwrite a texture it samples');
      const a = fields[first],
        b = fields[second];
      const h = tension ? Math.max(0, tension - Math.abs(a - b)) / tension : 0;
      fields[target] = Math.min(a, b) - (h * h * tension) / 4;
    },
  );
  return fields[active];
}

test('independent ink materials equal the hard union of their isolated fields', () => {
  const sources = [
    stroke(-1, 0),
    stroke(0, 1),
    stroke(-1, -0.4, 0.17),
    stroke(-0.4, 0.3, 0.17),
    stroke(0.3, 1, 0.17),
    stroke(1, 2, -0.2),
    stroke(2, 2.4),
    stroke(2.4, 2.7),
    stroke(2.7, 3),
    stroke(3, 3.5),
  ];
  for (const progress of [0, 0.5, 0.99, 1]) {
    const groups = [
      { start: 0, end: 2, tension: 0.2 * (1 - progress) ** 2 },
      { start: 2, end: 5, tension: 0.3 },
      { start: 5, end: 6, tension: 0 },
      { start: 6, end: 10, tension: 0.1 },
    ];
    const isolated = groups.map((group) =>
      geometry(sources.slice(group.start, group.end), group.tension),
    );
    for (let x = -1; x < 3.6; x += 0.11)
      for (let y = -0.4; y < 0.5; y += 0.09) {
        const expected = Math.min(...isolated.map((field) => field.distance(x, y)));
        assert.ok(Math.abs(composite(sources, groups, x, y) - expected) < 1e-12);
      }
  }
});

test('a completed inscription keeps its exact stroke when the next stage takes ownership', () => {
  const before = [stroke(-1, 0), stroke(0, 1), stroke(4, 5)];
  const after = [stroke(-1, 1), stroke(4, 5)];
  const groupsBefore = [
    { start: 0, end: 2, tension: 0 },
    { start: 2, end: 3, tension: 0.5 },
  ];
  const groupsAfter = [
    { start: 0, end: 1, tension: 0 },
    { start: 1, end: 2, tension: 0.5 },
  ];
  for (let x = -1.2; x < 1.3; x += 0.07)
    for (let y = -0.3; y < 0.4; y += 0.04)
      assert.ok(
        Math.abs(composite(before, groupsBefore, x, y) - composite(after, groupsAfter, x, y)) <
          1e-12,
        'a passive material must not thicken the join of completed target spans',
      );
});
