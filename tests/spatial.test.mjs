import test from 'node:test';
import assert from 'node:assert/strict';
import { TensorData, formatNumber } from '../dist/math/tensor-data.js';
import { operationState } from '../dist/math/operation.js';
import { connector, crosses, inflate, rectInPolygon } from '../dist/layout/geometry.js';
import { framePose } from '../dist/viewport/camera.js';
import { transfer } from '../dist/math/transfer.js';
import * as T from '../dist/viewport/engine.js';

test('slicing and transposing preserve logical tensor addresses and values', () => {
  const data = new TensorData(
    [2, 3, 4],
    Array.from({ length: 24 }, (_, i) => i),
    ['batch', 'row', 'feature'],
  );
  assert.deepEqual(
    data.slice(0, 1).values,
    Array.from({ length: 12 }, (_, i) => 12 + i),
  );
  assert.deepEqual(data.slice(1, 2).values, [8, 9, 10, 11, 20, 21, 22, 23]);
  const moved = data.transpose([2, 0, 1]);
  for (let b = 0; b < 2; b++)
    for (let r = 0; r < 3; r++)
      for (let f = 0; f < 4; f++) assert.equal(moved.at(f, b, r), data.at(b, r, f));
  assert.throws(() => data.reshape([3, 3]));
  assert.throws(() => data.transpose([0, 0, 1]));
  assert.equal(formatNumber(0.0004), '0.0004');
  assert.notEqual(formatNumber(0.9964), '1');
  assert.match(formatNumber(1 / 3), /^≈ /);
});
test('a transferred value clears a neighbouring solid and retains its exact destination', () => {
  const obstacle = new T.Mesh(new T.BoxGeometry(1, 1, 1));
  const from = new T.Vector3(-2, 0, 1),
    to = new T.Vector3(2, 0, 1),
    motion = transfer(from, to, [obstacle], 1);
  const positions = Array.from({ length: 101 }, (_, i) => motion(i / 100));
  assert.deepEqual(positions[0].position.toArray(), from.toArray());
  assert.deepEqual(positions.at(-1).position.toArray(), to.toArray());
  for (const pose of positions)
    assert.ok(
      Math.abs(pose.position.x) > 0.5 + pose.scale * 0.45 ||
        Math.abs(pose.position.y) > 0.5 + pose.scale * 0.43,
    );
  assert.equal(positions.at(-1).lettering, true);
});
test('framing handles a top-down view and preserves reserved annotation space', () => {
  const object = new T.Mesh(new T.BoxGeometry(5, 3, 2)),
    camera = new T.PerspectiveCamera(36, 375 / 700, 0.01, 1000);
  const pose = framePose(camera, 375, 700, {
    target: object,
    direction: [0, 1, 0],
    inset: { top: 90, bottom: 70, left: 25, right: 25 },
  });
  camera.position.copy(pose.position);
  camera.up.copy(pose.up);
  camera.lookAt(pose.target);
  camera.updateMatrixWorld();
  for (const x of [-2.5, 2.5])
    for (const y of [-1.5, 1.5])
      for (const z of [-1, 1]) {
        const p = new T.Vector3(x, y, z).project(camera),
          px = ((p.x + 1) * 375) / 2,
          py = ((1 - p.y) * 700) / 2;
        assert.ok(px >= 25 && px <= 350 && py >= 90 && py <= 630);
      }
  assert.throws(() => framePose(camera, 375, 700, { target: object, direction: [0, 0, 0] }));
});
test('a result becomes available on arrival and reverse seeking restores the same partial sum', () => {
  const a = [2, -3, 4],
    b = [0.5, 2, -1];
  assert.deepEqual(operationState(a, b, 'add', 0.2).result, [2.5, -1, 3]);
  assert.equal(operationState(a, b, 'dot', 0.91 / 3).completed, 0);
  assert.equal(operationState(a, b, 'dot', 0.93 / 3).partial, 1);
  const earlier = operationState(a, b, 'dot', 0.65);
  assert.equal(operationState(a, b, 'dot', 1).partial, -9);
  assert.deepEqual(operationState(a, b, 'dot', 0.65), earlier);
  assert.throws(() => operationState([1], [1, 2], 'add', 0));
});
test('connectors finish outside their objects and route around an intervening label', () => {
  const a = { x: 0, y: 30, width: 40, height: 40 },
    b = { x: 260, y: 30, width: 50, height: 40 },
    obstacle = { x: 110, y: 10, width: 70, height: 80 };
  const points = connector(a, b, [obstacle], { gap: 6 });
  assert.ok(points.length > 2);
  for (let i = 1; i < points.length; i++)
    for (const occupied of [a, b, inflate(obstacle, 5)])
      assert.equal(crosses(points[i - 1], points[i], occupied), false);
  assert.ok(points[0].x >= a.x + a.width + 5);
  assert.ok(points.at(-1).x <= b.x - 5);
  assert.deepEqual(connector(a, { ...a, x: 20 }), []);
});
test('a number must fit the whole projected quadrilateral, including its corners', () => {
  const face = [
    { x: 0, y: 0 },
    { x: 70, y: 12 },
    { x: 70, y: 65 },
    { x: 0, y: 45 },
  ];
  assert.equal(rectInPolygon({ x: 10, y: 17, width: 45, height: 20 }, face, 3), true);
  assert.equal(rectInPolygon({ x: 5, y: 5, width: 60, height: 45 }, face, 3), false);
});
