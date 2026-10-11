import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { captureWriter } from '../tools/motion/session.mjs';
import { deriveTemporalChanges } from '../tools/motion/timeline.mjs';
import { inspectSession } from '../tools/motion/inspect.mjs';
import { compactInspection } from '../tools/motion/inspection-receipt.mjs';

const execute = promisify(execFile);
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "review agent's "));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const writer = await captureWriter(directory);
  const times = [10, 10.04, 11.02];
  for (const [i, time] of times.entries()) {
    const png = await sharp({
      create: { width: 40, height: 30, channels: 4, background: ['#111', '#bbb', '#ccc'][i] },
    })
      .png()
      .toBuffer();
    await writer.append({ id: ['shot-A', 'shot-Q', 'shot-Z'][i], time, png });
  }
  await writer.finish({ kind: 'frame-manifest', theme: 'dark' });
  await writeFile(
    join(directory, 'motion.json'),
    JSON.stringify({
      timeline: {
        changes: deriveTemporalChanges(
          times.slice(1).map((time, i) => ({
            from: i,
            to: i + 1,
            time,
            dtMs: (time - times[i]) * 1000,
            meanDelta: i ? 1 : 100,
            changedPercent: i ? 2 : 90,
          })),
        ),
      },
    }),
  );
  return directory;
}

test('change/frame indexes use saved metadata, keep IDs through filtering and never render a list', async (t) => {
  const directory = await fixture(t);
  const list = await inspectSession(directory, { list: 'changes', limit: 1 });
  assert.equal(list.items[0].id, 'change:1');
  assert.equal(list.items[0].to.id, 'shot-Q');
  assert.equal(list.nextOffset, 1);
  const filtered = await inspectSession(directory, { list: 'changes', from: 10.5 });
  assert.equal(filtered.items[0].id, 'change:2');
  const frames = await inspectSession(directory, { list: 'frames', from: 10.01, to: 10.1 });
  assert.equal(frames.items[0].id, 'shot-Q');
  assert.equal(frames.items[0].index, 1);
  assert(
    !(await readdir(directory)).includes('analysis'),
    'listing must not decode or write any image',
  );
  const result = JSON.parse((await execute('/bin/sh', ['-c', list.items[0].inspect])).stdout);
  assert.equal(
    result.selection.current.id,
    'shot-Q',
    'copyable command handles apostrophes in paths',
  );
  await rm(join(directory, 'motion.json'));
  assert.match((await inspectSession(directory)).changesUnavailable, /No saved/);
  await assert.rejects(inspectSession(directory, { change: 'largest' }), /No saved/);
  assert.equal(
    (await inspectSession(directory, { frame: 'last', render: false })).selection.current.id,
    'shot-Z',
  );
});

test('stateless CLI navigation handles irregular timestamps, signed steps, views and crop preservation', async (t) => {
  const directory = await fixture(t);
  const cli = async (...args) =>
    JSON.parse(
      (
        await execute(process.execPath, [
          'tools/scene.mjs',
          'review',
          'inspect',
          directory,
          ...args,
        ])
      ).stdout,
    );
  const selected = await cli(
    '--change',
    'largest',
    '--view',
    'changes',
    '--crop',
    '2,3,12,8',
    '--max-size',
    '0',
  );
  assert.equal(selected.selection.current.id, 'shot-Q');
  assert.equal(selected.image, selected.changesImage);
  assert.equal((await sharp(selected.image).metadata()).width, 12);
  const next = JSON.parse((await execute('/bin/sh', ['-c', selected.navigation.next])).stdout);
  assert.equal(next.selection.current.id, 'shot-Z');
  assert.equal(next.view, 'changes');
  assert.equal(next.navigation.next, null);
  assert.deepEqual(next.crop, selected.crop);
  const back = await cli('--frame', 'shot-Z', '--step', '-1', '--view', 'frame');
  assert.equal(back.selection.current.time, 10.04, 'step means an observed frame, never 1/fps');
  assert.equal(back.image, back.frameImage);
  const onion = await cli('--frame', 'first', '--view', 'onion', '--radius', '2');
  assert.equal(onion.image, onion.onionImage);
  assert.equal(onion.onion.time, 10);
  const pair = await cli('--frame', '1');
  assert.equal(pair.image, pair.comparisonImage);
  assert.equal(pair.selection.previous.id, 'shot-A');
  assert.equal(pair.selection.next.id, 'shot-Z');
});

