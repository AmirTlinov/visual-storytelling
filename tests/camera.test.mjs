import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../dist/viewport/engine.js';
import { shotPose } from '../dist/viewport/shots.js';
import { readableFrame } from '../dist/viewport/framing.js';

test('authored turns keep an elongated subject in frame, including a view along the up axis', () => {
  const target = new T.Box3(new T.Vector3(-5, -1, -0.5), new T.Vector3(5, 1, 0.5));
  for (const width of [375, 960]) {
    const camera = new T.PerspectiveCamera(36, width / 340, 0.01, 1000);
    for (const direction of [
      [0, 0, 1],
      [0, 1, 0],
    ])
      for (let step = 0; step <= 20; step++) {
        const pose = shotPose(camera, width, 340, {
          target,
          direction,
          padding: 24,
          from: { target, direction: [1, 0, 0], padding: 24 },
          progress: step / 20,
        });
        camera.position.copy(pose.position);
        camera.lookAt(pose.target);
        camera.updateMatrixWorld(true);
        for (const x of [-5, 5])
          for (const y of [-1, 1])
            for (const z of [-0.5, 0.5]) {
              const p = new T.Vector3(x, y, z).project(camera);
              assert(
                Number.isFinite(p.x) && Math.abs(p.x) <= 1 - 48 / width + 0.001,
                `horizontal clipping at ${step / 20}`,
              );
              assert(
                Number.isFinite(p.y) && Math.abs(p.y) <= 1 - 48 / 340 + 0.001,
                `vertical clipping at ${step / 20}`,
              );
            }
      }
  }
});

test('hidden future geometry does not shrink a shot; invalid coordinates fail before fitting', () => {
  const camera = new T.PerspectiveCamera(36, 1, 0.01, 1000),
    group = new T.Group();
  group.add(
    new T.Line(
      new T.BufferGeometry().setFromPoints([new T.Vector3(-1, 0, 0), new T.Vector3(1, 0, 0)]),
    ),
  );
  const pose = () => shotPose(camera, 375, 375, { target: group }).position.toArray();
  const before = pose(),
    future = new T.Mesh(new T.BoxGeometry(1, 1, 1));
  future.position.x = 100;
  future.visible = false;
  group.add(future);
  assert.deepEqual(pose(), before);
  assert.throws(
    () =>
      readableFrame(camera, {
        center: new T.Vector3(),
        direction: new T.Vector3(0, 0, 1),
        width: 375,
        height: 375,
        anchors: [{ position: new T.Vector3(NaN, 0, 0) }],
      }),
    /finite coordinates/,
  );
});
