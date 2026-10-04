import sharp from 'sharp';
import { photometryCollector } from './photometry.mjs';

const percentile = (values, p) =>
  values.length ? [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)] : 0;

/** A bounded scan of every captured frame chooses detail windows without dropping evidence. */
export async function scanTimeline(samples, threshold = 8, options = {}) {
  if (samples.length < 2) throw new Error('Timeline scan needs at least two frames');
  for (let i = 0; i < samples.length; i++)
    if (!Number.isFinite(samples[i].time) || (i && samples[i].time <= samples[i - 1].time))
      throw new Error('Frame times must be finite and strictly increasing, in seconds');
  const photometry = photometryCollector(options);
  const intervals = [],
    signals = [];
  let previous,
    previous2,
    previousSize,
    previousDelta = 0;
  for (const [i, sample] of samples.entries()) {
    const original = await sharp(sample.png).metadata();
    let pipeline = sharp(sample.png);
    if (options.crop) {
      const { x: left, y: top, width, height } = options.crop;
      if (
        ![left, top, width, height].every(Number.isInteger) ||
        left < 0 ||
        top < 0 ||
        width < 1 ||
        height < 1 ||
        left + width > original.width ||
        top + height > original.height
      )
        throw new Error('Crop must fit inside every source frame');
      pipeline = pipeline.extract({ left, top, width, height });
    }
    // ICC screenshots need an explicit sRGB decode before entering linear light.
    // Combining the profile conversion with scRGB resizing can quantize them to black.
    if (original.icc) {
      const { data, info } = await pipeline
        .toColourspace('srgb')
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      pipeline = sharp(data, {
        raw: { width: info.width, height: info.height, channels: info.channels },
      });
    }
    // Resize in linear light, then share the bounded sRGB raster with both analyzers.
    const { data: pixels, info } = await pipeline
      .pipelineColourspace('scrgb')
      .toColourspace('srgb')
      .resize(240, 160, { fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    photometry.add(pixels, info.width, info.height, sample.time, original);
    const data = Buffer.alloc(240 * 160 * 4);
    for (let y = 0; y < info.height; y++)
      pixels.copy(data, y * 240 * 4, y * info.width * 4, (y + 1) * info.width * 4);
    for (let p = 0; p < data.length; p += 4)
      for (let c = 0; c < 3; c++) data[p + c] = Math.round((data[p + c] * data[p + 3]) / 255);
    if (previous) {
      let changed = 0,
        absolute = 0,
        back = 0;
      for (let p = 0; p < data.length; p += 4) {
        let peak = 0;
        for (let c = 0; c < 4; c++) {
          const d = Math.abs(data[p + c] - previous[p + c]);
          absolute += d;
          peak = Math.max(peak, d);
          if (previous2) back += Math.abs(data[p + c] - previous2[p + c]);
        }
        if (peak > threshold) changed++;
      }
      const comparedPixels =
        Math.max(info.width, previousSize.width) * Math.max(info.height, previousSize.height);
      const delta = absolute / (comparedPixels * 4);
      intervals.push({
        from: i - 1,
        to: i,
        time: sample.time,
        dtMs: (sample.time - samples[i - 1].time) * 1000,
        changedPercent: (100 * changed) / comparedPixels,
        meanDelta: delta,
        duplicate: absolute === 0,
      });
      if (
        previous2 &&
        previousDelta > 2 &&
        delta > 2 &&
        back / (comparedPixels * 4) < Math.min(previousDelta, delta) * 0.18
      )
        signals.push({
          kind: 'brief-reversal',
          time: samples[i - 1].time,
          frame: i - 1,
          detail:
            'Appearance changes and returns within two captured intervals; inspect for a flash or intended pulse',
        });
      previousDelta = delta;
    }
    previous2 = previous;
    previous = data;
    previousSize = info;
  }
  const dt = intervals.map((v) => v.dtMs),
    typical = percentile(dt, 0.5);
  let longestHold = 0,
    holdStart;
  for (const interval of intervals) {
    if (interval.duplicate) {
      holdStart ??= samples[interval.from].time;
      longestHold = Math.max(longestHold, samples[interval.to].time - holdStart);
    } else holdStart = undefined;
  }
  const peak = intervals.reduce((a, b) => (b.meanDelta > (a?.meanDelta ?? -1) ? b : a), null);
  return {
    frames: samples.length,
    from: samples[0].time,
    to: samples.at(-1).time,
    intervals,
    signals,
    peakFrame: peak?.to ?? 0,
    duplicateIntervals: intervals.filter((v) => v.duplicate).length,
    longestHoldMs: longestHold * 1000,
    captureIntervalMs: { p50: typical, p95: percentile(dt, 0.95), max: Math.max(0, ...dt) },
    photometry: await photometry.finish(),
  };
}

export function selectDetail(samples, { count = 12, from, timeline, telemetry, runtime } = {}) {
  let center = timeline?.signals[0]?.frame ?? timeline?.peakFrame ?? 0;
  const longFrame = telemetry?.longFrames?.reduce(
    (a, b) => (b.duration > (a?.duration ?? -1) ? b : a),
    null,
  );
  if (longFrame)
    center = samples.findIndex(
      (sample) => sample.time >= longFrame.time + longFrame.duration / 2000,
    );
  const blink = runtime?.insights.find((item) => item.kind === 'brief-disappearance');
  if (blink) center = samples.findIndex((sample) => sample.time >= blink.time);
  let start =
    from === undefined
      ? Math.max(0, Math.min(samples.length - count, center - Math.floor(count / 2)))
      : samples.findIndex((sample) => sample.time >= from);
  if (start < 0) start = samples.length;
  return samples.slice(start, start + count);
}

export function overviewSamples(samples, count = 8) {
  return Array.from(
    new Set(
      Array.from({ length: Math.min(samples.length, count) }, (_, i) =>
        Math.round((i * (samples.length - 1)) / (Math.min(samples.length, count) - 1)),
      ),
    ),
  ).map((i) => samples[i]);
}
