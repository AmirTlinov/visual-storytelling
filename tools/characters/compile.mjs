import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { characterAtlas } from './atlas.mjs';
import { measureRig } from './measure.mjs';
import { characterProfile, characterArtwork, paintCharacter } from './profiles.mjs';

/** An editable glTF owns motion and UV frames; each cast member supplies original SVG drawings. */
export async function compileCharacterPack(template, directories, { id = 'chibi-custom' } = {}) {
  const spec = JSON.parse(await readFile(resolve(template, 'pack.json'), 'utf8'));
  const gltf = JSON.parse(await readFile(resolve(template, 'rig.gltf'), 'utf8'));
  const drawings = new Map(
    gltf.nodes.filter((n) => n.extras?.artwork).map((n) => [n.extras.artwork, n.extras]),
  );
  const outfits = JSON.parse(await readFile(resolve(template, 'wardrobe/catalog.json'), 'utf8'));
  const sprites = [],
    skins = [],
    viewSkins = {},
    variants = [];
  for (const entry of directories) {
    const { directory, profile } = await characterProfile(entry);
    if (profile.outfit && !Object.hasOwn(outfits, profile.outfit))
      throw new Error(`Unknown outfit: ${profile.outfit}`);
    if (profile.template !== spec.id) throw new Error(`Unknown template: ${profile.template}`);
    if (!/^[a-z][a-z0-9-]*$/.test(profile.id) || skins.includes(profile.id))
      throw new Error(`Invalid or duplicate skin ID: ${profile.id}`);
    for (const [view, parts] of [
      ['front', profile.parts],
      ...Object.entries(profile.views ?? {}).map(([view, parts]) => [
        view,
        { ...profile.parts, ...parts },
      ]),
    ]) {
      if (!['front', 'left', 'right', 'back'].includes(view))
        throw new Error(`Unknown view: ${view}`);
      const skin = view === 'front' ? profile.id : `${profile.id}@${view}`;
      if (view !== 'front') (viewSkins[profile.id] ??= {})[view] = skin;
      const replacements = new Map();
      for (const [part, drawing] of Object.entries(parts)) {
        if (!drawings.has(drawing.path))
          throw new Error(`Unknown drawing in ${part}: ${drawing.path}`);
        if (replacements.has(drawing.path)) throw new Error(`Duplicate drawing: ${drawing.path}`);
        replacements.set(
          drawing.path,
          await characterArtwork(template, directory, profile, part, view, drawing, outfits),
        );
      }
      for (const [path, frame] of drawings) {
        const svg =
          replacements.get(path) ??
          paintCharacter(
            await readFile(resolve(template, 'artwork', `${path}.svg`), 'utf8'),
            profile.palette,
          );
        if (/<image\b|data:image\//i.test(svg))
          throw new Error(
            `${path}: character drawings must be editable SVG without embedded images`,
          );
        const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
        const { width: w, height: h } = await sharp(buffer).metadata();
        if (frame.width !== w || frame.height !== h)
          throw new Error(
            `${path}: preserve the glTF drawing frame ${frame.width} × ${frame.height} (got ${w} × ${h})`,
          );
        sprites.push({ path: `${skin}/${path}`, buffer, w, h });
      }
      variants.push(skin);
    }
    skins.push(profile.id);
  }
  if (!skins.length) throw new Error('Provide at least one character directory');
  const { regions, textures } = await characterAtlas(sprites);
  const appearances = Object.fromEntries(
    variants.map((skin) => [
      skin,
      Object.fromEntries([...drawings.keys()].map((path) => [path, regions[`${skin}/${path}`]])),
    ]),
  );
  gltf.images = textures.map((uri, index) => ({ uri, name: `characters-${index}` }));
  gltf.textures = textures.map((_, source) => ({ source, sampler: 0 }));
  gltf.extensionsUsed = [...new Set([...gltf.extensionsUsed, 'KHR_texture_transform'])];
  for (const material of gltf.materials) {
    const binding = appearances[skins[0]][material.name];
    material.pbrMetallicRoughness.baseColorTexture = {
      index: binding.texture,
      extensions: { KHR_texture_transform: { offset: binding.offset, scale: binding.scale } },
    };
  }
  const rig = spec.rig && { ...spec.rig, ...(await measureRig(gltf, spec.rig, skins)) };
  return {
    id,
    gltf: JSON.stringify(gltf),
    appearances,
    skins,
    actions: spec.actions,
    anchors: spec.anchors,
    credit: spec.credit,
    rig,
    viewSkins,
  };
}
