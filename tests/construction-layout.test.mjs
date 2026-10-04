import test from 'node:test';
import assert from 'node:assert/strict';
import { placeLabels } from '../dist/layout/labels.js';

const area = { x: 0, y: 0, width: 500, height: 400 };
const box = (x, y, height = 30) => ({ x, y, width: 80, height });

test('moving annotations retain their prepared order through coincident anchors', () => {
  const before = placeLabels([box(100, 100), box(100, 100 - 1e-6)], area);
  const after = placeLabels([box(100, 100), box(100, 100 + 1e-6)], area);
  for (let i = 0; i < 2; i++) assert.ok(Math.abs(after[i].y - before[i].y) < 1e-5);
  assert.ok(after[1].y >= after[0].y + after[0].height + 8 - 1e-5);
});

test('hard clearance includes tall, boundary-constrained and nonadjacent annotations', () => {
  const labels = placeLabels([box(0, 0, 100), box(250, 0), box(0, 0, 100)], area);
  assert.ok(labels[2].y >= labels[0].y + 108 - 1e-5);
  for (const label of labels) {
    assert.ok(label.y >= area.y - 1e-5);
    assert.ok(label.y + label.height <= area.height + 1e-5);
  }
  const tall = placeLabels(
    Array.from({ length: 15 }, () => box(100, 100, 50)),
    { ...area, height: 15 * 58 - 8 },
  );
  for (let i = 1; i < tall.length; i++)
    assert.ok(tall[i].y >= tall[i - 1].y + tall[i - 1].height + 8 - 1e-5);
});

test('horizontal approach creates room continuously before boxes touch', () => {
  let previous;
  for (let x = 220; x >= 100; x -= 0.1) {
    const labels = placeLabels([box(100, 100), box(x, 100)], area);
    if (previous) assert.ok(Math.abs(labels[0].y - previous[0].y) < 2);
    if (x <= 188) assert.ok(labels[1].y >= labels[0].y + 38 - 1e-5);
    previous = labels;
  }
});

test('packing annotations preserves protected material lettering between groups', () => {
  const labels = placeLabels([box(100, 155), box(100, 160), box(100, 170)], area, [
    { bottom: 180 },
    { bottom: 180 },
    { top: 240 },
  ]);
  assert.ok(labels[0].y + 38 <= labels[1].y + 1e-5);
  assert.ok(labels[1].y + labels[1].height <= 180 + 1e-5);
  assert.ok(labels[2].y >= 240 - 1e-5);
});
