import { PNG } from 'pngjs';

export function frameColor(index, count) {
  const t = count > 1 ? index / (count - 1) : 0;
  const stops = [
    [35, 103, 176],
    [38, 145, 117],
    [191, 85, 31],
  ];
  const segment = Math.min(1, Math.floor(t * 2));
  const p = t * 2 - segment;
  return stops[segment].map((v, c) => Math.round(v + p * (stops[segment + 1][c] - v)));
}

export function parseCrop(value) {
  if (value === undefined) return undefined;
  const parts = value.split(',').map(Number);
  if (
    parts.length !== 4 ||
    !parts.every(Number.isInteger) ||
    parts.some((v) => v < 0) ||
    !parts[2] ||
    !parts[3]
  )
    throw new Error('--crop needs x,y,width,height in source pixels');
  const [x, y, width, height] = parts;
  return { x, y, width, height };
}

const imageURL = (image) => `data:image/png;base64,${PNG.sync.write(image).toString('base64')}`;

/** Compare displayed pixels in one fixed coordinate system. Never deduplicate or retime. */
export function analyzeMotionFrames(samples, { crop, threshold = 8 } = {}) {
  if (samples.length < 2 || samples.length > 32) throw new Error('Motion review needs 2–32 frames');
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 255)
    throw new Error('Pixel threshold must be between 0 and 255');
  for (let i = 0; i < samples.length; i++)
    if (!Number.isFinite(samples[i].time) || (i && samples[i].time <= samples[i - 1].time))
      throw new Error('Frame times must be finite and strictly increasing, in seconds');
  const decoded = samples.map(({ png }) => PNG.sync.read(png));
  const sizes = decoded.map(({ width, height }) => ({ width, height }));
  const width = crop?.width ?? Math.max(...sizes.map((s) => s.width));
  const height = crop?.height ?? Math.max(...sizes.map((s) => s.height));
  if (width * height > 16_000_000) throw new Error('Choose a crop smaller than 16 megapixels');
  if (
    crop &&
    (!Object.values(crop).every(Number.isInteger) ||
      crop.x < 0 ||
      crop.y < 0 ||
      width <= 0 ||
      height <= 0 ||
      sizes.some((s) => crop.x + width > s.width || crop.y + height > s.height))
  )
    throw new Error('Crop must fit inside every source frame');
  const pixels = width * height;
  const frames = decoded.map((source) => {
    const target = new PNG({ width, height });
    target.data.fill(255);
    for (let y = 0; y < (crop ? height : source.height); y++)
      for (let x = 0; x < (crop ? width : source.width); x++) {
        const s = ((y + (crop?.y ?? 0)) * source.width + x + (crop?.x ?? 0)) * 4;
        const d = (y * width + x) * 4,
          alpha = source.data[s + 3] / 255;
        for (let c = 0; c < 3; c++)
          target.data[d + c] = Math.round(source.data[s + c] * alpha + 255 * (1 - alpha));
      }
    return target;
  });
  const active = new Uint8Array(pixels),
    peak = new Uint8Array(pixels);
  let left = width,
    right = -1,
    top = height,
    bottom = -1;
  // Temporal range finds gradual changes too; a static background stays quiet.
  for (let p = 0; p < pixels; p++) {
    for (let c = 0; c < 3; c++) {
      let low = 255,
        high = 0;
      for (const frame of frames) {
        const value = frame.data[p * 4 + c];
        low = Math.min(low, value);
        high = Math.max(high, value);
      }
      if (high - low > threshold) active[p] = 1;
    }
    if (active[p]) {
      const x = p % width,
        y = Math.floor(p / width);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  const padding = 24;
  const motionBounds =
    right < 0
      ? null
      : {
          x: Math.max(0, left - padding),
          y: Math.max(0, top - padding),
          width: Math.min(width, right + padding + 1) - Math.max(0, left - padding),
          height: Math.min(height, bottom + padding + 1) - Math.max(0, top - padding),
        };
  const intervals = [];
  for (let i = 1; i < frames.length; i++) {
    let changed = 0,
      absolute = 0;
    for (let p = 0; p < pixels; p++) {
      let difference = 0;
      for (let c = 0; c < 3; c++) {
        const delta = Math.abs(frames[i].data[p * 4 + c] - frames[i - 1].data[p * 4 + c]);
        absolute += delta;
        difference = Math.max(difference, delta);
      }
      if (difference > threshold) changed++;
      peak[p] = Math.max(peak[p], difference);
    }
    intervals.push({
      from: i - 1,
      to: i,
      dtMs: (samples[i].time - samples[i - 1].time) * 1000,
      changedPercent: (changed * 100) / pixels,
      meanAbsoluteDelta: absolute / (pixels * 3),
      duplicate: absolute === 0,
    });
  }
  const overlay = new PNG({ width, height }),
    difference = new PNG({ width, height });
  for (let p = 0; p < pixels; p++) {
    const gray =
      (frames[0].data[p * 4] + frames[0].data[p * 4 + 1] + frames[0].data[p * 4 + 2]) / 3;
    for (let c = 0; c < 3; c++) {
      overlay.data[p * 4 + c] = Math.round(255 * 0.82 + gray * 0.18);
      const strength = peak[p] > threshold ? Math.sqrt(peak[p] / 255) : 0;
      difference.data[p * 4 + c] = Math.round(250 + ([183, 61, 50][c] - 250) * strength);
    }
    overlay.data[p * 4 + 3] = difference.data[p * 4 + 3] = 255;
  }
  for (let i = 0; i < frames.length; i++) {
    const color = frameColor(i, frames.length),
      data = frames[i].data;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        if (!active[p]) continue;
        let edge = 0;
        for (const next of [
          x + 1 < width ? p + 1 : p,
          x ? p - 1 : p,
          y + 1 < height ? p + width : p,
          y ? p - width : p,
        ])
          for (let c = 0; c < 3; c++)
            edge = Math.max(edge, Math.abs(data[p * 4 + c] - data[next * 4 + c]));
        if (edge <= threshold) continue;
        const alpha = 0.3 + (0.6 * edge) / 255;
        for (let c = 0; c < 3; c++)
          overlay.data[p * 4 + c] = Math.round(
            overlay.data[p * 4 + c] * (1 - alpha) + color[c] * alpha,
          );
      }
  }
  return {
    width,
    height,
    crop: crop ?? null,
    threshold,
    motionBounds,
    sizeChanged: sizes.some((s) => s.width !== sizes[0].width || s.height !== sizes[0].height),
    frames: frames.map((frame, i) => ({
      time: samples[i].time,
      sourceSize: sizes[i],
      image: imageURL(frame),
    })),
    intervals,
    overlay: imageURL(overlay),
    difference: imageURL(difference),
  };
}

export function motionData({ overlay, difference, frames, ...report }) {
  return { ...report, frames: frames.map(({ image, ...frame }) => frame) };
}
