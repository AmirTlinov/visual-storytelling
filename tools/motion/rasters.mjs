import sharp from 'sharp';
import { frameInput } from './session.mjs';

export async function rasterImageURL({ data, width, height }) {
  return `data:image/png;base64,${(
    await sharp(Buffer.from(data), { raw: { width, height, channels: 4 } })
      .png({ compressionLevel: 3 })
      .toBuffer()
  ).toString('base64')}`;
}

/** Decode observed frames into one coordinate system, retaining straight-alpha RGB. */
export async function decodeMotionRasters(samples, { crop, maxSize = 960 } = {}) {
  if (!samples.length) throw new Error('Raster decoding needs at least one frame');
  if (!Number.isInteger(maxSize) || maxSize < 0)
    throw new Error('--max-size must be a positive integer, or 0 for source resolution');
  const sizes = await Promise.all(
    samples.map(async (sample) => {
      const { width, height } = await sharp(frameInput(sample)).metadata();
      return { width, height };
    }),
  );
  const sourceWidth = crop?.width ?? Math.max(...sizes.map((s) => s.width));
  const sourceHeight = crop?.height ?? Math.max(...sizes.map((s) => s.height));
  if (
    crop &&
    (!Object.values(crop).every(Number.isInteger) ||
      crop.x < 0 ||
      crop.y < 0 ||
      sourceWidth <= 0 ||
      sourceHeight <= 0 ||
      sizes.some((s) => crop.x + sourceWidth > s.width || crop.y + sourceHeight > s.height))
  )
    throw new Error('Crop must fit inside every source frame');
  const scale = maxSize ? Math.min(1, maxSize / Math.max(sourceWidth, sourceHeight)) : 1;
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const pixels = width * height;
  if (pixels > 16_000_000 || pixels * samples.length > 160_000_000)
    throw new Error('Analysis is too large; use --crop or --max-size 960');
  const rasters = [];
  for (let i = 0; i < samples.length; i++) {
    let pipeline = sharp(frameInput(samples[i])).toColourspace('srgb').ensureAlpha();
    if (crop)
      pipeline = pipeline.extract({
        left: crop.x,
        top: crop.y,
        width: sourceWidth,
        height: sourceHeight,
      });
    const w = crop ? width : Math.max(1, Math.round(sizes[i].width * scale));
    const h = crop ? height : Math.max(1, Math.round(sizes[i].height * scale));
    pipeline = pipeline.resize(w, h, { fit: 'fill' });
    if (w < width || h < height)
      pipeline = pipeline.extend({
        right: width - w,
        bottom: height - h,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      });
    rasters.push(await pipeline.raw().toBuffer());
  }
  return { rasters, sizes, width, height, crop: crop ?? null, scale, sourceWidth, sourceHeight };
}
