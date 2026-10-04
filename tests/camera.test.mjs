import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../dist/viewport/engine.js';
import { shotPose } from '../dist/viewport/shots.js';
import { readableFrame } from '../dist/viewport/framing.js';
import { stageFrame } from '../dist/characters/staging/camera.js';

test('character shots stay inside a finite room at its edges without clipping the subject', () => {
  const width = 960,
    height = 650,
    shot = { focus: ['hero'], framing: 'medium' };
  for (const x of [0, 440, 880])
    for (const y of [0, 235, 470]) {
      const hero = { x, y, width: 80, height: 180 },
        objects = { hero, backdrop: { x: -200, y: -200, width: 1360, height: 1050 } },
        frame = stageFrame(width, height, objects, shot);
      assert(frame.x >= 0 && frame.y >= 0);
      assert(frame.x + frame.width <= width && frame.y + frame.height <= height);
      assert(frame.x <= x && frame.y <= y);
      assert(frame.x + frame.width >= x + hero.width);
      assert(frame.y + frame.height >= y + hero.height);
      assert(Math.abs(frame.width / frame.height - width / height) < 1e-12);
      assert.deepEqual(stageFrame(width, height, objects, shot), frame);
      if (x === 440 && y === 235) {
        assert.equal(frame.x + frame.width / 2, width / 2);
        assert.equal(frame.y + frame.height / 2, height / 2);
      }
    }
});

test('character shots preserve outside-set subjects and oversized compositions', () => {
  const width = 960,
    height = 650,
    shot = { focus: ['hero'], framing: 'detail' };
  for (const hero of [
    { x: -40, y: 220, width: 80, height: 180 },
    { x: 920, y: 220, width: 80, height: 180 },
    { x: 440, y: -40, width: 80, height: 180 },
    { x: 440, y: 610, width: 80, height: 180 },
    { x: 0, y: 0, width, height },
  ]) {
    const frame = stageFrame(width, height, { hero }, shot);
    for (const [position, size, extent] of [
      ['x', 'width', width],
      ['y', 'height', height],
    ]) {
      assert(frame[position] <= hero[position]);
      assert(frame[position] + frame[size] >= hero[position] + hero[size]);
      if (hero[position] < 0) assert(frame[position] < 0);
      if (hero[position] + hero[size] > extent) assert(frame[position] + frame[size] > extent);
    }
  }
  // Crossing the set boundary or changing between a smaller/larger frame must
  // not suddenly enable/disable a different camera position.
  for (const subject of [
    (delta) => ({ x: delta, y: 220, width: 80, height: 180 }),
    (delta) => ({ x: 10, y: 16, width: 80, height: height - 32 + delta }),
  ]) {
    const a = stageFrame(width, height, { hero: subject(-1e-5) }, shot),
      b = stageFrame(width, height, { hero: subject(1e-5) }, shot);
    assert(Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3);
  }
});

test('camera turns join their endpoint shots continuously with asymmetric interface insets', () => {
  const target = new T.Box3(new T.Vector3(-0.5, -0.2, -2.5), new T.Vector3(0.5, 0.2, 2.5));
  for (const width of [375, 1280]) {
    const camera = new T.PerspectiveCamera(36, width / 600, 0.01, 1000);
    const from = {
      target,
      direction: [0.35, 1.6, 2.8],
      padding: 34,
      insets: { bottom: 84, left: 55 },
    };
    const to = { ...from, direction: [1.05, 0.65, 2.8] };
    const sample = (progress) => shotPose(camera, width, 600, { ...to, from, progress });
    for (const [edge, near] of [
      [0, 1e-7],
      [1, 1 - 1e-7],
    ]) {
      const a = sample(edge),
        b = sample(near);
      assert(a.target.distanceTo(b.target) < 1e-4, `target jumps at ${edge}`);
      assert(a.position.distanceTo(b.position) < 1e-4, `camera jumps at ${edge}`);
    }
    assert.deepEqual(sample(0.4), sample(0.4), 'seeking never accumulates camera offsets');
  }
});

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

test('shared annotation anchors fit throughout an authored camera turn', () => {
  const target = new T.Box3(new T.Vector3(-0.5, -0.5, -0.5), new T.Vector3(0.5, 0.5, 0.5));
  const anchors = [{ position: new T.Vector3(1.4, 1.8, 1.2), padding: [70, 22] }];
  for (const width of [375, 960]) {
    const camera = new T.PerspectiveCamera(36, width / 340, 0.01, 1000);
    for (let step = 0; step <= 20; step++) {
      const pose = shotPose(camera, width, 340, {
        target,
        anchors,
        direction: [-1, -0.3, 0],
        padding: 24,
        from: { target, anchors, direction: [1, 0.4, 0], padding: 24 },
        progress: step / 20,
      });
      camera.position.copy(pose.position);
      camera.lookAt(pose.target);
      camera.updateMatrixWorld(true);
      const point = anchors[0].position.clone().project(camera);
      const x = ((point.x + 1) * width) / 2,
        y = ((1 - point.y) * 340) / 2;
      assert(
        x - 70 >= 23.9 && x + 70 <= width - 23.9 && y - 22 >= 23.9 && y + 22 <= 316.1,
        `annotation clipped at ${width}px, turn ${step / 20}: ${x},${y}`,
      );
    }
  }
});
