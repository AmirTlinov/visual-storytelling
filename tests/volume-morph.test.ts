import test from 'node:test';
import assert from 'node:assert/strict';
import { BufferAttribute, Euler, Vector3 } from 'three';
import { volumeContour } from '../src/viewport/morph/contour.ts';
import {
  volumeBox,
  volumeSphere,
  volumeCapsule,
  volumeField,
} from '../src/viewport/morph/field.ts';

test('volume primitives preserve their outer dimensions and rounded box faces', () => {
  const box = volumeBox([2, 4, 6], 0.2),
    sphere = volumeSphere(2),
    capsule = volumeCapsule(1, 4);
  assert.ok(Math.abs(box(1, 0, 0)) < 1e-12);
  assert.ok(Math.abs(box(0, 2, 0)) < 1e-12);
  assert.ok(box(1, 2, 3) > 0);
  assert.equal(sphere(0, 2, 0), 0);
  assert.equal(capsule(2, 0, 0), 0);
  assert.equal(capsule(0, 1, 0), 0);
  assert.ok(capsule(0, 0, 0) < 0);
  assert.throws(() => volumeBox([1, 1, 1], 0.6), /Rounding/);
  assert.throws(() => volumeSphere(0), /positive/);
});

test('volume poses agree with Three XYZ rotation, translation and uniform scale', () => {
  const box = volumeBox([1, 2, 3]),
    morph = volumeField([box], volumeSphere(1));
  const rotation = [0.35, -0.6, 0.7] as const,
    position = [2, -3, 1] as const,
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
    assert.ok(
      Math.abs(morph.distance(world.x, world.y, world.z) - box(p[0]!, p[1]!, p[2]!) * scale) <
        1e-12,
    );
  }
});

test('parallel flat faces first join locally and finish as the exact target field', () => {
  const box = volumeBox([2, 2, 2]),
    target = volumeCapsule(1, 4),
    morph = volumeField([box, box], target);
  const sources = [{ position: [-1.1, 0, 0] as const }, { position: [1.1, 0, 0] as const }];
  morph.update({ sources, morph: 0, tension: 0 });
  assert.ok(morph.distance(0, 0, 0) > 0, 'The initial gap must remain empty');
  morph.update({ sources, morph: 0, tension: 0.6 });
  assert.ok(morph.distance(0, 0, 0) < 0, 'A bridge joins the centers of the facing surfaces');
  assert.ok(
    morph.distance(0, 0.9, 0.9) > 0,
    'Contact must not fill both entire flat faces at once',
  );
  const middle = morph.distance(0.1, 0.2, 0.3);
  morph.update({ sources, morph: 1, tension: 0.6 });
  for (const p of [
    [0, 0, 0],
    [1, 0.6, 0],
    [2.2, 0, 0],
  ])
    assert.equal(morph.distance(p[0]!, p[1]!, p[2]!), target(p[0]!, p[1]!, p[2]!));
  morph.update({ sources, morph: 0, tension: 0.6 });
  assert.equal(
    morph.distance(0.1, 0.2, 0.3),
    middle,
    'Reverse seek has no hidden simulation history',
  );
});

test('volume contour retains box planes and genuine creases on an anisotropic grid', () => {
  const contour = volumeContour([-2, -1.35, -1.35], [4, 2.7, 2.7], 32);
  const box = volumeBox([1.15, 1.15, 1.15]);
  assert.equal(contour.geometry.drawRange.count, 0);
  contour.update(box);
  const position = contour.geometry.getAttribute('position');
  const normal = contour.geometry.getAttribute('normal');
  assert.ok(contour.geometry.drawRange.count > 0);
  for (let i = 0; i < contour.geometry.drawRange.count; i++) {
    const p = [position.getX(i), position.getY(i), position.getZ(i)];
    const n = [normal.getX(i), normal.getY(i), normal.getZ(i)];
    assert.ok(p.every(Number.isFinite) && n.every(Number.isFinite));
    assert.ok(Math.abs(box(p[0]!, p[1]!, p[2]!)) < 0.005, 'Faces stay on the authored box');
    assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-6);
    assert.ok(p.reduce((dot, value, axis) => dot + value * n[axis]!, 0) > 0.5, 'Normals face out');
  }
  const lines = contour.outline.getAttribute('position');
  assert.ok(contour.outline.drawRange.count > 0);
  for (let i = 0; i < contour.outline.drawRange.count; i++) {
    const p = [lines.getX(i), lines.getY(i), lines.getZ(i)];
    assert.ok(
      p.filter((value) => Math.abs(Math.abs(value) - 0.575) < 0.005).length >= 2,
      'Each stroke follows a real box edge',
    );
  }
  contour.geometry.dispose();
  contour.outline.dispose();
});

test('volume contour rounds cleanly and clears or restores its buffers without stale edges', () => {
  const contour = volumeContour([-2, -2, -2], [4, 4, 4], 32);
  const sphere = volumeSphere(0.69);
  contour.update(sphere);
  const position = contour.geometry.getAttribute('position');
  assert.ok(position instanceof BufferAttribute);
  const normal = contour.geometry.getAttribute('normal');
  const vertices = contour.geometry.drawRange.count;
  const initial = position.array.slice(0, vertices * 3);
  assert.equal(contour.outline.drawRange.count, 0, 'A sphere has no sharp creases');
  for (let i = 0; i < vertices; i++) {
    const p = [position.getX(i), position.getY(i), position.getZ(i)];
    assert.ok(Math.abs(sphere(p[0]!, p[1]!, p[2]!)) < 0.01);
    assert.ok(p[0]! * normal.getX(i) + p[1]! * normal.getY(i) + p[2]! * normal.getZ(i) > 0.67);
  }
  contour.update(volumeBox([1.15, 1.15, 1.15]));
  assert.ok(contour.outline.drawRange.count > 0);
  contour.update(sphere);
  assert.equal(contour.outline.drawRange.count, 0);
  assert.deepEqual(position.array.slice(0, vertices * 3), initial);
  const version = position.version;
  contour.update(() => 1);
  assert.equal(contour.geometry.drawRange.count, 0);
  assert.equal(contour.outline.drawRange.count, 0);
  assert.equal(position.version, version, 'Empty surfaces do not upload an unused GPU buffer');
  contour.geometry.dispose();
  contour.outline.dispose();
});

test('volume contour stops before overrunning its fixed surface budget', () => {
  const contour = volumeContour([-1, -1, -1], [2, 2, 2], 16);
  assert.throws(() => contour.update((x) => Math.cos(Math.PI * 8 * x)), /triangle budget/);
  contour.geometry.dispose();
  contour.outline.dispose();
});
