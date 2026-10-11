import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { captureWriter } from '../tools/motion/session.mjs';
import { deriveTemporalChanges } from '../tools/motion/timeline.mjs';
import { inspectSession } from '../tools/motion/inspect.mjs';

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
          times
            .slice(1)
            .map((time, i) => ({
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
