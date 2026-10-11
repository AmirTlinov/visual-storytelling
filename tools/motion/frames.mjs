import { onionLayers, composeOnion } from './onion.mjs';
import { decodeMotionRasters, rasterImageURL as imageURL } from './rasters.mjs';

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
  const parts = value.split(',').map((part) => (part.trim() ? Number(part) : NaN));
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

/** Select from the complete source timeline; only the bounded onion states are decoded. */
export async function renderOnionFrames(samples, { at, radius, crop, maxSize = 960 } = {}) {
  const plan = onionLayers(samples, { at, radius });
  const { rasters, sizes, ...geometry } = await decodeMotionRasters(
    plan.layers.map((layer) => samples[layer.index]),
    { crop, maxSize },
  );
  const data = composeOnion(rasters, geometry.width, geometry.height, plan.layers);
  return { ...plan, ...geometry, image: await imageURL({ data, ...geometry }) };
}

/** Compare one fixed coordinate system. Never deduplicate or retime. */
export async function analyzeMotionFrames(
  samples,
  { crop, threshold = 8, maxSize = 960, at, radius, includeOnion = true } = {},
) {
  if (samples.length < 2 || samples.length > 32) throw new Error('Motion review needs 2–32 frames');
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 255)
    throw new Error('Pixel threshold must be between 0 and 255');
  for (let i = 0; i < samples.length; i++)
    if (!Number.isFinite(samples[i].time) || (i && samples[i].time <= samples[i - 1].time))
      throw new Error('Frame times must be finite and strictly increasing, in seconds');
  const { rasters, sizes, width, height, scale, sourceWidth, sourceHeight } =
    await decodeMotionRasters(samples, { crop, maxSize });
  const pixels = width * height;
  let onion;
  if (includeOnion) {
    const plan = onionLayers(samples, { at, radius });
    const data = composeOnion(
      plan.layers.map((layer) => rasters[layer.index]),
      width,
      height,
      plan.layers,
    );
    onion = {
      ...plan,
      width,
      height,
      crop: crop ?? null,
      scale,
      sourceWidth,
      sourceHeight,
      image: await imageURL({ data, width, height }),
    };
  }
  const frames = [],
    images = [];
  let hasTransparency = false;
  for (const data of rasters) {
    images.push(await imageURL({ data, width, height }));
    // Only difference/edge diagnostics use premultiplied source RGB.
    for (let p = 0; p < pixels; p++) {
      const alpha = data[p * 4 + 3];
      if (alpha === 255) continue;
      hasTransparency = true;
      for (let c = 0; c < 3; c++) data[p * 4 + c] = Math.round((data[p * 4 + c] * alpha) / 255);
    }
    frames.push({ data });
  }
  const active = new Uint8Array(pixels),
    peak = new Uint8Array(pixels);
  let left = width,
    right = -1,
    top = height,
    bottom = -1;
  // Temporal range also finds gradual changes; static pixels stay quiet.
  const low = Uint8Array.from(frames[0].data),
    high = Uint8Array.from(low);
  for (const { data } of frames.slice(1))
    for (let i = 0; i < data.length; i++) {
      if (data[i] < low[i]) low[i] = data[i];
      if (data[i] > high[i]) high[i] = data[i];
    }
  for (let p = 0; p < pixels; p++) {
    for (let c = 0; c < 4; c++) if (high[p * 4 + c] - low[p * 4 + c] > threshold) active[p] = 1;
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
      for (let c = 0; c < 4; c++) {
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
      meanAbsoluteDelta: absolute / (pixels * 4),
      duplicate: absolute === 0,
    });
  }
  const overlay = { width, height, data: Buffer.alloc(pixels * 4) },
    difference = { width, height, data: Buffer.alloc(pixels * 4) };
  for (let p = 0; p < pixels; p++) {
    const gray =
      (frames[0].data[p * 4] + frames[0].data[p * 4 + 1] + frames[0].data[p * 4 + 2]) / 3 +
      229 * (1 - frames[0].data[p * 4 + 3] / 255);
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
          for (let c = 0; c < 4; c++)
            edge = Math.max(edge, Math.abs(data[p * 4 + c] - data[next * 4 + c]));
        if (edge <= threshold) continue;
        const alpha = 0.3 + (0.6 * edge) / 255;
        for (let c = 0; c < 3; c++)
          overlay.data[p * 4 + c] = Math.round(
            overlay.data[p * 4 + c] * (1 - alpha) + color[c] * alpha,
          );
      }
  }
  let suggestedCrop = motionBounds
    ? {
        x: (crop?.x ?? 0) + Math.floor((motionBounds.x * sourceWidth) / width),
        y: (crop?.y ?? 0) + Math.floor((motionBounds.y * sourceHeight) / height),
        width: Math.min(
          sourceWidth - Math.floor((motionBounds.x * sourceWidth) / width),
          Math.ceil((motionBounds.width * sourceWidth) / width),
        ),
        height: Math.min(
          sourceHeight - Math.floor((motionBounds.y * sourceHeight) / height),
          Math.ceil((motionBounds.height * sourceHeight) / height),
        ),
      }
    : null;
  if (
    suggestedCrop &&
    sizes.some(
      (size) =>
        suggestedCrop.x + suggestedCrop.width > size.width ||
        suggestedCrop.y + suggestedCrop.height > size.height,
    )
  )
    suggestedCrop = null;
  return {
    width,
    height,
    crop: crop ?? null,
    threshold,
    scale,
    sourceWidth,
    sourceHeight,
    hasTransparency,
    motionBounds,
    suggestedCrop,
    ...(onion ? { onion } : {}),
    sizeChanged: sizes.some((s) => s.width !== sizes[0].width || s.height !== sizes[0].height),
    frames: samples.map((sample, i) => ({
      time: sample.time,
      ...Object.fromEntries(
        ['capture', 'receivedTime', 'uncertaintyMs', 'pixelTimeUncertaintyMs']
          .filter((key) => key in sample)
          .map((key) => [key, sample[key]]),
      ),
      sourceSize: sizes[i],
      image: images[i],
    })),
    intervals,
    overlay: await imageURL(overlay),
    difference: await imageURL(difference),
  };
}

export function motionData(report) {
  // PNGs live in HTML and analysis files; nested comparisons never inflate the JSON.
  const omit = new Set([
    'overlay',
    'difference',
    'image',
    'images',
    'baselineImage',
    'currentImage',
    'samples',
    'telemetry',
  ]);
  return JSON.parse(JSON.stringify(report, (key, value) => (omit.has(key) ? undefined : value)));
}