test('invalid or conflicting navigation fails explicitly instead of silently selecting another frame', async (t) => {
  const directory = await fixture(t);
  for (const [query, message] of [
    [{ frame: 'last', step: 1 }, /available indices/],
    [{ frame: 'first', step: -1 }, /available indices/],
    [{ step: 1 }, /anchor/],
    [{ frame: 'missing' }, /Unknown frame/],
    [{ frame: 0, step: 0.5 }, /integer/],
    [{ frame: 0, at: 10 }, /Choose one/],
    [{ list: 'changes', frame: 0 }, /cannot be combined/],
    [{ view: 'unknown' }, /--view/],
    [{ list: 'frames', limit: 0 }, /limit/],
  ])
    await assert.rejects(inspectSession(directory, query), message);
});

test('object search and auto crop retain moving, disappearing and clipped details in source pixels', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'review-focus-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const writer = await captureWriter(directory);
  const png = await sharp({ create: { width: 200, height: 100, channels: 4, background: '#fff' } })
    .png()
    .toBuffer();
  for (let i = 0; i < 3; i++)
    await writer.append({
      time: i,
      png,
      state: { phase: i, trace: Array.from({ length: 1000 }, (_, n) => n) },
      objects: [
        ...Array.from({ length: 50 }, (_, n) => ({
          id: `label:${n}`,
          text: `Detail ${n}`,
          x: n,
          y: 1,
          width: 1,
          height: 1,
        })),
        ...(i === 2
          ? []
          : [
              {
                id: 'moving',
                text: 'Moving value',
                coordinates: 'css-viewport',
                viewport: { width: 100, height: 50 },
                x: 10.25 + i * 30,
                y: 10.25,
                width: 20.5,
                height: 15.25,
                visible: true,
              },
            ]),
        { id: 'edge', x: 196, y: 20, width: 40, height: 20, visible: true },
      ],
    });
  await writer.finish({ kind: 'frame-manifest' });
  const page = await inspectSession(directory, {
    list: 'objects',
    frame: 1,
    search: 'Moving',
    limit: 1,
  });
  assert.equal(
    page.items[0].id,
    'moving',
    'object discovery must not truncate after the first 40 objects',
  );
  const result = JSON.parse((await execute('/bin/sh', ['-c', page.items[0].inspect])).stdout);
  assert.deepEqual(result.crop, { x: 8, y: 8, width: 126, height: 55 });
  assert.equal(result.focus.clipped, false);
  assert.equal(result.frames[1].state.phase, 1);
  assert.deepEqual(result.frames[1].stateOmitted, ['trace']);
  const next = JSON.parse((await execute('/bin/sh', ['-c', result.navigation.next])).stdout);
  assert.equal(next.selection.current.index, 2);
  assert.match(next.navigation.previous, /--crop 'auto'/);
  assert.equal(
    next.objects.length,
    0,
    'an object removed from the current state can still be compared with its previous location',
  );
  assert.deepEqual(next.crop, { x: 68, y: 8, width: 66, height: 55 });
  const clipped = await inspectSession(directory, {
    frame: 1,
    object: 'edge',
    crop: 'auto',
    view: 'frame',
  });
  assert.equal(clipped.focus.clipped, true);
  assert.equal(clipped.crop.x + clipped.crop.width, 200);
  const full = await inspectSession(directory, {
    frame: 1,
    object: 'moving',
    radius: 2,
    render: false,
  });
  assert.equal(full.frames[0].state.trace.length, 1000, 'full evidence is preserved');
  const reportDirectory = join(directory, 'detail');
  await execute(process.execPath, [
    'tools/scene.mjs',
    'review',
    'inspect',
    directory,
    '--frame',
    '1',
    '--object',
    'moving',
    '--crop',
    'auto',
    '--out',
    reportDirectory,
  ]);
  const report = JSON.parse(await readFile(join(reportDirectory, 'motion.json'), 'utf8'));
  assert.deepEqual(
    report.onion.crop,
    { x: 8, y: 8, width: 126, height: 55 },
    'full reports fit all actual bracketing states, including those outside the requested radius',
  );
  assert.equal(report.timeline.frames, 3);
  assert.equal(
    Object.keys(compactInspection(clipped))[0],
    'image',
    'opening the image needs no search through metadata',
  );
});

test('failed rendering returns evidence with a failure exit code; an absent object never silently renders the whole scene', async (t) => {
  const directory = await fixture(t);
  await assert.rejects(
    inspectSession(directory, { frame: 1, object: 'missing', crop: 'auto' }),
    /not observed/,
  );
  await assert.rejects(inspectSession(directory, { frame: 1, crop: 'auto' }), /needs --object/);
  await assert.rejects(
    execute(process.execPath, [
      'tools/scene.mjs',
      'review',
      'inspect',
      directory,
      '--frame',
      '1',
      '--crop',
      '100,100,10,10',
    ]),
    (error) => {
      assert.equal(error.code, 2);
      const evidence = JSON.parse(error.stdout);
      assert.match(evidence.imageUnavailable, /Crop must fit/);
      assert.equal(evidence.selection.current.index, 1);
      assert(evidence.selection.current.file);
      return true;
    },
  );
});
