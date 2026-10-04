import test from 'node:test';
import assert from 'node:assert/strict';
import { inkLayout } from '../dist/morph/ink-layout.js';

const mask = (width, height, x = 0, y = 0) => ({
  width: width + 100,
  height: height + 100,
  bounds: { width, height },
  paths: [
    [
      [x + 1, y + 1, 1],
      [x + width - 1, y + height - 1, 1],
    ],
  ],
});

test('imported silhouettes fit by visible ink, preserve proportions and leave their source intact', () => {
  const wide = mask(720, 180, 120, -40),
    tall = mask(140, 1200),
    // A disk can reduce to one medial point with a radius, which is valid ink.
    disk = { width: 100, height: 100, bounds: { width: 36, height: 36 }, paths: [[[20, -10, 18]]] };
  const operation = { sources: [wide, tall, disk], targets: [mask(300, 300)] };
  const saved = structuredClone(operation);
  for (const width of [180, 335, 768]) {
    const layout = inkLayout(operation, width);
    for (const group of [layout.sources, layout.targets]) {
      group.shapes.forEach((shape, i) => {
        const pose = group.poses[i];
        for (const [x, y, r] of shape.paths.flat()) {
          assert.ok(Math.abs(pose.x + x * pose.scale) + r * pose.scale <= width / 2);
          assert.ok(Math.abs(pose.y + y * pose.scale) + r * pose.scale <= layout.height / 2);
        }
      });
    }
    assert.equal(layout.sources.shapes[0].bounds.width / layout.sources.shapes[0].bounds.height, 4);
    assert.deepEqual(layout.sources.shapes[2].paths, [[[0, 0, 18]]]);
  }
  assert.deepEqual(operation, saved);
});

test('measured rows wrap before overlap, retain reading order and remain deterministic', () => {
  const operation = {
    sources: Array.from({ length: 4 }, () => mask(100, 40)),
    targets: [mask(100, 40)],
  };
  const narrow = inkLayout(operation, 335);
  const poses = narrow.sources.poses;
  assert.equal(poses[0].y, poses[1].y);
  assert.ok(poses[2].y > poses[1].y);
  assert.equal(poses[2].y, poses[3].y);
  assert.ok(poses[0].x < poses[1].x && poses[2].x < poses[3].x);
  assert.ok(
    poses.every((p) => p.scale === 1),
    'wrapping keeps the visible scale',
  );
  assert.ok(inkLayout(operation, 768).sources.poses.every((p) => p.y === 0));
  assert.deepEqual(inkLayout(operation, 335), narrow);
});
