import { buildPackage } from './build-package.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPages } from './build-pages.mjs';
import { buildOutput } from './build-output.mjs';
import { readCatalog } from './catalog.mjs';
import { buildGalleryIndex } from './gallery/render.mjs';
import { prepareNarration } from './narration.mjs';
import { parseArgs } from 'node:util';
import { sourceDigest, writeBuildInfo } from './build-info.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));

export async function buildGallery(target = resolve(root, 'site'), { narration = false } = {}) {
  const receipt = await buildPackage();
  const catalog = await readCatalog();
  if (narration) {
    for (const name of Object.keys(catalog))
      await prepareNarration(resolve(root, 'examples', name));
    if ((await sourceDigest(root)) !== receipt.source)
      throw new Error('Library sources changed while preparing narration. Run the build again.');
    // Narration is prepared against the fresh runtime above; its generated
    // timelines are also part of the shipped authoring kit.
    await writeBuildInfo(root, resolve(root, 'dist'), receipt.source);
  }
  await buildOutput(root, target, async (output) => {
    await buildPages(output);
    await buildGalleryIndex(output, catalog);
  });
  console.log(`Built package and ${Object.keys(catalog).length} examples.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { positionals, values } = parseArgs({
    options: { 'prepare-narration': { type: 'boolean' } },
    allowPositionals: true,
  });
  if (positionals.length > 1) throw new Error('Supply one gallery output directory');
  await buildGallery(positionals[0], { narration: values['prepare-narration'] });
}
