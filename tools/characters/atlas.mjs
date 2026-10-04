import { createHash } from 'node:crypto';
import sharp from 'sharp';

/** Atlas regions may share identical pixels. Pages stay within a portable GPU texture size. */
export async function characterAtlas(sprites, { pageSize = 2048 } = {}) {
  if (!Number.isSafeInteger(pageSize) || pageSize < 16 || pageSize > 8192)
    throw new Error('Atlas page size must be an integer between 16 and 8192');
  const pad = 3,
    unique = [],
    byPixels = new Map();
  for (const sprite of sprites) {
    if (
      ![sprite.w, sprite.h].every((n) => Number.isInteger(n) && n > 0) ||
      sprite.w + 2 * pad > pageSize ||
      sprite.h + 2 * pad > pageSize
    )
      throw new Error(`Artwork exceeds the ${pageSize}px atlas page: ${sprite.path}`);
    const key = createHash('sha256')
      .update(`${sprite.w},${sprite.h}:`)
      .update(sprite.buffer)
      .digest('hex');
    let entry = byPixels.get(key);
    if (!entry) {
      entry = { ...sprite, aliases: [] };
      byPixels.set(key, entry);
      unique.push(entry);
    }
    entry.aliases.push(sprite.path);
  }
  unique.sort((a, b) => b.h - a.h || b.w - a.w || a.path.localeCompare(b.path));
  const area = unique.reduce((sum, s) => sum + (s.w + pad) * (s.h + pad), 0);
  const widest = unique.reduce((max, s) => Math.max(max, s.w + 2 * pad), 16);
  const width = Math.min(pageSize, 2 ** Math.ceil(Math.log2(Math.max(widest, Math.sqrt(area)))));
  const pages = [];
  let x = pad,
    y = pad,
    rowHeight = 0,
    page = [];
  const finish = () => {
    if (page.length)
      pages.push({
        sprites: page,
        height: page.reduce((bottom, s) => Math.max(bottom, s.y + s.h), 0) + pad,
      });
    page = [];
    x = y = pad;
    rowHeight = 0;
  };
  for (const sprite of unique) {
    if (x + sprite.w + pad > width) {
      x = pad;
      y += rowHeight + pad;
      rowHeight = 0;
    }
    if (y + sprite.h + pad > pageSize) finish();
    page.push({ ...sprite, x, y });
    x += sprite.w + pad;
    rowHeight = Math.max(rowHeight, sprite.h);
  }
  finish();
  const textures = {},
    sections = [];
  for (const [index, page] of pages.entries()) {
    const name = `characters-${index}.webp`;
    const bytes = await sharp({
      create: { width, height: page.height, channels: 4, background: '#00000000' },
    })
      .composite(page.sprites.map((s) => ({ input: s.buffer, left: s.x, top: s.y })))
      .webp({ quality: 88, alphaQuality: 100 })
      .toBuffer();
    textures[name] = 'data:image/webp;base64,' + bytes.toString('base64');
    sections.push(
      `${name}\nsize: ${width},${page.height}\nfilter: Linear,Linear\nrepeat: none\n` +
        page.sprites
          .flatMap((s) => s.aliases.map((path) => `${path}\nbounds: ${s.x},${s.y},${s.w},${s.h}\n`))
          .join(''),
    );
  }
  return { atlas: sections.join('\n'), textures };
}
