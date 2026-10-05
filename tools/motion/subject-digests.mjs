import sharp from 'sharp';
import { createHash } from 'node:crypto';

/** Keep chrome out of action evidence; position is part of the visible state. */
export async function subjectDigests(png, regions) {
  // Many semantic faces can share one frame. Decode it once, with bounded crop memory.
  const {
    data: pixels,
    info: { width, height },
  } = await sharp(png)
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const subjects = new Map();
  for (const { id, x, y, width: w, height: h, exclude = [] } of regions) {
    if (!subjects.has(id)) subjects.set(id, new Set());
    const left = Math.max(0, Math.floor(x)),
      top = Math.max(0, Math.floor(y));
    const crop = {
      left,
      top,
      width: Math.min(width, Math.ceil(x + w)) - left,
      height: Math.min(height, Math.ceil(y + h)) - top,
    };
    if (w <= 0 || h <= 0 || crop.width <= 0 || crop.height <= 0) continue;
    const data = Buffer.allocUnsafe(crop.width * crop.height * 4);
    for (let row = 0; row < crop.height; row++) {
      const from = ((top + row) * width + left) * 4;
      pixels.copy(data, row * crop.width * 4, from, from + crop.width * 4);
    }
    for (const box of exclude) {
      const x0 = Math.max(0, Math.floor(box.x - left)),
        x1 = Math.min(crop.width, Math.ceil(box.x + box.width - left));
      const y0 = Math.max(0, Math.floor(box.y - top)),
        y1 = Math.min(crop.height, Math.ceil(box.y + box.height - top));
      for (let row = y0; row < y1; row++)
        if (x1 > x0) data.fill(0, (row * crop.width + x0) * 4, (row * crop.width + x1) * 4);
    }
    const digest = createHash('sha256').update(JSON.stringify(crop)).update(data).digest('hex');
    // An object can have several visible labels/faces plus hidden representations.
    // None may overwrite the evidence for its other visible parts.
    subjects.get(id).add(digest);
  }
  return Object.fromEntries(
    [...subjects].map(([id, values]) => {
      const hashes = [...values].sort();
      return [
        id,
        !hashes.length
          ? 'hidden'
          : hashes.length === 1
            ? hashes[0]
            : createHash('sha256').update(JSON.stringify(hashes)).digest('hex'),
      ];
    }),
  );
}
