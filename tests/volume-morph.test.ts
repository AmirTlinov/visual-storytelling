import test from 'node:test';
import assert from 'node:assert/strict';
import { Euler, Vector3 } from 'three';
import { surfaceInscriptions } from '../dist/morph/ink.js';
import {
  volumeBox,
  volumeSphere,
  volumeCapsule,
  volumeField,
  type VolumeFrame,
  type VolumeShape,
} from '../dist/viewport/morph/field.js';
const distanceOf = (shape: VolumeShape) => volumeField([shape], [shape]).distance;
const close = (actual: number, expected: number, message?: string) =>
  assert.ok(Math.abs(actual - expected) < 2e-6, message ?? `${actual} differs from ${expected}`);
test('packed primitives preserve their outer dimensions and rounded box faces', () => {
  const box = distanceOf(volumeBox([2, 4, 6], 0.2));
  const sphere = distanceOf(volumeSphere(2));
  const capsule = distanceOf(volumeCapsule(1, 4));
  close(box(1, 0, 0), 0);
  close(box(0, 2, 0), 0);
  assert.ok(box(1, 2, 3) > 0);
  close(sphere(0, 2, 0), 0);
  close(capsule(2, 0, 0), 0);
  close(capsule(0, 1, 0), 0);
  assert.ok(capsule(0, 0, 0) < 0);
});
test('packed poses agree with Three XYZ rotation, translation and uniform scale', () => {
  const box = volumeBox([1, 2, 3]),
    localDistance = distanceOf(box);
  const morph = volumeField([box], [volumeSphere(1)]);
  const rotation = [0.35, -0.6, 0.7] as const;
  const position = [2, -3, 1] as const,
    scale = 1.7;
  morph.update({ sources: [{ position, rotation, scale }], morph: 0, tension: 0, targets: [{}] });
  for (const p of [
    [0.5, 0, 0],
    [0, 1, 0],
    [0, 0, 1.5],
    [0.8, 0.4, 0.7],
    [-0.2, 0.3, -0.4],
  ]) {
    const world = new Vector3(...p)
      .multiplyScalar(scale)
      .applyEuler(new Euler(...rotation))
      .add(new Vector3(...position));
    close(morph.distance(world.x, world.y, world.z), localDistance(p[0]!, p[1]!, p[2]!) * scale);
  }
  morph.update({ sources: [{}], targets: [{ position, rotation, scale }], morph: 1 });
  const surface = new Vector3(0, 1, 0)
    .multiplyScalar(scale)
    .applyEuler(new Euler(...rotation))
    .add(new Vector3(...position));
  close(morph.distance(surface.x, surface.y, surface.z), 0, 'The target receives its own pose');
});
test('contact fills facing surfaces without pinching the seam or rounding free corners', () => {
  const box = volumeBox([2, 2, 2]),
    target = volumeBox([4.2, 2, 2]);
  const morph = volumeField([box, box], [target]),
    targetDistance = distanceOf(target);
  const sources = [{ position: [-1.1, 0, 0] as const }, { position: [1.1, 0, 0] as const }];
  morph.update({ sources, morph: 0, tension: 0, targets: [{}] });
  assert.ok(morph.distance(0, 0, 0) > 0, 'The initial gap remains empty');
  morph.update({ sources, morph: 0, tension: 0.6, targets: [{}] });
  assert.ok(morph.distance(0, 0, 0) < 0, 'A bridge joins the facing surfaces');
  assert.ok(morph.distance(0, 0.9, 0.9) < 0, 'Contact reaches the rim without an artificial waist');
  close(morph.distance(2.1, 1, 1), 0, 'The opposite corner stays on the rigid source');
  close(morph.distance(-2.1, 1, 1), 0);
  const middle = morph.distance(0.1, 0.2, 0.3);
  morph.update({ sources, morph: 1, tension: 0.6, targets: [{}] });
  for (const p of [
    [0, 0, 0],
    [1, 0.6, 0],
    [2.2, 0, 0],
  ])
    assert.equal(morph.distance(p[0]!, p[1]!, p[2]!), targetDistance(p[0]!, p[1]!, p[2]!));
  morph.update({ sources, morph: 0, tension: 0.6, targets: [{}] });
  assert.equal(morph.distance(0.1, 0.2, 0.3), middle, 'Reverse seek has no simulation history');
  for (const separation of [1, 0.98, 0.95]) {
    morph.update({
      sources: [{ position: [-separation, 0, 0] }, { position: [separation, 0, 0] }],
      morph: 0,
      tension: 0.6,
      targets: [{}],
    });
    for (const x of [-separation - 1, -0.75, 0, 0.75, separation + 1])
      for (const z of [-1, -0.5, 0, 0.5, 1]) {
        close(morph.distance(x, 1, z), 0, 'Contact retains the same flat top and free corners');
        assert.ok(morph.distance(x, 1.02, z) > 0.019, 'No ridge grows above the target plane');
      }
  }
});
test('rejected frames leave the displayed field intact and preserve GPU buffer identities', () => {
  const box = volumeBox([1, 2, 3]);
  const morph = volumeField([box, box], [volumeBox([3, 2, 3])]);
  const frame: VolumeFrame = {
    sources: [{ position: [-1, 0, 0] }, { position: [1, 0, 0] }],
    morph: 0.3,
    tension: 0.4,
    targets: [{}],
  };
  const transforms = morph.transforms,
    scales = morph.scales,
    planes = morph.planes,
    groups = morph.groups,
    registration = morph.registration;
  const snapshot = () => ({
    transforms: [...morph.transforms],
    scales: [...morph.scales],
    planes: [...morph.planes],
    planeCounts: [...morph.planeCounts],
    groups: [...morph.groups],
    groupCount: morph.groupCount,
    registration: [...morph.registration],
    bounds: [morph.bounds.min.toArray(), morph.bounds.max.toArray()],
    morph: morph.morph,
    tension: morph.tension,
    distance: morph.distance(0.2, 0.1, -0.3),
    targets: [{}],
  });
  morph.update(frame);
  const before = snapshot();
  for (const invalid of [
    { ...frame, morph: 0.8, targets: [{ position: [Infinity, 0, 0] }] },
    { ...frame, sources: [{ position: [5, 0, 0] }, { scale: 0 }] },
    { ...frame, sources: [{ position: [1e100, 0, 0] }, {}] },
    { ...frame, tension: 1e100 },
  ] as VolumeFrame[]) {
    assert.throws(() => morph.update(invalid));
    assert.deepEqual(snapshot(), before);
  }
  morph.update({ sources: [{}, {}], morph: 1, targets: [{}] });
  morph.update(frame);
  assert.deepEqual(snapshot(), before);
  assert.equal(morph.transforms, transforms);
  assert.equal(morph.scales, scales);
  assert.equal(morph.planes, planes);
  assert.equal(morph.groups, groups);
  assert.equal(morph.registration, registration);
});

