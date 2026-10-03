import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({
  stdin: {
    contents:
      "export * from './src/physics/world2d.ts';export * from './src/physics/fusion-track.ts';export * from './src/ink/fusion/motion.ts';export * from './src/ink/fusion/transport.ts';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { world2D, fusionTrack, inkMotion, inkRoutes } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

test('Rapier deforms ink, preserves endpoints and reuses deterministic history on reverse seek', async () => {
  const path = [
    [-20, -12, 2],
    [10, -15, 2],
    [20, 12, 2],
  ];
  const routes = inkRoutes([path], [path], [path]);
  const motion = inkMotion(routes);
  const frame = (time) => ({
    sources: [
      { x: -120, y: 0 },
      { x: 120, y: 0 },
    ],
    morph: time / 2,
  });
  const world = await world2D({ gravity: [0, 0] });
  const track = fusionTrack(world, motion, frame, 2);
  const flatten = (data) => data.flatMap((a) => Array.from(a));
  try {
    assert.equal(track.stats.particles, 18);
    assert.deepEqual(
      flatten(track.sample(0)),
      flatten(motion(frame(0).sources, { x: 0, y: 0 }, 0)),
    );
    assert.deepEqual(
      flatten(track.sample(2)),
      flatten(motion(frame(0).sources, { x: 0, y: 0 }, 1)),
    );
    assert.equal(track.stats.steps, 0, 'A direct seek to the exact endpoint needs no simulation');
    const middle = flatten(track.sample(0.6));
    const guide = flatten(motion(frame(0).sources, { x: 0, y: 0 }, 0.3));
    const deformation = Math.max(...middle.map((v, i) => Math.abs(v - guide[i])));
    assert.ok(deformation > 0.001 && deformation < 10, `elastic displacement: ${deformation}`);
    const owner = routes.find((route) => route.attachment === undefined);
    const donor = routes.find((route) => route.attachment !== undefined);
    // Check the contact throughout settling, not equality of two complete copies.
    for (const time of [1.4, 1.6, 1.8, 1.95]) {
      const joined = track.sample(time);
      const index = donor.attachment;
      const last = index === owner.to.length - 1;
      const at = last ? (index - 1) * 6 + 2 : index * 6;
      const dx = joined[owner.source][at] - joined[donor.source][0];
      const dy = joined[owner.source][at + 1] - joined[donor.source][1];
      assert.ok(Math.hypot(dx, dy) < 0.001, 'Rapier must keep the absorbed ink on its owner');
    }
    const end = flatten(track.sample(2));
    assert.deepEqual(end, flatten(motion(frame(0).sources, { x: 0, y: 0 }, 1)));
    const steps = track.stats.steps;
    assert.deepEqual(flatten(track.sample(0.6)), middle);
    assert.equal(track.stats.steps, steps, 'Reverse seek reuses the existing Rapier result');
    assert.ok(track.stats.cacheBytes < 100_000);
    assert.ok(middle.every(Number.isFinite));
  } finally {
    track.dispose();
    assert.equal(world.size, 0);
    track.dispose();
    world.dispose();
  }
  assert.throws(() => track.sample(1), /disposed/);
});
