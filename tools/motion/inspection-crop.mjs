import sharp from 'sharp';
import { queryEvidence } from './inspection.mjs';
import { onionLayers } from './onion.mjs';
import { comparisonFrames } from './frame-comparison.mjs';

/** One source-pixel crop for every frame in the view, including a moving or disappearing object. */
export async function focusCrop(loaded, selection, query) {
  const { samples } = loaded;
  const frames =
    query.view === 'onion'
      ? onionLayers(samples, { at: selection.current.time, radius: query.radius }).layers.map(
          (layer) => samples[layer.index],
        )
      : query.view === 'frame'
        ? [samples[selection.current.index]]
        : query.view === 'changes'
          ? [selection.previous, selection.current]
              .filter(Boolean)
              .map((frame) => samples[frame.index])
          : comparisonFrames(selection).map((frame) => samples[frame.index]);
  return cropForFrames({ ...loaded, samples: frames }, { ...query, at: selection.current.time });
}

/** The caller owns frame selection; crop only after the actual view/report interval is known. */
export async function cropForFrames({ samples, telemetry, source }, { at, object, point }) {
  if (!object && !point) throw new Error('--crop auto needs --object ID or --point x,y');
  const evidence = queryEvidence(
    { frames: samples, telemetry, source },
    {
      at: at ?? (samples[0].time + samples.at(-1).time) / 2,
      from: samples[0].time,
      to: samples.at(-1).time,
      object,
      point,
      limit: 1,
    },
  );
  const bounds = evidence.bounds;
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite))
    throw new Error(
      'No observed bounds for this detail in the selected view; use --list objects or a numeric --crop',
    );
  // Legacy manifests need not contain image dimensions. Read only the selected PNG headers.
  const sizes = await Promise.all(
    samples.map((frame) => sharp(frame.png ?? frame.file).metadata()),
  );
  const width = Math.min(...sizes.map((size) => size.width));
  const height = Math.min(...sizes.map((size) => size.height));
  const x = Math.max(0, Math.floor(bounds.x - 12));
  const y = Math.max(0, Math.floor(bounds.y - 12));
  const right = Math.min(width, Math.ceil(bounds.x + bounds.width + 12));
  const bottom = Math.min(height, Math.ceil(bounds.y + bounds.height + 12));
  if (right <= x || bottom <= y)
    throw new Error('The observed detail lies outside the saved frame');
  return {
    crop: { x, y, width: right - x, height: bottom - y },
    focus: {
      object: evidence.requested.object,
      bounds,
      clipped:
        bounds.x < 0 ||
        bounds.y < 0 ||
        bounds.x + bounds.width > width ||
        bounds.y + bounds.height > height,
      coordinates: 'source-pixels',
    },
  };
}
