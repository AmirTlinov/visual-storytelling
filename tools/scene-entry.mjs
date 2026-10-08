import { readFile, access } from 'node:fs/promises';
import { join, basename } from 'node:path';

/** The authored entry may be generated; every build exposes one HTML entry. */
export const scenePage = 'index.html';

export async function sceneEntry(directory) {
  const config = await readFile(join(directory, 'scene.json'), 'utf8').then(JSON.parse, (error) => {
    if (error.code !== 'ENOENT') throw error;
    return {};
  });
  const page = config.entry ?? scenePage;
  if (
    typeof page !== 'string' ||
    basename(page) !== page ||
    !/^[^.][^\\/]*\.(?:html|svg)$/.test(page)
  )
    throw new Error('scene.json entry must name an HTML or SVG file in the project directory');
  const exists = (file) =>
    access(join(directory, file)).then(
      () => true,
      () => false,
    );
  const source = (await exists(page)) ? page : config.generator?.file;
  return {
    page,
    source:
      typeof source === 'string' &&
      !source.split(/[\\/]/).some((part) => !part || part === '..') &&
      (await exists(source))
        ? source
        : undefined,
  };
}

/** SVG keeps its own drawing and runtime; a plain drawing needs only scene access. */
export function svgPage(svg) {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0}body>svg{display:block;width:100%;height:auto}</style></head>
<body>${svg.replace(/<\?xml[^>]*>/, '')}
<script type="module">
import { mountScene as mountSVGEntryScene } from '@visual-storytelling/core';
window.galleryReady = Promise.resolve(window.galleryReady).then(async () => {
  await document.fonts.ready;
  const svg = document.querySelector('body > svg');
  if (!svg) throw new Error('The scene entry has no SVG document');
  svg.classList.add('ve-scene');
  if (!svg.scene) mountSVGEntryScene(svg, { svg: () => svg, dispose() { svg.pauseAnimations(); } });
});
</script></body></html>`;
}
