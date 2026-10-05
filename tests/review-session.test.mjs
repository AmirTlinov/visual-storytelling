import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, appendFile, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { captureWriter, loadCapture, saveSession } from '../tools/motion/session.mjs';
import { saveCapture } from '../tools/motion/media.mjs';
import { queryEvidence } from '../tools/motion/inspection.mjs';
import { buildEpisodes } from '../tools/motion/episodes.mjs';
import { inspectSession } from '../tools/motion/inspect.mjs';
import { startRecording, recordingStatus } from '../tools/motion/record.mjs';

test('point inspection keeps geometry, operation ancestry and pixel coordinates together', () => {
  const parent = {
    id: 'operation',
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    visible: true,
    data: { operation: { kind: 'add', values: [2, 4] }, frame: { phase: 'approach' } },
  };
  const mesh = {
    id: 'cube',
    parent: 'unobserved-group',
    ancestors: ['unobserved-group', 'operation'],
    coordinates: 'css-viewport',
    viewport: { width: 100, height: 50 },
    x: 10,
    y: 10,
    width: 20,
    height: 20,
    visible: true,
  };
  const data = {
    frames: [
      {
        time: 0,
        width: 200,
        height: 100,
        file: '0.png',
        objects: [{ id: 'hidden', x: 0, y: 0, width: 0, height: 0 }, parent, mesh],
      },
      { time: 1, width: 200, height: 100, file: '1.png', objects: [parent, { ...mesh, x: 30 }] },
    ],
  };
  const q = queryEvidence(data, { at: 0, point: [30, 30], from: 0, to: 1 });
  assert.equal(q.requested.object, 'cube');
  assert.equal(q.objects[0].x, 20);
  assert.deepEqual(q.ancestors[0].data.operation.values, [2, 4]);
  assert.deepEqual(q.bounds, { x: 20, y: 20, width: 80, height: 40 });
  assert.equal(q.trajectory[1].x, 60);
  assert(!queryEvidence(data, { at: 0 }).objects.some((o) => o.id === 'hidden'));
});

test('episodes retain observed input timing and separate repeated visits after a media seek', () => {
  const samples = Array.from({ length: 41 }, (_, i) => ({ id: `f${i}`, time: i / 10 }));
  const episodes = buildEpisodes(samples, {
    telemetry: {
      steps: [
        { index: 0, phase: 'start', type: 'click', time: 0.1, selector: '#open' },
        { index: 0, phase: 'end', type: 'click', time: 0.6 },
      ],
      events: [{ type: 'click', trusted: true, time: 0.5, target: '#open' }],
    },
  });
  const action = episodes.find((e) => e.kind === 'click');
  assert.equal(action.start, 0.5);
  assert.equal(action.scheduledStart, 0.1);
  assert.equal(action.anchor, 'observed-input');
  const story = buildEpisodes(samples, {
    context: {
      clock: 'media',
      review: {
        segments: [{ id: 'one', start: 0, end: 10 }],
        cues: [{ id: 'move', kind: 'action', start: 1, end: 3, action: 'Move' }],
      },
    },
    telemetry: {
      scene: [
        { time: 0, mediaTime: 0 },
        { time: 1, mediaTime: 1 },
        { time: 2, mediaTime: 2 },
        { time: 3, mediaTime: 1 },
        { time: 4, mediaTime: 2 },
      ],
    },
  });
  const visits = story.filter((e) => e.cue === 'move');
  assert.equal(visits.length, 2);
  assert.notEqual(visits[0].id, visits[1].id);
  assert.deepEqual(visits[0].media, { start: 1, end: 3 });
});