test('packed cubes contract through flat faces without intermediate diagonal facets', () => {
  const box = volumeBox([1.4, 1.4, 1.4]),
    field = volumeField([box, box], [box]);
  const sources = [{ position: [-0.7, 0, 0] as const }, { position: [0.7, 0, 0] as const }];
  for (const progress of [0, 0.1, 0.417659, 0.7, 0.95, 1]) {
    field.update({ sources, targets: [{}], morph: progress, tension: 0.24 });
    const halfWidth = 1.4 - 0.7 * field.morph;
    for (const x of [-halfWidth, -halfWidth / 2, 0, halfWidth / 2, halfWidth])
      for (const z of [-0.7, 0, 0.7]) close(field.distance(x, 0.7, z), 0);
    close(field.distance(halfWidth, 0, 0), 0);
    assert.ok(field.distance(halfWidth + 0.02, 0, 0) > 0);
    assert.ok(field.distance(0, 0.69, 0) < 0);
  }
});

test('distant material pairs keep their own contact planes and registration axes', () => {
  const box = volumeBox([1.4, 1.4, 1.4]);
  const single = volumeField([box, box], [box]),
    paired = volumeField([box, box, box, box], [box, box]);
  const right = [{ position: [5, -0.7, 0] as const }, { position: [5, 0.7, 0] as const }];
  const rotation = [0.31, -0.45, 0.77] as const,
    euler = new Euler(...rotation);
  const left = [-0.7, 0.7].map((y) => ({
    position: new Vector3(0, y, 0)
      .applyEuler(euler)
      .add(new Vector3(-5, 0, 0))
      .toArray(),
    rotation,
  }));
  for (const morph of [0, 0.2, 0.417659, 0.8, 1]) {
    single.update({ sources: right, targets: [{ position: [5, 0, 0] }], morph, tension: 0.24 });
    paired.update({
      sources: [...left, ...right],
      targets: [{ position: [-5, 0, 0], rotation }, { position: [5, 0, 0] }],
      morph,
      tension: 0.24,
    });
    assert.equal(paired.groupCount, 2);
    for (const x of [4.3, 4.5, 5, 5.7])
      for (const y of [-1, -0.5, 0, 0.5, 1])
        close(
          paired.distance(x, y, 0.3),
          single.distance(x, y, 0.3),
          'A distant rotated pair cannot alter this pair',
        );
    close(paired.distance(5.7, 0, 0), 0, 'The shared side stays flat in every material group');
    // The complete same arrangement can be rotated in space without changing its local field.
    const turned = volumeField([box, box], [box]);
    const turn = (p: readonly number[]) =>
      new Vector3(...p)
        .applyEuler(euler)
        .add(new Vector3(2, -3, 1))
        .toArray();
    turned.update({
      sources: right.map((p) => ({ position: turn(p.position), rotation })),
      targets: [{ position: turn([5, 0, 0]), rotation }],
      morph,
      tension: 0.24,
    });
    for (const p of [
      [5.7, 0, 0],
      [5, 0.9, 0.2],
      [5.3, 0.4, 0.8],
      [4.4, -0.6, 0.3],
    ]) {
      const q = turn(p);
      close(turned.distance(q[0]!, q[1]!, q[2]!), single.distance(p[0]!, p[1]!, p[2]!));
    }
  }
});

