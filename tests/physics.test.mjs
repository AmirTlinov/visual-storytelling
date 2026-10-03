import test from 'node:test';
import assert from 'node:assert/strict';
import { world2D } from '../dist/physics/world2d.js';
import { world3D } from '../dist/physics/world3d.js';
import { meshSurface } from '../dist/physics/mesh-surface.js';
import { meshPose } from '../dist/physics/mesh-pose.js';
import { SphereGeometry, BoxGeometry, Mesh, Group, Vector3, Quaternion } from 'three';

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
  test(`${dimension}D removing a body releases its springs once and leaves the world usable`, async () => {
    const world = await create({ gravity: point(0, 0) });
    const a = world.body('anchor', { shape: ball, fixed: true });
    const b = world.body('weight', { shape: ball, at: point(2, 0), material: 'jelly' });
    const spring = world.spring(a, b, { length: 1, damping: 0 });
    world.step(30);
    assert.ok(b.position[0] < 2, 'the joint transfers force to deformable material');
    let removed = 0;
    b.onDispose(() => {
      removed++;
      b.dispose();
    });
    b.dispose();
    b.dispose();
    spring.dispose();
    assert.equal(removed, 1);
    assert.equal(b.disposed, true);
    assert.equal(world.size, 1);
    assert.equal(world.raw.impulseJoints.len(), 0);
    assert.throws(() => b.impulse(point(1, 0)), /removed/);
    const replacement = world.body('weight', { shape: ball, at: point(2, 0) });
    const next = world.spring(a, replacement);
    world.step();
    world.dispose();
    next.dispose();
    replacement.dispose();
    world.dispose();
    assert.equal(replacement.disposed, true);
    assert.throws(() => world.onRender(() => {}), /disposed/);
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

test('a rigid pose preserves world-space vertices inside a rotated, stretched parent', () => {
  const parent = new Group(),
    mesh = new Mesh(new BoxGeometry(1, 2, 3));
  parent.scale.set(2, 0.7, 1.4);
  parent.rotation.set(0.2, 0.4, 0.1);
  parent.position.set(3, 2, 1);
  mesh.position.set(1, 2, -1);
  mesh.rotation.set(0.3, 0.7, 0.2);
  parent.add(mesh);
  mesh.updateWorldMatrix(true, false);
  const before = mesh.matrixWorld.clone(),
    origin = mesh.getWorldPosition(new Vector3());
  const pose = meshPose(mesh);
  const position = new Vector3(4, 5, 6),
    rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.9);
  pose.update(position, rotation);
  mesh.updateWorldMatrix(true, false);
  const vertices = mesh.geometry.getAttribute('position');
  for (let i = 0; i < vertices.count; i++) {
    const vertex = new Vector3().fromBufferAttribute(vertices, i);
    const expected = vertex
      .clone()
      .applyMatrix4(before)
      .sub(origin)
      .applyQuaternion(rotation)
      .add(position);
    assert.ok(vertex.applyMatrix4(mesh.matrixWorld).distanceTo(expected) < 1e-10);
  }
  const displayed = Array.from({ length: vertices.count }, (_, i) =>
    new Vector3().fromBufferAttribute(vertices, i).applyMatrix4(mesh.matrixWorld),
  );
  pose.dispose();
  mesh.updateWorldMatrix(true, false);
  assert.equal(
    mesh.matrixAutoUpdate,
    false,
    'retain the exact sheared pose after releasing physics',
  );
  for (let i = 0; i < vertices.count; i++)
    assert.ok(
      new Vector3()
        .fromBufferAttribute(vertices, i)
        .applyMatrix4(mesh.matrixWorld)
        .distanceTo(displayed[i]) < 1e-10,
    );
  mesh.geometry.dispose();
  mesh.material.dispose();
});

test('releasing a decomposable rigid pose preserves the pose and restores authored controls', () => {
  const parent = new Group(),
    mesh = new Mesh(new BoxGeometry(1, 2, 3));
  parent.scale.setScalar(2);
  parent.rotation.set(0.2, 0.4, 0.1);
  mesh.rotation.set(0.3, 0.7, 0.2);
  parent.add(mesh);
  const pose = meshPose(mesh);
  pose.update(new Vector3(4, 5, 6), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.9));
  mesh.updateWorldMatrix(true, false);
  const vertices = mesh.geometry.getAttribute('position');
  const displayed = Array.from({ length: vertices.count }, (_, i) =>
    new Vector3().fromBufferAttribute(vertices, i).applyMatrix4(mesh.matrixWorld),
  );
  pose.dispose();
  mesh.updateWorldMatrix(true, false);
  assert.equal(mesh.matrixAutoUpdate, true);
  for (let i = 0; i < vertices.count; i++)
    assert.ok(
      new Vector3()
        .fromBufferAttribute(vertices, i)
        .applyMatrix4(mesh.matrixWorld)
        .distanceTo(displayed[i]) < 1e-10,
    );
  mesh.position.x += 1;
  mesh.updateWorldMatrix(true, false);
  assert.ok(
    Math.abs(
      new Vector3()
        .fromBufferAttribute(vertices, 0)
        .applyMatrix4(mesh.matrixWorld)
        .distanceTo(displayed[0]) - 2,
    ) < 1e-10,
    'ordinary authored movement remains active after releasing physics',
  );
  mesh.geometry.dispose();
  mesh.material.dispose();
});
