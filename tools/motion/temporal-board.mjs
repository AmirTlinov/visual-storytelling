import sharp from 'sharp';
import { decodeMotionRasters } from './rasters.mjs';
import { deriveTemporalChanges } from './timeline.mjs';
import { composeChange, temporalChangeStrength } from './onion.mjs';
import { temporalChart } from './temporal-chart.mjs';

export function reportTemporalChanges(report) {
  return (
    report.timeline?.changes ??
    deriveTemporalChanges(
      report.intervals.map((interval) => ({
        ...interval,
        time: report.frames[interval.to].time,
        meanDelta: interval.meanAbsoluteDelta,
      })),
    )
  );
}

/** Standalone board: only the selected observed transition is decoded, never recaptured. */
export async function renderTemporalBoard(report, changes = reportTemporalChanges(report)) {
  const frames = report.samples?.length
    ? report.samples
    : report.frames.map((frame) => ({
        time: frame.time,
        png: Buffer.from(frame.image.split(',')[1], 'base64'),
      }));
  const index = frames.reduce(
    (best, frame, i) =>
      Math.abs(frame.time - report.onion.time) < Math.abs(frames[best].time - report.onion.time)
        ? i
        : best,
    0,
  );
  const time = frames[index].time;
  const change = changes.find((interval) => (interval.endTime ?? interval.time) === time);
  const selected = frames.slice(Math.max(0, index - 1), index + 1);
  const geometry = await decodeMotionRasters(
    selected,
    report.samples?.length
      ? {
          crop: report.onion.crop ?? undefined,
          maxSize: Math.max(report.onion.width, report.onion.height),
        }
      : { maxSize: 0 },
  );
  const current = geometry.rasters.at(-1);
  const data =
    index > 0
      ? composeChange(
          geometry.rasters[0],
          current,
          geometry.width,
          geometry.height,
          temporalChangeStrength(change),
        )
      : current;
  const encode = (pixels) =>
    sharp(Buffer.from(pixels), {
      raw: { width: geometry.width, height: geometry.height, channels: 4 },
    })
      .png()
      .toBuffer();
  const [frameImage, changeImage] = await Promise.all([encode(current), encode(data)]);
  const width = Math.max(320, geometry.width);
  const chart = temporalChart(changes, {
    width,
    at: time,
    frames,
    from: report.timeline?.from ?? frames[0].time,
    to: report.timeline?.to ?? frames.at(-1).time,
  });
  const frame = {
    x: Math.floor((width - geometry.width) / 2),
    y: 0,
    width: geometry.width,
    height: geometry.height,
  };
  const height = geometry.height + chart.height;
  const board = (pixels) =>
    sharp({
      create: {
        width,
        height,
        channels: 4,
        background: report.source?.theme === 'dark' ? '#20262b' : '#fff',
      },
    })
      .composite([
        { input: pixels, left: frame.x, top: 0 },
        { input: Buffer.from(chart.svg), left: 0, top: geometry.height },
      ])
      .png()
      .toBuffer();
  return {
    image: await board(frameImage),
    changeImage: await board(changeImage),
    view: {
      mode: 'frame',
      width,
      height,
      frame,
      plot: { ...chart.plot, y: chart.plot.y + geometry.height },
      range: chart.range,
      time,
      index,
      fromTime: index > 0 ? frames[index - 1].time : time,
      toTime: time,
      changedPercent: change?.changedPercent ?? 0,
      candidate: change?.candidate ?? false,
    },
  };
}