test('ray bounds contain contact expansion under anisotropic material scaling', () => {
  const sphere = volumeSphere(1),
    field = volumeField([sphere, sphere], [sphere]);
  field.update({
    sources: [
      { position: [-0.01, 0, 0], scale: [10, 1, 1] },
      { position: [0.01, 0, 0], scale: [10, 1, 1] },
    ],
    targets: [{ scale: [10, 1, 1] }],
    morph: 0,
    tension: 1,
  });
  assert.ok(
    field.distance(12, 0, 0) < 0,
    'The scaled smooth contact reaches past the original ellipsoids',
  );
  assert.ok(
    field.bounds.containsPoint(new Vector3(12, 0, 0)),
    'The GPU proxy must not cut off visible material',
  );
  assert.ok(field.distance(field.bounds.max.x, 0, 0) > 0);
});

test('measured material carries its original grid lines through registration', () => {
  const source = volumeBox([2, 2, 1]),
    target = volumeBox([4, 2, 1]);
  const field = volumeField([source], [target]),
    ink = surfaceInscriptions();
  for (const morph of [0.1, 0.49, 0.51, 0.9]) {
    const frame = {
      sources: [{ shape: source, position: [1, 2, 0] as const, grid: 1 }],
      targets: [{ shape: target, position: [3, 4, 0] as const }],
      morph,
      tension: 0,
    };
    field.update(frame);
    const marks = ink.sample(frame, 0.01, field.registration).marks;
    assert.equal(
      marks.segments.length,
      12,
      'Stretching does not create or delete source grid lines',
    );
    const x = 1 + 2 * field.morph,
      y = -(2 + 2 * field.morph),
      halfWidth = 1 + field.morph;
    for (const [i, expected] of [
      [0, x],
      [1, y - 1],
      [2, x],
      [3, y + 1],
      [6, x - halfWidth],
      [7, y],
      [8, x + halfWidth],
      [9, y],
    ] as const)
      close(marks.segments[i]!, expected);
  }
});
test('shared planes follow rotated boxes and fade continuously under small pose changes', () => {
  const box = volumeBox([2, 2, 2]),
    field = volumeField([box, box], [volumeBox([4.2, 2, 2])]);
  const frame: VolumeFrame = {
    sources: [{ position: [-1, 0, 0] }, { position: [1, 0, 0] }],
    morph: 0,
    tension: 0.6,
    targets: [{}],
  };
  const probes = [
    [0, 1, 0],
    [0, 1.02, 0.5],
    [0.5, 0.95, 0.9],
    [-0.5, 0.8, -0.8],
  ];
  field.update(frame);
  const baseline = probes.map((p) => field.distance(p[0]!, p[1]!, p[2]!));
  assert.ok(field.planeCounts[0]! > 0 && field.planeCounts[0]! <= 6);
  const rotation = [0.3, -0.4, 0.5] as const,
    euler = new Euler(...rotation),
    scale = 1.4;
  field.update({
    sources: [-1, 1].map((x) => ({
      position: new Vector3(x, 0, 0).multiplyScalar(scale).applyEuler(euler).toArray(),
      rotation,
      scale,
    })),
    targets: [{ rotation, scale }],
    morph: 0,
    tension: 0.6 * scale,
  });
  probes.forEach((p, i) => {
    const world = new Vector3(...p).multiplyScalar(scale).applyEuler(euler);
    close(field.distance(world.x, world.y, world.z), baseline[i]! * scale);
  });
  const sample = (delta: number) => {
    field.update({
      ...frame,
      sources: [frame.sources[0]!, { position: [1, delta, 0], rotation: [0, 0, delta] }],
    });
    for (let i = 0; i < field.planeCounts[0]!; i++)
      close(
        Math.hypot(field.planes[i * 4]!, field.planes[i * 4 + 1]!, field.planes[i * 4 + 2]!),
        1,
      );
    return probes.map((p) => field.distance(p[0]!, p[1]!, p[2]!));
  };
  for (const delta of [-0.6, -0.12, -0.001, 0, 0.001, 0.12, 0.6]) {
    const before = sample(delta),
      after = sample(delta + 1e-4);
    before.forEach((d, i) =>
      assert.ok(
        Math.abs(d - after[i]!) < 0.002,
        'Plane activation must not introduce a field jump',
      ),
    );
  }
});
test('curved targets do not cut artificial folds into the source contact', () => {
  const sources = [volumeBox([1.15, 1.15, 0.97]), volumeSphere(0.575)];
  const capsule = volumeField(sources, [volumeCapsule(0.62, 2.6)]);
  const sphere = volumeField(sources, [volumeSphere(0.8)]);
  const frame: VolumeFrame = {
    sources: [{ position: [-0.55, 0, 0] }, { position: [0.55, 0, 0] }],
    morph: 0,
    tension: 0.6,
    targets: [{}],
  };
  capsule.update(frame);
  sphere.update(frame);
  assert.equal(capsule.planeCounts[0], 0);
  assert.equal(sphere.planeCounts[0], 0);
  for (const x of [-0.4, 0, 0.4])
    for (const y of [-0.5, 0, 0.5])
      assert.equal(
        capsule.distance(x, y, 0.4),
        sphere.distance(x, y, 0.4),
        'Contact depends on the source forms before global morphing',
      );
});
test('shape descriptors are validated before upload and detached from mutable author input', () => {
  assert.throws(() => volumeBox([1, 1, 1], 0.6), /Rounding/);
  assert.throws(() => volumeSphere(0), /positive/);
  assert.throws(() => volumeCapsule(1, 1), /round ends/);
  const target = volumeSphere(1);
  for (const shape of [
    { kind: 'box', size: [1, 1, 1], rounding: -0.1 },
    { kind: 'sphere', radius: -1 },
    { kind: 'capsule', radius: 1, length: 1 },
    { kind: 'unknown', radius: 1 },
    { kind: 'sphere', radius: 1e100 },
    { kind: 'sphere', radius: 1e-100 },
  ])
    assert.throws(() => volumeField([shape as VolumeShape], [target]));
  const size: [number, number, number] = [2, 2, 2];
  const shape = volumeBox(size),
    sources = [shape],
    targets = [target];
  const morph = volumeField(sources, targets);
  size[0] = 20;
  sources.push(target);
  targets.push(shape);
  morph.update({ sources: [{}], morph: 0, tension: 0, targets: [{}] });
  assert.equal(morph.count, 1);
  assert.equal(morph.targetCount, 1);
  close(morph.distance(1, 0, 0), 0);
});

