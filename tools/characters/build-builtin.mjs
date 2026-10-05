import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compileCharacterPack } from './compile.mjs';
import { characterSources } from './profiles.mjs';
export async function buildBuiltinCharacters() {
  const template = fileURLToPath(new URL('../../src/assets/characters/chibi/', import.meta.url));
  const pack = await compileCharacterPack(
    template,
    await characterSources(template, [template + '/cast.json']),
    {
      id: 'chibi',
    },
  );
  const output = new URL('../../src/characters/packs/chibi-data.json', import.meta.url),
    text = JSON.stringify(pack) + '\n';
  if (
    (await readFile(output, 'utf8').catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return '';
    })) !== text
  )
    await writeFile(output, text);
  return pack;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pack = await buildBuiltinCharacters();
  console.log(
    `${pack.id}: ${pack.skins.join(', ')}, ${Object.keys(pack.actions).length} actions, ${Math.round(pack.gzip.length / 1024)} KiB packed`,
  );
}