test('interrupted capture recovers completed frames; inspection never recaptures', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'review-recovery-'));
  try {
    const writer = await captureWriter(directory);
    const png = await sharp({
      create: { width: 20, height: 10, channels: 4, background: '#987654' },
    })
      .png()
      .toBuffer();
    await writer.append({ epoch: 1000, png });
    await writer.append({ epoch: 1250, png });
    const recovered = await loadCapture(directory);
    assert.equal(recovered.source.truncated, true);
    assert.deepEqual(
      recovered.samples.map((f) => f.time),
      [0, 0.25],
    );
    const evidence = await inspectSession(directory, { at: 0.1 });
    assert.equal(evidence.frames.length, 2);
    assert.equal(evidence.frames[0].file, recovered.samples[0].file);
    await assert.rejects(inspectSession(directory, { offset: -1 }), /offset/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('replacing a review recovers only the new run, with its source, cues and untouched old pixels', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'review-generations-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const oldPNG = await sharp({
    create: { width: 20, height: 10, channels: 4, background: '#a00000' },
  })
    .png()
    .toBuffer();
  const newPNG = await sharp({
    create: { width: 20, height: 10, channels: 4, background: '#00b000' },
  })
    .png()
    .toBuffer();
  const old = await captureWriter(directory);
  await old.append({ time: 0, png: oldPNG });
  await old.append({ time: 1, png: oldPNG });
  const oldSource = { kind: 'scene-seek', path: 'old-scene', clock: 'model time' };
  const captureManifest = await old.finish(oldSource);
  await saveSession(directory, {
    captureManifest,
    source: oldSource,
    samples: old.frames,
    episodes: [],
  });
  for (const file of ['index.html', 'motion.json', 'motion.png', 'frames.png', 'photometry.png'])
    await writeFile(join(directory, file), 'old report');
  await writeFile(join(directory, 'notes.txt'), 'keep my notes');
  await writeFile(join(directory, 'capture', 'diagram.png'), oldPNG);

  const source = { kind: 'scene-seek', path: 'new-scene', clock: 'model time' };
  const context = {
    review: {
      segments: [{ id: 'new-chapter', start: 10, end: 12 }],
      cues: [{ id: 'new-action', kind: 'action', start: 10, end: 11, action: 'Move' }],
    },
  };
  const writer = await captureWriter(directory);
  assert.equal(
    (await loadCapture(directory)).source.path,
    'old-scene',
    'creation alone does not erase a review',
  );
  await writer.begin({ source, context });
  await assert.rejects(loadCapture(directory), /no saved frames/);
  for (const file of [
    'session.json',
    'capture/frames.json',
    'index.html',
    'motion.json',
    'motion.png',
    'frames.png',
    'photometry.png',
  ])
    await assert.rejects(readFile(join(directory, file)), { code: 'ENOENT' });
  await writer.append({ time: 10, png: newPNG });
  await writer.append({ time: 11, png: newPNG });
  await appendFile(join(directory, 'capture', 'frames.jsonl'), '{"time":12,"file":');
  const recovered = await loadCapture(directory);
  assert.equal(recovered.source.path, 'new-scene');
  assert.equal(recovered.source.truncated, true);
  assert.deepEqual(recovered.context, context);
  assert.deepEqual(
    recovered.samples.map((frame) => frame.time),
    [10, 11],
  );
  for (const frame of recovered.samples) {
    assert(!old.frames.some((previous) => previous.file === frame.file));
    assert.deepEqual(await readFile(frame.file), newPNG);
  }
  for (const frame of old.frames) assert.deepEqual(await readFile(frame.file), oldPNG);
  assert(
    (await inspectSession(directory)).episodes.some((episode) => episode.cue === 'new-action'),
  );

  // A failed final serialization must leave the completed journal recoverable.
  writer.frames[1].invalid = 1n;
  await assert.rejects(writer.finish(source, undefined, context), /BigInt/);
  await assert.rejects(readFile(captureManifest), { code: 'ENOENT' });
  assert.equal((await loadCapture(directory)).samples.length, 2);
  assert(!(await readdir(join(directory, 'capture'))).some((file) => file.endsWith('.tmp')));
  delete writer.frames[1].invalid;
  await writer.finish(source, undefined, context);
  const completed = await loadCapture(directory);
  assert.deepEqual(completed.source, source);
  assert.deepEqual(completed.context, context);
  assert.deepEqual(
    completed.samples.map((frame) => frame.file),
    recovered.samples.map((frame) => frame.file),
  );
  for (const frame of old.frames) await assert.rejects(readFile(frame.file), { code: 'ENOENT' });
  assert.equal(await readFile(join(directory, 'notes.txt'), 'utf8'), 'keep my notes');
  assert.deepEqual(await readFile(join(directory, 'capture', 'diagram.png')), oldPNG);
  await assert.rejects(writer.append({ time: 12, png: newPNG }), /finished/);
});

