import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

/** A cast varies shared artwork; editable directories are needed only for new drawings. */
export async function characterSources(template, inputs) {
  const result = [];
  for (const input of inputs) {
    const path = resolve(input);
    if ((await stat(path)).isDirectory()) {
      result.push(path);
      continue;
    }
    const cast = JSON.parse(await readFile(path, 'utf8'));
    if (!Array.isArray(cast) || !cast.length)
      throw new Error(`${path}: a cast must be a non-empty array of {id, from, outfit?, palette?}`);
    for (const entry of cast) {
      if (!entry || typeof entry.from !== 'string' || !entry.from)
        throw new Error(`${path}: each character needs from: tesla, mira or ./artwork-directory`);
      if (typeof entry.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(entry.id))
        throw new Error(`${path}: each character needs a unique lowercase id`);
      const { from, ...profile } = entry;
      if (Object.keys(profile).some((key) => !['id', 'outfit', 'palette'].includes(key)))
        throw new Error(
          `${path}: cast entries accept id, from, outfit and palette; edit parts in an artwork directory`,
        );
      if (!['tesla', 'mira'].includes(from) && !from.startsWith('./') && !from.startsWith('../'))
        throw new Error(
          `${path}: unknown character base ${from}; use tesla, mira or a relative directory`,
        );
      result.push({
        directory: ['tesla', 'mira'].includes(from)
          ? resolve(template, from)
          : resolve(dirname(path), from),
        profile,
      });
    }
  }
  return result;
}

export async function characterProfile(entry) {
  const directory = resolve(typeof entry === 'string' ? entry : entry.directory);
  const base = JSON.parse(await readFile(resolve(directory, 'character.json'), 'utf8'));
  const override = typeof entry === 'string' ? {} : entry.profile;
  const profile = { ...base, ...override, palette: { ...base.palette, ...override?.palette } };
  for (const [from, to] of Object.entries(profile.palette))
    if (!/^#[\da-f]{6}$/i.test(from) || typeof to !== 'string' || !/^#[\da-f]{6}$/i.test(to))
      throw new Error(
        `${profile.id}: palette maps six-digit hex colours, e.g. "#242b38": "#493734"`,
      );
  return { directory, profile };
}

/** Simultaneous substitutions: A→B and B→C must not silently turn both colours into C. */
export function paintCharacter(svg, palette = {}) {
  const colors = new Map(Object.entries(palette).map(([from, to]) => [from.toLowerCase(), to]));
  return svg.replace(
    /#[\da-f]{6}(?![\da-f])/gi,
    (color) => colors.get(color.toLowerCase()) ?? color,
  );
}

/** Compiler and editable contact sheets read exactly the same wardrobe and palette. */
export async function characterArtwork(template, directory, profile, part, view, entry, outfits) {
  const garment = profile.outfit && outfits[profile.outfit]?.parts.includes(part);
  const back = garment && view === 'back' && outfits[profile.outfit].back.includes(part);
  const owner = garment ? resolve(template, 'wardrobe', profile.outfit) : directory;
  const file = resolve(owner, garment ? `${part}${back ? '-back' : ''}.svg` : entry.file);
  if (!file.startsWith(owner + sep))
    throw new Error(`Artwork must be inside the character directory: ${part}`);
  return paintCharacter(await readFile(file, 'utf8'), profile.palette);
}
