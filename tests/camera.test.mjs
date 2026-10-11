import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../dist/viewport/engine.js';
import { shotPose } from '../dist/viewport/shots.js';
import { readableFrame } from '../dist/viewport/framing.js';
import { stageFrame } from '../dist/characters/staging/camera.js';

test('the default character frame preserves the painted set when props approach its edges', () => {
  const set = { x: 0, y: 0, width: 960, height: 650 };
  for (const x of [0, 1, 32, 858, 860])
    for (const y of [0, 1, 32, 448, 450])
      assert.deepEqual(stageFrame(960, 650, { door: { x, y, width: 100, height: 200 } }), set);
  const outside = stageFrame(960, 650, { hero: { x: -40, y: 200, width: 100, height: 200 } });
  assert(outside.x <= -40 && outside.x + outside.width >= 960);
});

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

test('scale-changing shots distribute zoom across the transition in both directions and replay exactly', () => {
  for (const width of [375, 1440])
    for (const shape of [new T.Vector3(1, 0.4, 0.7), new T.Vector3(1, 0, 0.7)]) {
      const camera = new T.PerspectiveCamera(36, width / 600, 0.01, 100000);
      const shot = (center, scale) => ({
        target: new T.Box3().setFromCenterAndSize(center, shape.clone().multiplyScalar(scale)),
        direction: [0.35, 1.6, 2.8],
        padding: 34,
        insets: { bottom: 84, left: 55 },
      });
      const overview = shot(new T.Vector3(), 1000);
      const detail = shot(new T.Vector3(300, 0, 200), 15);
      for (const [from, to] of [
        [overview, detail],
        [detail, overview],
      ]) {
        const sample = (progress) => shotPose(camera, width, 600, { ...to, from, progress });
        const distance = (pose) => pose.position.distanceTo(pose.target);
        const samples = new Map([0, 0.25, 0.5, 0.75, 1].map((p) => [p, sample(p)]));
        const start = distance(samples.get(0)),
          end = distance(samples.get(1));
        // At halfway, the camera must have covered half the scale range in log space.
        // A linear intermediate fit left a 1000-to-15 close-up almost entirely at the end.
        const halfway = distance(samples.get(0.5));
        assert(
          Math.abs(halfway / Math.sqrt(start * end) - 1) < 1e-6,
          `zoom is delayed at ${width}px: halfway distance ${halfway}, endpoints ${start},${end}`,
        );
        const direction = Math.sign(end - start);
        const distances = [...samples.values()].map(distance);
        for (let i = 1; i < distances.length; i++)
          assert(direction * (distances[i] - distances[i - 1]) > 0, 'zoom reverses during a leg');
        for (const progress of [1, 0.25, 0.75, 0, 0.5, 1])
          assert.deepEqual(
            sample(progress),
            samples.get(progress),
            'seeking changes the fitted pose',
          );
      }
    }
});

test('point shots remain continuous with arbitrarily small targets in both directions', () => {
  for (const width of [375, 1440]) {
    const camera = new T.PerspectiveCamera(36, width / 600, 0.01, 100000);
    const bounds = (size) =>
      new T.Box3().setFromCenterAndSize(new T.Vector3(3, 0, 2), new T.Vector3(size, size, size));
    const point = bounds(0),
      tiny = bounds(1e-9),
      large = bounds(1000);
    for (const reverse of [false, true])
      for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
        const sample = (small) =>
          shotPose(camera, width, 600, {
            target: reverse ? small : large,
            direction: [0, 0, 1],
            from: { target: reverse ? large : small, direction: [0, 0, 1] },
            progress,
          });
        const a = sample(point),
          b = sample(tiny);
        assert(a.position.distanceTo(b.position) < 1e-5, 'a point must not switch the zoom law');
        assert(a.target.distanceTo(b.target) < 1e-5, 'a point must not switch the pan law');
      }
  }
});

test('scale-changing fits keep point and flat bounds finite', () => {
  const camera = new T.PerspectiveCamera(36, 960 / 600, 0.01, 100000);
  const point = new T.Box3(new T.Vector3(3, 0, 2), new T.Vector3(3, 0, 2));
  const flat = new T.Box3(new T.Vector3(-500, 0, -300), new T.Vector3(500, 0, 300));
  for (const [from, target] of [
    [point, flat],
    [flat, point],
    [point, point],
  ])
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      const pose = shotPose(camera, 960, 600, {
        target,
        direction: [0, 1, 1],
        from: { target: from, direction: [0, 1, 1] },
        progress,
      });
      assert(
        [
          ...pose.position.toArray(),
          ...pose.target.toArray(),
          pose.radius,
          pose.near,
          pose.far,
        ].every(Number.isFinite),
      );
      assert(pose.position.distanceTo(pose.target) > 0 && pose.near > 0 && pose.far > pose.near);
    }
});

