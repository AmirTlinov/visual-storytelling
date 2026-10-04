import test from 'node:test';
import assert from 'node:assert/strict';
import { PhysicsReplay } from '../dist/physics/replay.js';
import { world2D } from '../dist/physics/world2d.js';
import { world3D } from '../dist/physics/world3d.js';

for (const dimension of [2, 3])
  test(`${dimension}D replay matches direct fixed steps after seeks, impulses and topology rebasing`, async () => {
    const world = await (dimension === 2 ? world2D() : world3D());
    const point = (y) => (dimension === 2 ? [0, y] : [0, y, 0]);
    const shape = dimension === 2 ? { circle: 0.35 } : { sphere: 0.35 };
    try {
      const body = world.body('ball', {
        shape,
        at: point(dimension === 2 ? 0 : 2),
        material: 'rubber',
      });
      world.step(7);
      const initial = world.snapshot(),
        replay = PhysicsReplay.create(world, {
          duration: 2,
          checkpointEvery: 0.1,
          maxCheckpoints: 3,
        });
      const expected = new Map();
      for (const time of [0, 0.25, 0.7, 1.8]) {
        world.restore(initial);
        world.step(Math.round(time / world.stepSeconds));
        expected.set(time, body.position);
      }
      for (const time of [1.8, 0.25, 0.7, 0, 0.7, 1.8, 0.25]) {
        replay.seek(time);
        assert.deepEqual(body.position, expected.get(time));
      }
      body.impulse(point(40));
      replay.seek(0.7);
      assert.deepEqual(
        body.position,
        expected.get(0.7),
        'an out-of-band impulse cannot contaminate a recorded future',
      );
      world.body('extra', { shape, fixed: true });
      assert.throws(() => replay.seek(0), /topology changed/);
      replay.rebase();
      const rebased = body.position;
      replay.seek(1);
      replay.seek(0);
      assert.deepEqual(body.position, rebased);
      world.dispose();
      replay.dispose();
      assert.throws(() => replay.seek(0), /disposed/);
    } finally {
      world.dispose();
    }
  });
