import test from 'node:test';
import assert from 'node:assert/strict';
import { Group } from 'three';
import { volumeField, volumeBox } from '../dist/viewport/morph/field.js';
import { world3D } from '../dist/physics/world3d.js';
import { physicalVolume } from '../dist/physics/morph-3d.js';

// Real packed renderer field; DOM is irrelevant to Rapier's contact calculation.
function surface(field) {
  const changes = new Set(),
    cleanups = new Set();
  let revision = 0;
  return {
    object: new Group(),
    get geometry() {
      return { bounds: field.bounds, distance: field.distance, revision };
    },
    onChange(fn) {
      changes.add(fn);
      return () => changes.delete(fn);
    },
    onDispose(fn) {
      cleanups.add(fn);
      return () => cleanups.delete(fn);
    },
    render(frame) {
      field.update(frame);
      revision++;
      for (const fn of changes) fn();
    },
    dispose() {
      for (const fn of cleanups) fn();
    },
  };
}

test('morphing field supports, lifts and releases real surrounding bodies; restored handles remain live', async () => {
  const world = await world3D();
  const field = volumeField(
    [volumeBox([4, 0.4, 2])],
    [volumeBox([1.4, 0.4, 2]), volumeBox([1.4, 0.4, 2])],
  );
  const view = surface(field);
  const frame = {
    sources: [{}],
    targets: [{ position: [-1.3, 0, 0] }, { position: [1.3, 0, 0] }],
    morph: 0,
    tension: 0,
  };
  view.render(frame);
  const binding = physicalVolume(world, view, { id: 'morph', cellSize: 0.1 });
  const ball = world.body('ball', { shape: { sphere: 0.2 }, at: [0, 1, 0] });
  try {
    world.step(240);
    assert.ok(Math.abs(ball.position[1] - 0.4) < 0.04, `supported at ${ball.position[1]}`);
    const snapshot = world.snapshot();
    // Raise the supporting surface gradually. There is no per-object animation of the ball.
    for (let i = 1; i <= 60; i++) {
      view.render({ ...frame, sources: [{ position: [0, i / 120, 0] }] });
      world.step(2);
    }
    world.step(60);
    assert.ok(ball.position[1] > 0.83, `lifted to ${ball.position[1]}`);
    view.render(frame);
    world.restore(snapshot);
    assert.ok(binding.collider.isEnabled());
    view.render({ ...frame, morph: 1 });
    world.step(120);
    assert.ok(ball.position[1] < -1, `ball falls through a real gap: ${ball.position[1]}`);
    view.dispose();
    assert.equal(world.size, 1);
    binding.dispose();
  } finally {
    world.dispose();
  }
});

test('contact follows the whole object transform and rejects a sheared hierarchy', async () => {
  const world = await world3D();
  const field = volumeField([volumeBox([2, 1, 1])], [volumeBox([2, 1, 1])]);
  const view = surface(field),
    parent = new Group();
  parent.add(view.object);
  view.render({ sources: [{}], targets: [{}], morph: 0 });
  const binding = physicalVolume(world, view, { id: 'hierarchy', cellSize: 0.1 });
  try {
    parent.position.set(3, 2, 1);
    parent.rotation.z = Math.PI / 4;
    parent.scale.set(2, 1, 1);
    binding.sync();
    world.step();
    assert.ok(binding.collider.containsPoint({ x: 3, y: 2, z: 1 }));
    assert.equal(
      view.object.position.length(),
      0,
      'Physics follows the visual owner without moving its child',
    );
    view.object.rotation.z = Math.PI / 4;
    assert.throws(() => binding.sync(), /shear/);
    view.object.rotation.z = 0;
    binding.sync();
  } finally {
    world.dispose();
  }
});
