import sharp from 'sharp';
import { createHash } from 'node:crypto';

/** Keep chrome out of action evidence; position is part of the visible state. */
export async function subjectDigests(png, regions) {
  const { width, height } = await sharp(png).metadata();
  return Object.fromEntries(
    await Promise.all(
      regions.map(async ({ id, x, y, width: w, height: h, exclude = [] }) => {
        const left = Math.max(0, Math.floor(x)),
          top = Math.max(0, Math.floor(y));
        const crop = {
          left,
          top,
          width: Math.min(width, Math.ceil(x + w)) - left,
          height: Math.min(height, Math.ceil(y + h)) - top,
        };
        if (w <= 0 || h <= 0 || crop.width <= 0 || crop.height <= 0) return [id, 'hidden'];
        const { data, info } = await sharp(png)
          .extract(crop)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        for (const box of exclude) {
          const x0 = Math.max(0, Math.floor(box.x - left)),
            x1 = Math.min(info.width, Math.ceil(box.x + box.width - left));
          const y0 = Math.max(0, Math.floor(box.y - top)),
            y1 = Math.min(info.height, Math.ceil(box.y + box.height - top));
          for (let row = y0; row < y1; row++)
            if (x1 > x0) data.fill(0, (row * info.width + x0) * 4, (row * info.width + x1) * 4);
        }
        return [id, createHash('sha256').update(JSON.stringify(crop)).update(data).digest('hex')];
      }),
    ),
  );
}
