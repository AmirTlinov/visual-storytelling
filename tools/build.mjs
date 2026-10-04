import { buildPackage } from './build-package.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPages } from './build-pages.mjs';
import { buildOutput } from './build-output.mjs';
import { readCatalog } from './catalog.mjs';
import { buildGalleryIndex } from './gallery/render.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));

export async function buildGallery(target = resolve(root, 'site')) {
  await buildPackage();
  const catalog = await readCatalog();
  await buildOutput(root, target, async (output) => {
    await buildPages(output);
    await buildGalleryIndex(output, catalog);
  });
  console.log(`Built package and ${Object.keys(catalog).length} examples.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await buildGallery(process.argv[2]);
