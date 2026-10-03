import test from 'node:test';
import assert from 'node:assert/strict';
import { world2D } from '../dist/physics/world2d.js';
import { world3D } from '../dist/physics/world3d.js';
import { meshSurface } from '../dist/physics/mesh-surface.js';
import { SphereGeometry } from 'three';

for (const dimension of [2, 3]) {
  const create = dimension === 2 ? world2D : world3D;
  const point = (x, y) => (dimension === 2 ? [x, y] : [x, y, 0]);
  const ball = dimension === 2 ? { circle: 0.4 } : { sphere: 0.4 };
  test(`${dimension}D contact deforms soft material, supports solids and replays snapshots`, async () => {
    const world = await create();
    try {
      world.body('floor', {
        fixed: true,
        at: point(0, dimension === 2 ? 3 : -0.1),
        shape: { box: dimension === 2 ? [8, 0.2] : [8, 0.2, 8] },
      });
      const solid = world.body('solid', { shape: ball, at: point(0, dimension === 2 ? 0 : 2) });
      const soft = world.body('soft', {
        shape: ball,
        material: 'jelly',
        at: point(2, dimension === 2 ? 0 : 2),
      });
      const initial = world.snapshot();
      world.step(240);
      assert.ok(Math.abs(solid.position[1] - (dimension === 2 ? 2.5 : 0.4)) < 0.02);
      const particles = soft.soft.particlePositions();
      const y = [...particles].filter((_, i) => i % dimension === 1);
      assert.ok(Math.max(...y) - Math.min(...y) < 0.78, 'contact visibly compresses the body');
      assert.ok(
        Math.min(...y) > (dimension === 2 ? 1.8 : -0.05),
        'soft surface remains on the floor',
      );
      const settled = { solid: solid.position, soft: [...particles] };
      world.restore(initial);
      world.step(240);
      assert.deepEqual(
        { solid: solid.position, soft: [...soft.soft.particlePositions()] },
        settled,
      );
      world.restore(initial);
      world.advance(1 / 60);
      world.advance(1 / 60);
      const viaFrames = solid.position;
      world.restore(initial);
      world.step(4);
      assert.deepEqual(solid.position, viaFrames);
      soft.dispose();
      assert.throws(() => world.restore(initial), /same world and set/);
    } finally {
      world.dispose();
      world.dispose();
    }
  });
  test(`${dimension}D spring transfers motion without per-frame author commands`, async () => {
    const world = await create({ gravity: point(0, 0) });
    try {
      const a = world.body('anchor', { shape: ball, at: point(0, 0), fixed: true });
      const b = world.body('weight', { shape: ball, at: point(2, 0) });
      const spring = world.spring(a, b, { length: 1, stiffness: 30, damping: 8 });
      world.step(120);
      assert.ok(Math.abs(b.position[0] - 1) < 0.08);
      spring.dispose();
      assert.equal(world.raw.impulseJoints.len(), 0);
    } finally {
      world.dispose();
    }
  });
}

test('a standard Three sphere joins physics seams while retaining original visual vertices', async () => {
  const geometry = new SphereGeometry(0.44, 24, 16);
  const positions = geometry.attributes.position.array;
  const surface = meshSurface(positions, new Uint32Array(geometry.index.array));
  assert.ok(surface.vertices.length < positions.length);
  for (const i of new Set(geometry.index.array))
    for (let axis = 0; axis < 3; axis++)
      assert.ok(
        Math.abs(
          positions[i * 3 + axis] - surface.vertices[surface.visualToPhysical[i] * 3 + axis],
        ) < 1e-6,
      );
  const world = await world3D();
  try {
    const body = world.body('sphere', { shape: { ...surface, cellSize: 0.23 }, material: 'jelly' });
    assert.equal(body.soft.meshVertices(0).length, surface.vertices.length);
    assert.ok(
      body.soft.numParticles() < positions.length / 3,
      'simulation resolution is independent of visual detail',
    );
  } finally {
    world.dispose();
    geometry.dispose();
  }
});