test('locked geographic shots zoom on the authored place and preserve the usable frame', () => {
  const center = new T.Vector3(-5200, 149, 380);
  for (const width of [375, 1440]) {
    const height = 720,
      camera = new T.PerspectiveCamera(36, width / height, 0.01, 100000);
    const shot = (size) => ({
      target: new T.Box3().setFromCenterAndSize(center, size),
      direction: [0, 7, 10],
      lockTarget: true,
      padding: 30,
      insets: { left: 46, bottom: 100 },
    });
    const regional = shot(new T.Vector3(1200, 70, 950));
    const building = shot(new T.Vector3(15, 11.7, 12));
    for (const [from, to] of [
      [regional, building],
      [building, regional],
    ]) {
      const sample = (progress) => shotPose(camera, width, height, { ...to, from, progress });
      for (let i = 0; i <= 40; i++) {
        const pose = sample(i / 40);
        assert(pose.target.distanceTo(center) < 1e-9, `aim drifts at ${i / 40}`);
      }
      for (const endpoint of [from, to]) {
        const pose = shotPose(camera, width, height, endpoint);
        camera.position.copy(pose.position);
        camera.lookAt(pose.target);
        camera.updateMatrixWorld(true);
        for (const x of [endpoint.target.min.x, endpoint.target.max.x])
          for (const y of [endpoint.target.min.y, endpoint.target.max.y])
            for (const z of [endpoint.target.min.z, endpoint.target.max.z]) {
              const p = new T.Vector3(x, y, z).project(camera);
              const px = ((p.x + 1) * width) / 2,
                py = ((1 - p.y) * height) / 2;
              assert(px >= 45.99 && px <= width - 29.99 && py >= 29.99 && py <= height - 99.99);
            }
      }
      const saved = sample(0.7);
      sample(1);
      sample(0.1);
      assert.deepEqual(sample(0.7), saved, 'rewind changes a fixed aim');
    }
  }
});

test('locked and automatic shots join continuously while keeping shared annotations visible', () => {
  const bounds = new T.Box3(new T.Vector3(-5, -0.4, -2), new T.Vector3(5, 0.4, 2));
  const anchors = [{ position: new T.Vector3(4, 2, 1), padding: [36, 18] }];
  const camera = new T.PerspectiveCamera(36, 960 / 600, 0.01, 10000);
  for (const [fromLock, toLock] of [
    [true, true],
    [false, true],
    [true, false],
  ]) {
    const from = {
      target: bounds,
      direction: [1, 1, 2],
      padding: 30,
      insets: { bottom: 80 },
      anchors,
      lockTarget: fromLock,
    };
    const to = { ...from, direction: [-1, 0.6, 2], lockTarget: toLock };
    const sample = (progress) => shotPose(camera, 960, 600, { ...to, from, progress });
    const start = sample(0),
      end = sample(1);
    for (const [a, b] of [
      [0, 1e-7],
      [1, 1 - 1e-7],
    ]) {
      assert(sample(a).target.distanceTo(sample(b).target) < 1e-5);
      assert(sample(a).position.distanceTo(sample(b).position) < 1e-5);
    }
    for (let step = 0; step <= 40; step++) {
      const p = step / 40,
        t = p * p * (3 - 2 * p),
        pose = sample(p);
      assert(pose.target.distanceTo(start.target.clone().lerp(end.target, t)) < 1e-9);
      camera.position.copy(pose.position);
      camera.lookAt(pose.target);
      camera.updateMatrixWorld(true);
      const a = anchors[0].position.clone().project(camera);
      const x = (a.x + 1) * 480,
        y = (1 - a.y) * 300;
      assert(x - 36 >= 29.99 && x + 36 <= 930.01 && y - 18 >= 29.99 && y + 18 <= 520.01);
    }
  }
});

test('impossible locked frames reject excluded aims and padded labels without searching forever', () => {
  const camera = new T.PerspectiveCamera(36, 1, 0.01, 1000);
  const base = {
    center: new T.Vector3(),
    direction: new T.Vector3(0, 0, 1),
    width: 400,
    height: 400,
    lockCenter: true,
  };
  for (const options of [
    { insets: { left: 250, right: 20, top: 20, bottom: 20 } },
    {
      insets: { left: 175, right: 20 },
      anchors: [{ position: new T.Vector3(), padding: [36, 18] }],
    },
  ])
    assert.throws(
      () => readableFrame(camera, { ...base, ...options }),
      /locked camera target cannot fit/,
    );
  // A label beyond the optical center can fit over a finite distance interval.
  const pose = readableFrame(camera, {
    ...base,
    insets: { left: 175, right: 20 },
    anchors: [{ position: new T.Vector3(1, 0, 0), padding: [36, 18] }],
  });
  assert(pose.target.equals(base.center));
  assert(Number.isFinite(pose.position.length()));
});

test('a mixed shot respects the maximum distance permitted by a shared padded annotation', () => {
  const width = 400,
    height = 400,
    left = 189.62518924474716;
  const camera = new T.PerspectiveCamera(36, 1, 0.01, 1000);
  const anchors = [{ position: new T.Vector3(3.69, 0.746, 0.568), padding: [36, 18] }];
  const make = (center, size, direction, lockTarget) => ({
    target: new T.Box3().setFromCenterAndSize(new T.Vector3(...center), new T.Vector3(...size)),
    direction,
    lockTarget,
    anchors,
    insets: { left, right: 20, top: 20, bottom: 20 },
  });
  const from = make([4.72, -0.45, -0.75], [0.3, 2.45, 0.985], [0.7, 0.194, 0.743], false);
  const to = make([1.83, -0.37, -0.84], [1.33, 0.736, 0.895], [0.114, 1.066, 1.09], true);
  for (const progress of [0, 0.1, 0.2, 0.31, 0.5, 0.7, 0.9, 1]) {
    const pose = shotPose(camera, width, height, { ...to, from, progress });
    camera.position.copy(pose.position);
    camera.lookAt(pose.target);
    camera.updateMatrixWorld(true);
    const point = anchors[0].position.clone().project(camera);
    const x = ((point.x + 1) * width) / 2,
      y = ((1 - point.y) * height) / 2;
    assert(
      x - 36 >= left - 0.001 && x + 36 <= 380.001 && y - 18 >= 19.999 && y + 18 <= 380.001,
      `annotation clipped at ${progress}`,
    );
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
