import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import sharp from 'sharp';
import { characterAtlas } from './atlas.mjs';
import { measureRig } from './measure.mjs';
import { characterProfile, characterArtwork } from './profiles.mjs';

/** The rig owns topology and draw order. A skin supplies artwork in that rig's UV frames. */
export async function compileCharacterPack(template, directories, { id = 'chibi-custom' } = {}) {
  const spec = JSON.parse(await readFile(resolve(template, 'pack.json'), 'utf8'));
  const data = JSON.parse(await readFile(resolve(template, 'rig.json'), 'utf8'));
  const base = data.skins.find((skin) => skin.name === spec.baseSkin);
  const originalSkins = [...data.skins];
  const replacements = new Map(),
    skins = [],
    viewSkins = {};
  const outfits = JSON.parse(await readFile(resolve(template, 'wardrobe/catalog.json'), 'utf8'));
  for (const entry of directories) {
    const { directory: root, profile } = await characterProfile(entry);
    if (profile.outfit && !Object.hasOwn(outfits, profile.outfit))
      throw new Error(`Unknown outfit: ${profile.outfit}`);
    if (profile.template !== spec.id) throw new Error(`Unknown template: ${profile.template}`);
    if (
      !/^[a-z][a-z0-9-]*$/.test(profile.id) ||
      skins.includes(profile.id) ||
      originalSkins.some((s) => s.name === profile.id)
    )
      throw new Error(`Invalid or duplicate skin ID: ${profile.id}`);
    const variants = [
      ['front', profile.parts],
      ...Object.entries(profile.views ?? {}).map(([view, parts]) => [
        view,
        { ...profile.parts, ...parts },
      ]),
    ];
    for (const [view, parts] of variants) {
      if (!['front', 'left', 'right', 'back'].includes(view))
        throw new Error(`Unknown view: ${view}`);
      const skin = structuredClone(base);
      skin.name = view === 'front' ? profile.id : profile.id + '@' + view;
      if (view !== 'front') (viewSkins[profile.id] ??= {})[view] = skin.name;
      const known = new Set(
        Object.values(skin.attachments).flatMap((entries) =>
          Object.entries(entries).map(([name, a]) => a.path || a.name || name),
        ),
      );
      for (const [part, entry] of Object.entries(parts)) {
        if (!known.has(entry.path)) throw new Error(`Unknown attachment in ${part}: ${entry.path}`);
        const svg = await characterArtwork(template, root, profile, part, view, entry, outfits);
        const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
        const { width: w, height: h } = await sharp(buffer).metadata();
        const path = skin.name + '/' + entry.path;
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
      data.skins.push(skin);
    }
    skins.push(profile.id);
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
  const { atlas, textures } = await characterAtlas(sprites);
  const gzip = gzipSync(
    Buffer.from(
      JSON.stringify({
        data,
        atlas,
        textures,
      }),
    ),
    { level: 9 },
  ).toString('base64');
  return {
    id,
    gzip,
    skins,
    actions: spec.actions,
    anchors: spec.anchors,
    credit: spec.credit,
    rig: spec.rig && { ...spec.rig, ...measureRig(data, atlas, spec.rig, skins) },
    viewSkins,
  };
}
