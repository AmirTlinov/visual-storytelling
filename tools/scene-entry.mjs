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

/** SVG keeps its drawing and runtime; the common frame owns only its presentation. */
export function svgPage(svg) {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark}
:root:has(svg[data-theme=light]){color-scheme:light}
:root:has(svg[data-theme=dark]){color-scheme:dark}
body{margin:0;background:Canvas}
.ve-svg-entry.ve-scene-content{padding:0;display:block}
.ve-svg-entry>svg.ve-scene{display:block;width:100%;height:100%;max-width:none;margin:0;padding:0}
</style></head>
<body class="ve-standalone">${svg.replace(/<\?xml[^>]*>/, '')}
<script type="module">
import '@visual-storytelling/core/style.css';
import { mountScene as mountSVGEntryScene, SceneShell, theme } from '@visual-storytelling/core';
window.galleryReady = Promise.resolve(window.galleryReady).then(async () => {
  await document.fonts.ready;
  const svg = document.querySelector('body > svg');
  if (!svg) throw new Error('The scene entry has no SVG document');
  svg.classList.add('ve-scene');
  const handle = svg.scene ?? mountSVGEntryScene(svg, { svg: () => svg, dispose() { svg.pauseAnimations(); } });
  const root = document.createElement('main');
  root.className = 've-scene';
  root.dataset.paper = 'false';
  const colors = theme(root);
  const sourceColors = handle.setTheme ? undefined : theme(svg);
  const sourceTheme = handle.setTheme?.bind(handle);
  handle.extend({ setTheme(value) { colors.set(value); return sourceTheme ? sourceTheme(value) : sourceColors.set(value); } });
  const content = document.createElement('div');
  content.className = 've-svg-entry';
  svg.before(root);
  content.append(svg);
  const frame = SceneShell.frame(content, { width: 1280, height: 720, scope: 'scene' });
  root.append(frame.element);
  Object.defineProperty(root, 'scene', { configurable: true, get: () => svg.scene });
  handle.onDispose(() => { frame.dispose(); colors.dispose(); sourceColors?.dispose(); delete root.scene; });
  frame.resize();
});
</script></body></html>`;
}
