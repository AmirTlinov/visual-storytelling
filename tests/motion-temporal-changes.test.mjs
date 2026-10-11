import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { deriveTemporalChanges, scanTimeline } from '../tools/motion/timeline.mjs';
import { temporalChart, timeAtChartPoint } from '../tools/motion/temporal-chart.mjs';

function intervals(deltas, durations = deltas.map(() => 0.1)) {
  let time = 0;
  return deltas.map((meanDelta, index) => {
    const duration = durations[index];
    time += duration;
    return {
      from: index,
      to: index + 1,
      time,
      dtMs: duration * 1000,
      meanDelta,
      changedPercent: meanDelta ? 10 : 0,
      duplicate: meanDelta === 0,
    };
  });
}

const marked = (changes) => changes.flatMap((change, i) => (change.candidate ? [i] : []));

test('sustained smooth visual change produces no abrupt-change candidates', () => {
  assert.deepEqual(marked(deriveTemporalChanges(intervals([2, 2.1, 2, 1.9, 2, 2.1, 2]))), []);
});

test('hold then jump and a single flash expose their observed transition intervals', () => {
  assert.deepEqual(marked(deriveTemporalChanges(intervals([0, 0, 0, 12, 0, 0, 0]))), [3]);
  const flash = deriveTemporalChanges(intervals([0, 0, 0, 12, 12, 0, 0, 0]));
  assert.deepEqual(marked(flash), [3, 4]);
  assert.equal(flash[3].reason, 'change-rate-spike');
  assert.equal(flash[3].from, 3);
  assert.equal(flash[3].to, 4);
  assert(Math.abs(flash[3].startTime - 0.3) < 1e-12);
  assert(Math.abs(flash[3].endTime - 0.4) < 1e-12);
});

test('irregular sampling does not turn constant change per second into a jump', () => {
  const durations = [0.1, 0.1, 0.5, 0.05, 0.2, 0.1, 0.1];
  const changes = deriveTemporalChanges(
    intervals(
      durations.map((dt) => dt * 10),
      durations,
    ),
  );
  assert.deepEqual(marked(changes), []);
  for (const change of changes) assert(Math.abs(change.changeRate - 10) < 1e-12);
});

test('tiny noise and too small a changed area stay below the inspection floor', () => {
  assert.deepEqual(marked(deriveTemporalChanges(intervals([0, 0, 0, 0.1, 0, 0, 0]))), []);
  const smallArea = intervals([0, 0, 0, 12, 0, 0, 0]);
  smallArea[3].changedPercent = 0.01;
  assert.deepEqual(marked(deriveTemporalChanges(smallArea)), []);
  assert.deepEqual(marked(deriveTemporalChanges(intervals([0, 0, 0, 0.4, 0, 0, 0]))), [3]);
});

test('chart point mapping uses inclusive plot bounds and source seconds', () => {
  const view = temporalChart([], { from: 3, to: 7 });
  const { x, y, width, height } = view.plot;
  assert.equal(timeAtChartPoint(view, [x, y]), 3);
  assert.equal(timeAtChartPoint(view, [x + width, y + height]), 7);
  assert.equal(timeAtChartPoint(view, [x + width / 2, y + height / 2]), 5);
  for (const point of [
    [x - 1, y],
    [x, y - 1],
    [x + width + 1, y],
    [x, y + height + 1],
  ])
    assert.throws(() => timeAtChartPoint(view, point), /outside/);
});

test('chart handles irregular timestamps and empty or single-time ranges without nonfinite SVG', () => {
  const changes = deriveTemporalChanges(intervals([0, 0.4, 0], [0.03, 0.4, 0.1]));
  const view = temporalChart(changes, {
    at: 0.43,
    frames: [{ time: 0 }, { time: 0.03 }, { time: 0.43 }, { time: 0.53 }],
  });
  assert.equal(view.range.from, 0);
  assert.equal(view.range.to, 0.53);
  assert(view.svg.includes('#21875a'));
  for (const chart of [view, temporalChart([]), temporalChart([], { from: 1, to: 1 })]) {
    assert(!/NaN|Infinity|undefined/.test(chart.svg));
    assert(Number.isFinite(timeAtChartPoint(chart, [chart.plot.x, chart.plot.y])));
  }
});

test('empty and short inputs remain finite, deterministic and unmodified', () => {
  assert.deepEqual(deriveTemporalChanges([]), []);
  const source = intervals([8]);
  const before = structuredClone(source);
  const single = deriveTemporalChanges(source);
  assert.deepEqual(marked(single), []);
  assert.deepEqual(source, before);
  const invalidDuration = [{ ...source[0], dtMs: 0 }];
  for (const change of [...single, ...deriveTemporalChanges(invalidDuration)]) {
    for (const key of ['startTime', 'endTime', 'changeRate', 'localChangeRate', 'magnitude'])
      assert(Number.isFinite(change[key]), key);
  }
});

test('the existing timeline scan publishes candidates derived from its own intervals', async () => {
  const black = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#000' } })
    .png()
    .toBuffer();
  const white = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#fff' } })
    .png()
    .toBuffer();
  const frames = [black, black, black, black, white, white, white, white];
  const timeline = await scanTimeline(frames.map((png, i) => ({ png, time: i / 10 })));
  assert.deepEqual(timeline.changes, deriveTemporalChanges(timeline.intervals));
  assert.deepEqual(marked(timeline.changes), [3]);
});