test('one volume can cut into three independently posed target pieces and replay', () => {
  const box = volumeBox([2, 1, 1]);
  const field = volumeField([volumeBox([6, 1, 1])], [box, box, box]);
  const frame: VolumeFrame = {
    sources: [{}],
    targets: [-3, 0, 3].map((x) => ({ position: [x, 0, 0] })),
    morph: 1,
    tension: 0,
  };
  field.update(frame);
  for (const x of [-3, 0, 3]) assert.ok(field.distance(x, 0, 0) < 0);
  for (const x of [-1.5, 1.5]) assert.ok(field.distance(x, 0, 0) > 0);
  field.update({ ...frame, morph: 0 });
  assert.ok(field.distance(1.5, 0, 0) < 0);
  field.update(frame);
  assert.ok(field.distance(1.5, 0, 0) > 0);
  assert.ok(field.bounds.min.x <= -4 && field.bounds.max.x >= 4);
});

test('per-axis scaling keeps measured faces and automatic bounds aligned', () => {
  const field = volumeField([volumeBox([1, 1, 1])], [volumeSphere(1)]);
  field.update({
    sources: [{ scale: [6, 2, 1], position: [1, 0, 0] }],
    targets: [{}],
    morph: 0,
    tension: 0,
  });
  close(field.distance(4, 0, 0), 0);
  close(field.distance(1, 1, 0), 0);
  close(field.distance(1, 0, 0.5), 0);
  assert.ok(field.distance(4.1, 0, 0) > 0);
});
