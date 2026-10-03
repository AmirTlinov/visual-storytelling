import { buildPackage } from './build-package.mjs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPages } from './build-pages.mjs';
import { buildOutput } from './build-output.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));

export async function buildGallery(target = resolve(root, 'site')) {
  await buildPackage();
  const catalog = JSON.parse(await readFile(resolve(root, 'examples/catalog.json'), 'utf8'));
  await buildOutput(root, target, async (output) => {
    await buildPages(output);
    const cards = Object.entries(catalog)
      .map(
        ([id, item]) =>
          `<a href="${id}/${item.page}"><picture><source media="(prefers-color-scheme:dark)" srcset="${id}/preview-dark.png"><img src="${id}/preview.png" alt="" loading="lazy"></picture><span>${item.title}</span></a>`,
      )
      .join('');
    const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Наглядные объяснения</title><script type="module">import '@visual-storytelling/core/style.css';</script><style>.ve-standalone main.ve-scene{max-width:1100px}.examples{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,290px),1fr));gap:36px 28px}a{color:inherit;text-decoration:none}img{display:block;width:100%;height:240px;object-fit:contain;object-position:top;background:Canvas}a span{display:block;margin-top:12px;font-size:20px}a:focus-visible{outline:1px solid var(--ve-pencil);outline-offset:6px}h1{margin-bottom:32px!important}</style></head><body class="ve-standalone"><main class="ve-scene" data-paper="false"><h1>Наглядные объяснения</h1><div class="examples">${cards}</div></main></body></html>`;
    const { buildPage } = await import('./build-pages.mjs');
    await buildPage(new URL('../examples/index.html', import.meta.url).pathname, output, {
      sourcePackage: true,
      html,
    });
  });
  console.log(`Built package and ${Object.keys(catalog).length} examples.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await buildGallery();
