import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { build } from 'esbuild';
import { captureScene } from '../tools/motion/scene-capture.mjs';
import { subjectDigests } from '../tools/motion/subject-digests.mjs';
import { buildEpisodes } from '../tools/motion/episodes.mjs';
import { queryEvidence } from '../tools/motion/inspection.mjs';

test('3D action targets use their existing semantic regions, including inscriptions', async () => {
  const out = await mkdtemp(join(tmpdir(), 'review-3d-subject-'));
  try {
    const capture = await captureScene({
      input: resolve('site/explorer-3d'),
      directory: true,
      out,
      cue: 'unit_volume',
      frames: 3,
      width: 480,
      height: 640,
      theme: 'light',
    });
    assert(capture.samples.length >= 3);
    assert(capture.samples.every((sample) => sample.subjects['unit-cube']));
    assert(capture.samples.some((sample) => sample.subjects['unit-cube'] !== 'hidden'));
    const episode = buildEpisodes(capture.samples, { context: capture.context }).find(
      (episode) => episode.cue === 'unit_volume',
    );
    assert.deepEqual(episode.observed.scope, { objects: ['unit-cube'] });
    assert(!episode.observations.some((text) => text.includes('Нет области')));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('hidden representations cannot overwrite visible subject evidence; missing targets are explicit', async () => {
  const png = await sharp({ create: { width: 40, height: 40, channels: 4, background: 'white' } })
    .png()
    .toBuffer();
  const first = { id: 'cube', x: 1, y: 1, width: 10, height: 10 },
    label = { id: 'cube', x: 20, y: 20, width: 10, height: 10 },
    hidden = { id: 'cube', x: 0, y: 0, width: 0, height: 0 };
  const before = await subjectDigests(png, [first, label, hidden]);
  assert.notEqual(before.cube, 'hidden');
  assert.deepEqual(before, await subjectDigests(png, [hidden, label, first]));
  assert.notDeepEqual(before, await subjectDigests(png, [first, { ...label, x: 21 }, hidden]));
  const [episode] = buildEpisodes(
    [
      { time: 0, subjects: before },
      { time: 1, subjects: before },
    ],
    {
      context: {
        review: {
          cues: [{ id: 'missing', kind: 'action', start: 0, end: 1, targets: ['unknown'] }],
        },
      },
    },
  );
  assert.deepEqual(episode.observed.scope.missing, ['unknown']);
  assert(episode.observations.some((text) => text.includes('unknown')));
  assert(!episode.observations.some((text) => text.includes('одинаковы')));
});

test('capture and point inspection agree on all visible DOM parts and hidden ancestors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'review-object-parts-'));
  try {
    await build({
      stdin: {
        contents: `import { mountScene } from './dist/scene-handle.js';
          mountScene(document.querySelector('main'), {duration:1, seek(){}, dispose(){}, snapshot:()=>({})});`,
        resolveDir: resolve('.'),
      },
      bundle: true,
      outfile: join(directory, 'index.js'),
      format: 'iife',
    });
    await writeFile(
      join(directory, 'index.html'),
      `<!doctype html><body style="margin:0">
      <main class="ve-scene" style="position:relative;width:300px;height:150px;background:white">
        <div data-object="cube" style="position:absolute;left:10px;top:10px;width:50px;height:40px;background:blue">First</div>
        <div data-object="cube" style="position:absolute;left:100px;top:80px;width:50px;height:40px;background:red">Second</div>
        <div data-object="cube" hidden>Hidden mirror</div>
        <div style="opacity:0"><div data-object="transparent" style="position:absolute;left:200px;top:10px;width:40px;height:40px">Transparent</div></div>
        <div aria-hidden="true"><div data-object="aria-hidden" style="position:absolute;left:200px;top:80px;width:40px;height:40px">Hidden from review</div></div>
        <div style="visibility:hidden"><div data-object="invisible" style="width:40px;height:40px">Invisible</div></div>
      </main><script src="index.js"></script>`,
    );
    const capture = await captureScene({
      input: directory,
      directory: true,
      out: join(directory, 'capture'),
      frames: 2,
      width: 375,
      height: 200,
      theme: 'light',
    });
    const data = { frames: capture.samples, source: capture.source };
    for (const point of [
      [30, 30],
      [120, 100],
    ])
      assert.equal(queryEvidence(data, { at: 0, point }).requested.object, 'cube');
    for (const point of [
      [80, 60],
      [220, 30],
      [220, 100],
    ])
      assert.equal(queryEvidence(data, { at: 0, point }).requested.object, undefined);
    const object = queryEvidence(data, { at: 0, object: 'cube' }).objects[0];
    assert.equal(object.representations.length, 2);
    assert.deepEqual(
      { x: object.x, y: object.y, width: object.width, height: object.height },
      { x: 10, y: 10, width: 140, height: 110 },
    );
    for (const id of ['transparent', 'aria-hidden', 'invisible']) {
      assert.equal(capture.samples[0].objects.find((o) => o.id === id).visible, false);
      assert.equal(capture.samples[0].subjects[id], 'hidden');
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('label hits retain their 3D owner and use part area, independent of record order', () => {
  const mesh = {
    id: 'cube',
    viewId: 'world',
    coordinates: 'css-viewport',
    x: 10,
    y: 10,
    width: 20,
    height: 20,
    text: 'The cube',
    sourceFile: '/actual/runtime.js',
    matrix: [1],
    parent: 'operation',
    data: { volume: 8 },
  };
  const label = {
    id: 'cube',
    coordinates: 'css-viewport',
    x: 80,
    y: 30,
    width: 10,
    height: 5,
    text: 'Visible label',
    textSource: 'dom-text-content',
  };
  const hidden = { ...label, visible: false, text: 'Hidden mirror' };
  const parent = { id: 'operation', x: 0, y: 0, width: 200, height: 100 };
  const data = {
    source: { viewport: { width: 100, height: 50 } },
    frames: [0, 1].map((time) => ({
      time,
      file: `${time}.png`,
      width: 200,
      height: 100,
      objects: [parent, { ...mesh, x: mesh.x + time }, label, hidden],
      views: [{ id: 'world', camera: { time }, receipt: { rendered: time } }],
    })),
  };
  const browserQuery = (0, eval)(`(${queryEvidence.toString()})`);
  for (const query of [queryEvidence, browserQuery]) {
    for (const reverse of [false, true]) {
      const input = {
        ...data,
        frames: data.frames.map((frame) => ({
          ...frame,
          objects: reverse ? [...frame.objects].reverse() : frame.objects,
        })),
      };
      const evidence = query(input, { at: 0, point: [170, 65], from: 0, to: 1 });
      assert.equal(evidence.requested.object, 'cube');
      const owner = evidence.objects[0];
      assert.equal(owner.text, 'The cube');
      assert.equal(owner.sourceFile, '/actual/runtime.js');
      assert.deepEqual(owner.data, { volume: 8 });
      assert.deepEqual(owner.camera, { time: 0 });
      assert.equal(evidence.ancestors[0].id, 'operation');
      assert.equal(evidence.trajectory.length, 2, 'one observation per checkpoint, not per part');
      assert.deepEqual(
        evidence.trajectory[1].representations.find((r) => r.width === 40),
        { x: 22, y: 20, width: 40, height: 40 },
      );
      assert.equal(
        query(input, { at: 0, point: [120, 40] }).requested.object,
        'operation',
        'the gap inside the union must not hit the cube',
      );
    }
  }
});
