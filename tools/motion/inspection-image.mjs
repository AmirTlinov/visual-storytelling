import sharp from 'sharp';
import { comparisonFrames, renderFrameComparison } from './frame-comparison.mjs';
import { renderOnionFrames } from './frames.mjs';
import { decodeMotionRasters } from './rasters.mjs';
import { composeChange, temporalChangeStrength } from './onion.mjs';

/** Render only the requested view from saved pixels, using the report's composition owners. */
export async function renderInspectionImage(samples, selection, changes, options = {}) {
  const { view = 'pair', theme = 'light' } = options;
  const at = selection.current.time;
  if (view === 'pair')
    return { png: await renderFrameComparison(comparisonFrames(selection), { ...options, at }) };
  if (view === 'onion') {
    const { image, ...onion } = await renderOnionFrames(samples, { ...options, at });
    return {
      png: await sharp(Buffer.from(image.split(',')[1], 'base64'))
        .flatten({ background: theme === 'dark' ? '#20262b' : '#fff' })
        .png()
        .toBuffer(),
      onion,
    };
  }
  const frames =
    view === 'changes' && selection.previous
      ? [selection.previous, selection.current]
      : [selection.current];
  const geometry = await decodeMotionRasters(frames, options);
  const change = changes.find((entry) => entry.to.index === selection.current.index);
  const pixels =
    frames.length === 2
      ? composeChange(
          geometry.rasters[0],
          geometry.rasters[1],
          geometry.width,
          geometry.height,
          temporalChangeStrength(change),
        )
      : geometry.rasters[0];
  return {
    png: await sharp(Buffer.from(pixels), {
      raw: { width: geometry.width, height: geometry.height, channels: 4 },
    })
      .flatten({ background: theme === 'dark' ? '#20262b' : '#fff' })
      .png()
      .toBuffer(),
  };
}
