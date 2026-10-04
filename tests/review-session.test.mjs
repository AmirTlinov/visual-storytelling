import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { captureWriter, loadCapture } from '../tools/motion/session.mjs';
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