test('saved capture reuse keeps raw references and shares the writer metadata contract', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'review-reference-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const png = await sharp({ create: { width: 8, height: 4, channels: 4, background: '#123456' } })
    .png()
    .toBuffer();
  const writer = await captureWriter(join(directory, 'source'));
  await writer.append({ epoch: 1000, png });
  await writer.append({ epoch: 1250, png });
  writer.frames.forEach((frame) => {
    frame.time = (frame.epoch - 1000) / 1000;
  });
  const source = { kind: 'browser-capture', path: 'source', clock: 'capture time' };
  const context = { title: 'Selected interval' };
  const telemetry = { events: [{ type: 'click', time: 0.1 }] };
  const sourceManifest = await writer.finish(source, telemetry, context);
  const output = join(directory, 'selection');
  const selectedManifest = await saveCapture(writer.frames, source, output, telemetry, context);
  const selected = await loadCapture(selectedManifest);
  assert.deepEqual(
    selected.samples.map((frame) => frame.file),
    writer.frames.map((frame) => frame.file),
  );
  assert.deepEqual(
    selected.samples.map((frame) => frame.time),
    [0, 0.25],
  );
  assert(selected.samples.every((frame) => !('epoch' in frame)));
  assert.deepEqual(selected.source, source);
  assert.deepEqual(selected.context, context);
  assert.deepEqual(selected.telemetry, telemetry);
  assert.deepEqual(
    await readdir(join(output, 'capture')),
    ['frames.json'],
    'offline analysis does not copy raw images',
  );
  await writeFile(join(output, 'replay.json'), '{}');
  const session = await saveSession(output, {
    captureManifest: join(output, 'capture', 'frames.json'),
    replayPath: join(output, 'replay.json'),
    source,
    samples: selected.samples,
    context,
    telemetry,
    episodes: [],
  });
  assert.equal(session.capture, 'capture/frames.json');
  assert.equal(session.replay, 'replay.json');
  assert.deepEqual((await loadCapture(output)).samples, selected.samples);
  assert.equal((await loadCapture(sourceManifest)).samples.length, 2);
});

test('legacy manifests and headerless interrupted journals remain readable, including epoch zero', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'review-legacy-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'capture'));
  const journal = join(directory, 'capture', 'frames.jsonl');
  await writeFile(
    journal,
    '{"epoch":0,"file":"000000000.png"}\n{"epoch":250,"file":"000000001.png"}\n{"epoch":',
  );
  const partial = await loadCapture(directory);
  assert.equal(partial.source.clock, 'capture epoch');
  assert.deepEqual(
    partial.samples.map((frame) => frame.time),
    [0, 0.25],
  );
  const source = { kind: 'frame-manifest', path: 'old-input' };
  await writeFile(
    join(directory, 'capture', 'frames.json'),
    JSON.stringify({
      source,
      frames: [
        { time: 2, file: '000000000.png' },
        { time: 3, file: '000000001.png' },
      ],
    }),
  );
  await writeFile(
    join(directory, 'session.json'),
    JSON.stringify({
      kind: 'visual-review-session',
      version: 1,
      capture: 'capture/frames.json',
      id: 'legacy',
    }),
  );
  const saved = await loadCapture(directory);
  assert.equal(saved.session.id, 'legacy');
  assert.deepEqual(saved.source, source);
  assert.deepEqual(
    saved.samples.map((frame) => frame.time),
    [2, 3],
  );
});

test('manual recorder stops a pending scenario, finalizes evidence and never performs its later click', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'review-recorder-'));
  try {
    const start = await startRecording(resolve('tests/fixtures/motion-browser.html'), directory, {
      headed: false,
      actions: [
        { type: 'wait', ms: 10000 },
        { type: 'click', selector: '#toggle' },
      ],
    });
    assert.equal(start.status, 'recording');
    await delay(180);
    await recordingStatus(directory, true);
    let result;
    const deadline = performance.now() + 20000;
    while (performance.now() < deadline) {
      result = await recordingStatus(directory);
      if (['complete', 'failed'].includes(result.status)) break;
      await delay(100);
    }
    assert.equal(result.status, 'complete', JSON.stringify(result));
    const capture = await loadCapture(directory);
    assert(capture.samples.length >= 2);
    assert(!capture.telemetry.events.some((e) => e.type === 'click'));
    assert(!capture.source.error);
    assert.equal(
      JSON.parse(await readFile(join(directory, 'session.json'), 'utf8')).coverage.complete,
      true,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('navigation retains the trusted input and labels both observed documents', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'review-navigation-'));
  try {
    const { writeFile } = await import('node:fs/promises');
    const { reviewMotion } = await import('../tools/motion/review.mjs');
    await writeFile(join(directory, 'index.html'), '<a id="next" href="next.html">Continue</a>');
    await writeFile(join(directory, 'next.html'), '<h1 id="result">Ready</h1>');
    const result = await reviewMotion({
      input: join(directory, 'index.html'),
      out: join(directory, 'out'),
      capture: { actions: [{ type: 'click', selector: '#next' }], seconds: 0.2 },
    });
    const capture = await loadCapture(result.session);
    assert(
      capture.telemetry.events.some((e) => e.type === 'click' && e.trusted && e.target === '#next'),
    );
    assert.equal(new Set(capture.telemetry.documents.map((d) => d.url)).size, 2);
    assert(capture.source.gaps.some((g) => g.kind === 'document-navigation'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
