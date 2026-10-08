import { access, cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { compileCharacterPack } from './compile.mjs';
import { characterSources, characterProfile, characterArtwork } from './profiles.mjs';

export async function runCharacters(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      from: { type: 'string', default: 'tesla' },
      outfit: { type: 'string' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const source = join(root, 'src/assets/characters/chibi');
  const template = await access(source).then(
    () => source,
    () => join(root, 'dist/assets/characters/chibi'),
  );
  const spec = JSON.parse(await readFile(join(template, 'pack.json'), 'utf8'));
  const [command = 'list', ...inputs] = positionals;
  if (values.help) {
    console.log(`visual-story characters [list] [--json]
visual-story characters new ID --from tesla|mira [--outfit NAME] --out DIRECTORY
visual-story characters build CAST.json|DIRECTORY [CAST.json|DIRECTORY ...] --out pack.json

new copies editable SVG artwork and its rig-compatible frames; existing files are preserved.
A cast JSON is [{"id":"scientist","from":"mira","outfit":"lab-coat","palette":{"#ffdac3":"#d4a077"}}].
Use a cast for appearance variations; use new only when editing the SVG drawings.
from is tesla, mira or an artwork directory relative to the cast file.
Edit the SVG parts or character.json palette, then build once. Import the result as CharacterPack.
The editable glTF owns the skeleton, weighted drawings, clips and contact anchors.`);
    return;
  }
  if (command === 'list') {
    const stagingPath = await access(join(root, 'src/characters/staging/catalog.json')).then(
      () => join(root, 'src/characters/staging/catalog.json'),
      () => join(root, 'dist/characters/staging/catalog.json'),
    );
    const staging = JSON.parse(await readFile(stagingPath, 'utf8'));
    const catalog = {
      pack: spec.id,
      skins: JSON.parse(await readFile(join(template, 'cast.json'), 'utf8')).map((p) => p.id),
      outfits: JSON.parse(await readFile(join(template, 'wardrobe/catalog.json'), 'utf8')),
      actions: Object.keys(spec.actions),
      anchors: Object.keys(spec.anchors),
      sets: ['laboratory', 'conservatory', 'workshop'],
      props: ['bulb', 'workbench', 'seedling', 'spark'],
      staging,
      credit: spec.credit,
    };
    console.log(
      values.json
        ? JSON.stringify(catalog, null, 2)
        : Object.entries(catalog)
            .map(
              ([key, value]) =>
                `${key}: ${Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value, null, 2) : value}`,
            )
            .join('\n'),
    );
  } else if (command === 'new') {
    const [id] = inputs;
    if (inputs.length !== 1 || !/^[a-z][a-z0-9-]*$/.test(id ?? '') || !values.out)
      throw new Error('Use characters new ID --out DIRECTORY');
    if (!['tesla', 'mira'].includes(values.from)) throw new Error('Choose --from tesla or mira');
    const outfits = JSON.parse(await readFile(join(template, 'wardrobe/catalog.json'), 'utf8'));
    if (values.outfit && !Object.hasOwn(outfits, values.outfit))
      throw new Error(`Unknown outfit: ${values.outfit}`);
    const destination = resolve(values.out);
    if (
      await readdir(destination).then(
        (files) => files.length,
        (err) => {
          if (err.code !== 'ENOENT') throw err;
          return 0;
        },
      )
    )
      throw new Error('Choose an empty character directory');
    await mkdir(destination, { recursive: true });
    await cp(join(template, values.from), destination, { recursive: true });
    const profile = JSON.parse(await readFile(join(destination, 'character.json'), 'utf8'));
    profile.id = id;
    if (values.outfit) {
      const outfit = outfits[values.outfit];
      for (const part of outfit.parts)
        await cp(
          join(template, 'wardrobe', values.outfit, `${part}.svg`),
          join(destination, profile.parts[part].file),
        );
      for (const part of outfit.back)
        await cp(
          join(template, 'wardrobe', values.outfit, `${part}-back.svg`),
          join(destination, profile.views.back[part].file),
        );
    }
    await writeFile(join(destination, 'character.json'), JSON.stringify(profile, null, 2) + '\n');
    await cp(join(template, 'LICENSE.txt'), join(destination, 'CREDITS.txt'));
    await writeFile(
      join(destination, 'sheet.svg'),
      await contactSheet(template, destination, profile),
    );
    console.log(
      `Created ${id}: ${Object.keys(profile.parts).length} editable parts\n${join(destination, 'sheet.svg')}\nBuild: visual-story characters build ${destination} --out ${join(dirname(destination), id + '.json')}`,
    );
  } else if (command === 'build') {
    if (!inputs.length || !values.out)
      throw new Error('Use characters build CAST.json|DIRECTORY [...] --out pack.json');
    const sources = await characterSources(template, inputs);
    const pack = await compileCharacterPack(template, sources);
    // Only editable directories own sheet.svg. Cast variations never modify their shared base.
    const sheets = await Promise.all(
      [...new Set(sources.filter((source) => typeof source === 'string'))].map(async (source) => {
        const { directory, profile } = await characterProfile(source);
        return {
          file: join(directory, 'sheet.svg'),
          svg: await contactSheet(template, directory, profile),
        };
      }),
    );
    const out = resolve(values.out);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, JSON.stringify(pack) + '\n');
    for (const { file, svg } of sheets) await writeFile(file, svg);
    await writeFile(
      join(dirname(out), 'CHARACTER-CREDITS.txt'),
      pack.credit + '\n\n' + (await readFile(join(template, 'LICENSE.txt'), 'utf8')),
    );
    console.log(
      `Built ${pack.skins.join(', ')}: ${Object.keys(pack.actions).length} actions, ${Math.round(pack.gltf.length / 1024)} KiB\n${out}`,
    );
  } else throw new Error(`Unknown characters command: ${command}`);
}

async function contactSheet(template, directory, profile) {
  const outfits = JSON.parse(await readFile(join(template, 'wardrobe/catalog.json'), 'utf8'));
  const entries = [
      ...Object.entries(profile.parts).map(([part, entry]) => ({ part, view: 'front', entry })),
      ...Object.entries(profile.views ?? {}).flatMap(([view, parts]) =>
        Object.entries(parts).map(([part, entry]) => ({ part, view, entry })),
      ),
    ],
    columns = 4,
    size = 220,
    height = 240 * Math.ceil(entries.length / columns);
  const escape = (s) =>
    String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  const cells = await Promise.all(
    entries.map(async ({ part, view, entry }, index) => {
      const name = view === 'front' ? part : `${part} (${view})`;
      const art = await characterArtwork(template, directory, profile, part, view, entry, outfits);
      return `<g transform="translate(${(index % columns) * size} ${Math.floor(index / columns) * 240})"><rect x="8" y="8" width="204" height="204" fill="#edf0ed" stroke="#7b8886" stroke-dasharray="4 4"/><path d="M110 8v204M8 110h204" stroke="#c5ccca"/><image x="18" y="18" width="184" height="184" href="data:image/svg+xml;base64,${Buffer.from(art).toString('base64')}"/><text x="110" y="231" text-anchor="middle" fill="#253b42" font-size="15">${escape(name)}</text></g>`;
    }),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="880" height="${height}" viewBox="0 0 880 ${height}"><title>${escape(profile.id)} artwork frames</title><rect width="880" height="${height}" fill="#fff"/>${cells.join('')}</svg>\n`;
}
