import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('InkMorph retimes Rapier from speech while preserving correspondence and seek history', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'fusion-duration-'));
  const file = join(directory, 'test.mjs');
  t.after(() => rm(directory, { recursive: true, force: true }));
  await build({
    stdin: {
      contents:
        "export { InkMorph } from './src/morph/ink-operation.ts'; export { cueSheet } from './src/story/cues.ts';",
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: file,
    plugins: [
      {
        name: 'capture-raster-boundary',
        setup(build) {
          build.onLoad({ filter: /src\/ink\/fusion\/surface\.ts$/ }, () => ({
            // Only the GPU/DOM boundary is replaced. Correspondence, timing,
            // physicalFusion and the actual Rapier solver are exercised together.
            contents: `
            import { compileInkMotion } from './motion.ts';
            export function fusionSurface(host) {
              let motion;
              return {
                canvas: {setAttribute() {}}, setSize() {},
                setShapes(sources, targets) {
                  host.compilations++;
                  return motion = compileInkMotion(sources, targets);
                },
                render(frame, vertices) {
                  host.vertices = vertices.flatMap((v) => Array.from(v));
                  const guide = motion(frame.sources, frame.targets, frame.morph)
                    .flatMap((v) => Array.from(v));
                  host.deformation = Math.max(...host.vertices.map((v, i) => Math.abs(v - guide[i])));
                },
                dispose() { host.removed = true; },
              };
            }`,
            loader: 'ts',
            resolveDir: resolve('src/ink/fusion'),
          }));
        },
      },
    ],
  });
  const { InkMorph, cueSheet } = await import(pathToFileURL(file));
  const original = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'ResizeObserver', original);
    else delete globalThis.ResizeObserver;
  });
  const attributes = new Map(),
    properties = new Map();
  const host = {
    getAttribute: (key) => attributes.get(key) ?? null,
    setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: (key) => attributes.delete(key),
    style: {
      height: '100px',
      getPropertyValue: (key) => properties.get(key) ?? '',
      getPropertyPriority: () => '',
      setProperty: (key, value) => properties.set(key, value),
      removeProperty: (key) => properties.delete(key),
    },
    compilations: 0,
    getBoundingClientRect: () => ({ width: 480 }),
    getClientRects: () => [{}],
  };
  const shape = {
    width: 40,
    height: 30,
    bounds: { width: 40, height: 30 },
    paths: [
      [
        [-20, -12, 2],
        [10, -15, 2],
        [20, 12, 2],
      ],
    ],
  };
  const ink = await InkMorph.mount(host, { sources: [shape, shape], targets: [shape] });
  t.after(() => ink.dispose());
  const frame = (duration, progress) =>
    cueSheet({
      duration,
      cues: { change: { start: 0, end: duration } },
    }).at(duration * progress);
  ink.render(frame(1, 0.25), 'change');
  const fast = host.deformation;
  ink.render(frame(8, 0.25), 'change');
  const slow = host.deformation,
    pose = host.vertices.slice();
  assert.ok(fast > slow * 1.5 && fast > 0.001, 'faster writing supplies more elastic displacement');
  assert.equal(host.compilations, 1, 'retiming preserves the compiled stroke correspondence');
  ink.render(frame(8, 0.65), 'change');
  const cachedSteps = ink.stats.steps;
  ink.render(frame(8, 0.25), 'change');
  assert.deepEqual(host.vertices, pose);
  assert.equal(
    ink.stats.steps,
    cachedSteps,
    'an unchanged cue duration preserves the physics cache',
  );
  ink.render(0.25);
  assert.deepEqual(host.vertices, pose, 'manual exploration keeps the last speech duration');
  const invalid = frame(8, 0.25);
  for (const duration of [NaN, Infinity, -1]) {
    assert.throws(
      () => ink.render({ ...invalid, cue: () => ({ start: 0, end: duration }) }, 'change'),
      /duration/,
    );
    assert.deepEqual(host.vertices, pose, 'invalid retiming does not publish partial geometry');
  }
  const instant = cueSheet({ duration: 1, cues: { change: { start: 0.5, end: 0.5 } } });
  for (const [time, progress] of [
    [0.4, 0],
    [0.5, 1],
  ]) {
    ink.render(progress);
    const endpoint = host.vertices.slice();
    ink.render(instant.at(time), 'change');
    assert.deepEqual(host.vertices, endpoint, 'zero-length cues select the exact endpoint');
    assert.equal(ink.stats.steps, cachedSteps, 'an instant cue needs no simulation');
  }
  const disk = { width: 36, height: 36, bounds: { width: 36, height: 36 }, paths: [[[0, 0, 18]]] };
  ink.setOperation({ sources: [disk], targets: [shape] });
  assert.equal(ink.progress, 0, 'replacing an operation starts at its source, like Morph2D/3D');
  assert.ok(host.vertices.length > 0 && host.vertices.every(Number.isFinite));
  for (const p of [0.4, 1, 0]) ink.render(p);
  assert.ok(
    host.vertices.every(Number.isFinite),
    'one medial disk point remains valid during morph',
  );
  ink.dispose();
  assert.equal(host.removed, true);
  assert.equal(host.style.height, '100px');
});
