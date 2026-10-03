import test from 'node:test';
import assert from 'node:assert/strict';
import { Euler, Vector3 } from 'three';
import {
  volumeBox,
  volumeSphere,
  volumeCapsule,
  volumeField,
  type VolumeFrame,
  type VolumeShape,
} from '../dist/viewport/morph/field.js';

const distanceOf = (shape: VolumeShape) => volumeField([shape], shape).distance;
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
  const morph = volumeField([box], volumeSphere(1));
  const rotation = [0.35, -0.6, 0.7] as const;
  const position = [2, -3, 1] as const,
    scale = 1.7;
  morph.update({ sources: [{ position, rotation, scale }], morph: 0, tension: 0 });
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
  morph.update({ sources: [{}], target: { position, rotation, scale }, morph: 1 });
  const surface = new Vector3(0, 1, 0)
    .multiplyScalar(scale)
    .applyEuler(new Euler(...rotation))
    .add(new Vector3(...position));
  close(morph.distance(surface.x, surface.y, surface.z), 0, 'The target receives its own pose');
});

test('contact fills facing surfaces without pinching the seam or rounding free corners', () => {
  const box = volumeBox([2, 2, 2]),
    target = volumeBox([4.2, 2, 2]);
  const morph = volumeField([box, box], target),
    targetDistance = distanceOf(target);
  const sources = [{ position: [-1.1, 0, 0] as const }, { position: [1.1, 0, 0] as const }];
  morph.update({ sources, morph: 0, tension: 0 });
  assert.ok(morph.distance(0, 0, 0) > 0, 'The initial gap remains empty');
  morph.update({ sources, morph: 0, tension: 0.6 });
  assert.ok(morph.distance(0, 0, 0) < 0, 'A bridge joins the facing surfaces');
  assert.ok(morph.distance(0, 0.9, 0.9) < 0, 'Contact reaches the rim without an artificial waist');
  close(morph.distance(2.1, 1, 1), 0, 'The opposite corner stays on the rigid source');
  close(morph.distance(-2.1, 1, 1), 0);
  const middle = morph.distance(0.1, 0.2, 0.3);
  morph.update({ sources, morph: 1, tension: 0.6 });
  for (const p of [
    [0, 0, 0],
    [1, 0.6, 0],
    [2.2, 0, 0],
  ])
    assert.equal(morph.distance(p[0]!, p[1]!, p[2]!), targetDistance(p[0]!, p[1]!, p[2]!));
  morph.update({ sources, morph: 0, tension: 0.6 });
  assert.equal(morph.distance(0.1, 0.2, 0.3), middle, 'Reverse seek has no simulation history');
  for (const separation of [1, 0.98, 0.95]) {
    morph.update({
      sources: [{ position: [-separation, 0, 0] }, { position: [separation, 0, 0] }],
      morph: 0,
      tension: 0.6,
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
  const morph = volumeField([box, box], volumeBox([3, 2, 3]));
  const frame: VolumeFrame = {
    sources: [{ position: [-1, 0, 0] }, { position: [1, 0, 0] }],
    morph: 0.3,
    tension: 0.4,
  };
  const transforms = morph.transforms,
    scales = morph.scales,
    planes = morph.planes;
  const snapshot = () => ({
    transforms: [...morph.transforms],
    scales: [...morph.scales],
    planes: [...morph.planes],
    planeCount: morph.planeCount,
    morph: morph.morph,
    tension: morph.tension,
    distance: morph.distance(0.2, 0.1, -0.3),
  });
  morph.update(frame);
  const before = snapshot();
  for (const invalid of [
    { ...frame, morph: 0.8, target: { position: [Infinity, 0, 0] } },
    { ...frame, sources: [{ position: [5, 0, 0] }, { scale: 0 }] },
    { ...frame, sources: [{ position: [1e100, 0, 0] }, {}] },
    { ...frame, tension: 1e100 },
  ] as VolumeFrame[]) {
    assert.throws(() => morph.update(invalid));
    assert.deepEqual(snapshot(), before);
  }
  morph.update({ sources: [{}, {}], morph: 1 });
  morph.update(frame);
  assert.deepEqual(snapshot(), before);
  assert.equal(morph.transforms, transforms);
  assert.equal(morph.scales, scales);
  assert.equal(morph.planes, planes);
});

test('shared planes follow rotated boxes and fade continuously under small pose changes', () => {
  const box = volumeBox([2, 2, 2]),
    field = volumeField([box, box], volumeBox([4.2, 2, 2]));
  const frame: VolumeFrame = {
    sources: [{ position: [-1, 0, 0] }, { position: [1, 0, 0] }],
    morph: 0,
    tension: 0.6,
  };
  const probes = [
    [0, 1, 0],
    [0, 1.02, 0.5],
    [0.5, 0.95, 0.9],
    [-0.5, 0.8, -0.8],
  ];
  field.update(frame);
  const baseline = probes.map((p) => field.distance(p[0]!, p[1]!, p[2]!));
  assert.ok(field.planeCount > 0 && field.planeCount <= 6);
  const rotation = [0.3, -0.4, 0.5] as const,
    euler = new Euler(...rotation),
    scale = 1.4;
  field.update({
    sources: [-1, 1].map((x) => ({
      position: new Vector3(x, 0, 0).multiplyScalar(scale).applyEuler(euler).toArray(),
      rotation,
      scale,
    })),
    target: { rotation, scale },
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
    for (let i = 0; i < field.planeCount; i++)
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
  const capsule = volumeField(sources, volumeCapsule(0.62, 2.6));
  const sphere = volumeField(sources, volumeSphere(0.8));
  const frame: VolumeFrame = {
    sources: [{ position: [-0.55, 0, 0] }, { position: [0.55, 0, 0] }],
    morph: 0,
    tension: 0.6,
  };
  capsule.update(frame);
  sphere.update(frame);
  assert.equal(capsule.planeCount, 0);
  assert.equal(sphere.planeCount, 0);
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
    assert.throws(() => volumeField([shape as VolumeShape], target));
  const size: [number, number, number] = [2, 2, 2];
  const shape = volumeBox(size),
    sources = [shape];
  const morph = volumeField(sources, target);
  size[0] = 20;
  sources.push(target);
  morph.update({ sources: [{}], morph: 0, tension: 0 });
  assert.equal(morph.count, 1);
  close(morph.distance(1, 0, 0), 0);
});
