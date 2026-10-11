import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { analyzeMotionFrames } from '../tools/motion/frames.mjs';
import { renderTemporalBoard, reportTemporalChanges } from '../tools/motion/temporal-board.mjs';
import { timeAtChartPoint, transitionTime } from '../tools/motion/temporal-chart.mjs';
import { renderFrameComparison } from '../tools/motion/frame-comparison.mjs';

const execute = promisify(execFile);

test('clean comparisons preserve white artwork on transparent dark frames at a shared scale', async () => {
  const frames = await Promise.all(
    [24, 30].map(async (width, i) => {
      const raw = Buffer.alloc(width * 20 * 4);
      raw.set([255, 255, 255, 255], (3 * width + 2) * 4);
      return {
        time: i,
        png: await sharp(raw, { raw: { width, height: 20, channels: 4 } })
          .png()
          .toBuffer(),
      };
    }),
  );
  const image = await renderFrameComparison(frames, { at: 1, theme: 'dark' });
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  const pixel = (x, y) => [
    ...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 3),
  ];
  assert.deepEqual(pixel(105, 38), [32, 38, 43]);
  assert.deepEqual(pixel(107, 41), [255, 255, 255]);
  assert.deepEqual(pixel(359, 41), [255, 255, 255]);
});

test('standalone timeline keeps clean detail, separates changes and roundtrips coordinates to an exact clean pair', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'temporal-board-'));
  try {
    const source = [];
    for (const x of [2, 3, 3]) {
      const raw = Buffer.alloc(32 * 16 * 4, 255);
      raw.set([0, 0, 0, 255], x * 4);
      source.push(
        await sharp(raw, { raw: { width: 32, height: 16, channels: 4 } })
          .png()
          .toBuffer(),
      );
    }
    const report = await analyzeMotionFrames(
      source.map((png, i) => ({ png, time: i / 10 })),
      { at: 0.1 },
    );
    const board = await renderTemporalBoard(report);
    const { data, info } = await sharp(board.image)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(info.width, board.view.width);
    assert.equal(info.height, board.view.height);
    assert.equal(board.view.time, 0.1);
    assert.equal(board.view.fromTime, 0);
    const cropped = await analyzeMotionFrames(
      source.map((png, i) => ({ png, time: i / 10 })),
      {
        at: 0.1,
        crop: { x: 1, y: 0, width: 20, height: 16 },
        maxSize: 10,
      },
    );
    const croppedBoard = await renderTemporalBoard({
      ...cropped,
      samples: source.map((png, i) => ({ png, time: i / 10 })),
    });
    assert.equal(croppedBoard.view.frame.width, cropped.onion.width);
    assert.equal(croppedBoard.view.frame.height, cropped.onion.height);
    assert(board.view.plot.y > board.view.frame.height);
    const untouched = (board.view.frame.x + 10) * 4;
    assert.deepEqual([...data.subarray(untouched, untouched + 4)], [255, 255, 255, 255]);
    assert.equal(data[(board.view.frame.x + 3) * 4 + 1], 0, 'the selected black pixel stays black');
    const marked = await sharp(board.changeImage).ensureAlpha().raw().toBuffer();
    assert(
      marked[(board.view.frame.x + 3) * 4 + 1] > 0,
      'the separate view marks the changed pixel green',
    );
    const point = [board.view.plot.x + board.view.plot.width / 2, board.view.plot.y + 3];
    assert.equal(timeAtChartPoint(board.view, point), 0.1);
    await writeFile(join(directory, 'timeline.png'), board.image);
    await writeFile(join(directory, 'motion.json'), JSON.stringify({ timelineView: board.view }));
    await writeFile(
      join(directory, 'session.json'),
      JSON.stringify({ kind: 'visual-review-session', capture: 'frames.json', episodes: [] }),
    );
    for (const [i, png] of source.entries()) await writeFile(join(directory, `${i}.png`), png);
    await writeFile(
      join(directory, 'frames.json'),
      JSON.stringify({
        source: { kind: 'frame-manifest' },
        frames: source.map((_, i) => ({
          time: i / 10,
          file: `${i}.png`,
          state: {
            perspective: i ? 'algebra' : 'diagram',
            trace: Array.from({ length: 1000 }, (_, j) => j),
          },
        })),
      }),
    );
    const args = [
      'tools/scene.mjs',
      'review',
      'inspect',
      directory,
      '--timeline-point',
      point.join(','),
      '--point',
      '3,0',
    ];
    const result = JSON.parse((await execute(process.execPath, args)).stdout);
    assert.equal(result.requested.at, 0.1);
    assert.deepEqual(result.requested.point, [3, 0]);
    assert.equal(result.selection.current.time, 0.1);
    assert.equal(result.selection.previous.time, 0);
    assert.equal(result.selection.next.time, 0.2);
    assert.equal((await sharp(result.comparisonImage).metadata()).width, 492);
    assert.equal(result.frames[0].state.perspective, 'diagram');
    assert.equal(result.frames[0].state.trace, undefined);
    assert.deepEqual(result.frames[0].stateOmitted, ['trace']);
    const full = JSON.parse((await execute(process.execPath, [...args, '--verbose'])).stdout);
    assert.equal(full.frames[0].state.trace.length, 1000, 'verbose preserves complete saved state');
    const changes = reportTemporalChanges(report);
    assert.equal(changes[0].candidate, true);
    const halfBandPoint = [board.view.plot.x + board.view.plot.width / 8, point[1]];
    assert.equal(timeAtChartPoint(board.view, halfBandPoint), 0.025);
    assert.equal(transitionTime(changes, 0), 0);
    assert.equal(transitionTime(changes, 0.1), 0.1);
    await writeFile(
      join(directory, 'motion.json'),
      JSON.stringify({
        timelineView: board.view,
        intervals: report.intervals,
        frames: report.frames,
      }),
    );
    const bandArgs = args.map((arg) => (arg === point.join(',') ? halfBandPoint.join(',') : arg));
    const bandResult = JSON.parse((await execute(process.execPath, bandArgs)).stdout);
    assert.equal(bandResult.requested.at, 0.1, 'left half of a jump band selects its after-frame');
    const nearPeakArgs = args.map((arg) =>
      arg === point.join(',') ? [point[0] + 1, point[1]].join(',') : arg,
    );
    const nearPeak = JSON.parse((await execute(process.execPath, nearPeakArgs)).stdout);
    assert.equal(
      nearPeak.selection.current.time,
      0.1,
      'a rounded pixel beside a peak selects that peak, not the following frame',
    );
    await assert.rejects(execute(process.execPath, [...args, '--at', '0.1']), /cannot be combined/);
    await assert.rejects(
      execute(
        process.execPath,
        args.map((arg) => (arg === point.join(',') ? '0,0' : arg)),
      ),
      /outside/,
    );
    await rm(join(directory, 'timeline.png'));
    await assert.rejects(execute(process.execPath, args), /needs a saved report/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
