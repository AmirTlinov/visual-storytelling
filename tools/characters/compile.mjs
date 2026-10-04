import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import sharp from 'sharp';

/** The rig owns topology and draw order. A skin supplies artwork in that rig's UV frames. */
export async function compileCharacterPack(template, directories, { id = 'chibi-custom' } = {}) {
  const spec = JSON.parse(await readFile(resolve(template, 'pack.json'), 'utf8'));
  const data = JSON.parse(await readFile(resolve(template, 'rig.json'), 'utf8'));
  const base = data.skins.find((skin) => skin.name === spec.baseSkin);
  const originalSkins = data.skins;
  const replacements = new Map(),
    skins = [];
  for (const directory of directories) {
    const root = resolve(directory);
    const profile = JSON.parse(await readFile(resolve(root, 'character.json'), 'utf8'));
    if (profile.template !== spec.id) throw new Error(`Unknown template: ${profile.template}`);
    if (
      !/^[a-z][a-z0-9-]*$/.test(profile.id) ||
      skins.includes(profile.id) ||
      originalSkins.some((s) => s.name === profile.id)
    )
      throw new Error(`Invalid or duplicate skin ID: ${profile.id}`);
    const skin = structuredClone(base);
    skin.name = profile.id;
    const known = new Set(
      Object.values(skin.attachments).flatMap((entries) =>
        Object.entries(entries).map(([name, a]) => a.path || a.name || name),
      ),
    );
    for (const [part, entry] of Object.entries(profile.parts)) {
      if (!known.has(entry.path)) throw new Error(`Unknown attachment in ${part}: ${entry.path}`);
      const file = resolve(root, entry.file);
      if (!file.startsWith(root + sep))
        throw new Error(`Artwork must be inside the character directory: ${part}`);
      let svg = await readFile(file, 'utf8');
      for (const [from, to] of Object.entries(profile.palette ?? {}))
        svg = svg.replaceAll(from, to);
      const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
      const { width: w, height: h } = await sharp(buffer).metadata();
      const path = profile.id + '/' + entry.path;
      if (replacements.has(path)) throw new Error(`Duplicate artwork: ${entry.path}`);
      let matches = 0;
      for (const entries of Object.values(skin.attachments))
        for (const [name, a] of Object.entries(entries))
          if ((a.path || a.name || name) === entry.path) {
            const mesh = a.type === 'mesh' || a.type === 'linkedmesh';
            if (mesh && (a.width !== w || a.height !== h))
              throw new Error(
                `${part}: preserve the mesh's ${a.width} × ${a.height} drawing frame (got ${w} × ${h})`,
              );
            if (entry.y !== undefined && (!Number.isFinite(entry.y) || mesh))
              throw new Error(`${part}: only region attachments accept a finite y offset`);
            a.path = path;
            a.name = path;
            if (!mesh) {
              a.width = w;
              a.height = h;
              a.y = (a.y || 0) + (entry.y || 0);
            }
            if (a.color) a.color = 'ffffff' + a.color.slice(6);
            matches++;
          }
      if (!matches) throw new Error(`Unused part: ${part}`);
      replacements.set(path, { path, buffer, w, h });
    }
    skins.push(profile.id);
    data.skins.push(skin);
  }
  if (!skins.length) throw new Error('Provide at least one character directory');
  // Dependency skins retain the native weighted meshes. Their own textures are never displayed.
  const first = data.skins.find((s) => s.name === skins[0]);
  for (const skin of originalSkins.filter((s) => !skins.includes(s.name) && s.name !== 'default')) {
    for (const [slot, entries] of Object.entries(skin.attachments ?? {}))
      for (const [name, a] of Object.entries(entries)) {
        const child = first.attachments[slot]?.[name];
        if (child) a.path = child.path || child.name || name;
      }
  }
  const paths = new Set();
  for (const skin of data.skins)
    for (const entries of Object.values(skin.attachments ?? {}))
      for (const [name, a] of Object.entries(entries))
        if (!a.type || ['region', 'mesh', 'linkedmesh'].includes(a.type))
          paths.add(a.path || a.name || name);
  const sprites = [];
  for (const path of paths) {
    if (replacements.has(path)) sprites.push(replacements.get(path));
    else {
      const buffer = await readFile(resolve(template, 'images', path + '.png'));
      const { width: w, height: h } = await sharp(buffer).metadata();
      sprites.push({ path, buffer, w, h });
    }
  }
  sprites.sort((a, b) => b.h - a.h || a.path.localeCompare(b.path));
  const width = 1024,
    pad = 3;
  let x = pad,
    y = pad,
    rowHeight = 0;
  for (const sprite of sprites) {
    if (sprite.w + 2 * pad > width)
      throw new Error(`Artwork is wider than the atlas: ${sprite.path}`);
    if (x + sprite.w + pad > width) {
      x = pad;
      y += rowHeight + pad;
      rowHeight = 0;
    }
    sprite.x = x;
    sprite.y = y;
    x += sprite.w + pad;
    rowHeight = Math.max(rowHeight, sprite.h);
  }
  const height = y + rowHeight + pad;
  const texture = await sharp({ create: { width, height, channels: 4, background: '#00000000' } })
    .composite(sprites.map((s) => ({ input: s.buffer, left: s.x, top: s.y })))
    .webp({ quality: 88, alphaQuality: 100 })
    .toBuffer();
  const atlas =
    `characters.webp\nsize: ${width},${height}\nfilter: Linear,Linear\nrepeat: none\n` +
    sprites.map((s) => `${s.path}\nbounds: ${s.x},${s.y},${s.w},${s.h}\n`).join('');
  const gzip = gzipSync(
    Buffer.from(
      JSON.stringify({
        data,
        atlas,
        texture: 'data:image/webp;base64,' + texture.toString('base64'),
      }),
    ),
    { level: 9 },
  ).toString('base64');
  return { id, gzip, skins, actions: spec.actions, anchors: spec.anchors, credit: spec.credit };
}
