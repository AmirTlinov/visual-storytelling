import test from 'node:test';
import assert from 'node:assert/strict';
import { Euler, Vector3 } from 'three';
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
