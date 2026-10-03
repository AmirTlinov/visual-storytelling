import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({
  stdin: {
    contents:
      "export * from './src/physics/world2d.ts'; export * from './src/physics/morph-2d.ts'; export * from './src/ink/fusion/geometry.ts';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { world2D, physicalMorph2D, inkGeometry, inkVoxels } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text + '\n//# sourceURL=fusion-morph-2d.bundle.mjs').toString('base64')}`
);

function field(sources, tension = 0, revision = 1) {
  const segments = sources.map((source) => new Float32Array(source));
  return inkGeometry(
    segments,
    segments.map((data) => new Float32Array(data.length / 6).fill(1)),
    [],
    tension,
    revision,
  );
}

test('ink contact grid samples the same visible field, including the smooth bridge', () => {
  const geometry = field(
    [
      [-8, 0, -8, 0, 5, 5],
      [8, 0, 8, 0, 5, 5],
    ],
    16,
  );
  assert.equal(geometry.distance(0, 0), -1);
  assert.ok(geometry.distance(0, 12) > 0);
  const cells = inkVoxels(geometry, 1);
  const occupied = new Set(
    Array.from({ length: cells.length / 2 }, (_, i) => `${cells[i * 2]},${cells[i * 2 + 1]}`),
  );
  for (let i = 0; i < cells.length; i += 2)
    assert.ok(
      occupied.has(`${-cells[i] - 1},${-cells[i + 1] - 1}`),
      'A symmetric field remains symmetric around Rapier voxel centers',
    );
  assert.ok(
    Array.from({ length: cells.length / 2 }, (_, i) => i * 2).some(
      (i) => cells[i] === 0 && cells[i + 1] === 0,
    ),
  );
});

test('external bodies land on displayed ink, wake after separation, and native handles survive restore', async () => {
  const changes = new Set(),
    disposal = new Set();
  const surface = {
    geometry: field([[-90, 0, 90, 0, 5, 5]]),
    onChange(listener) {
      changes.add(listener);
      listener(this.geometry);
      return () => changes.delete(listener);
    },
    onDispose(listener) {
      disposal.add(listener);
      return () => disposal.delete(listener);
    },
  };
  const world = await world2D();
  const obstacle = physicalMorph2D(world, surface, { id: 'ink-floor', scale: 100, cellSize: 1 });
  const ball = world.body('ball', { shape: { circle: 0.1 }, at: [0, -1] });
  try {
    world.step(240);
    assert.ok(
      ball.position[1] > -0.2 && ball.position[1] < -0.13,
      `contact height ${ball.position[1]}`,
    );
    const snapshot = world.snapshot();
    const before = obstacle.rigid;
    world.step(2);
    world.restore(snapshot);
    assert.notEqual(obstacle.rigid, before);
    assert.ok(obstacle.collider.isEnabled());
    ball.rigid.sleep();
    surface.geometry = field(
      [
        [-150, 0, -120, 0, 5, 5],
        [120, 0, 150, 0, 5, 5],
      ],
      0,
      2,
    );
    for (const listener of changes) listener(surface.geometry);
    assert.equal(ball.rigid.isSleeping(), false);
    world.restore(snapshot);
    assert.equal(
      obstacle.collider.containsPoint({ x: 0, y: 0 }),
      false,
      'Restoring native state reapplies the currently displayed split field',
    );
    world.step(120);
    assert.ok(ball.position[1] > 2, 'The ball falls through the newly opened gap');
    for (const cleanup of [...disposal]) cleanup();
    assert.equal(world.size, 1);
    assert.equal(changes.size, 0);
    assert.equal(obstacle.disposed, true);
  } finally {
    world.dispose();
  }
});
