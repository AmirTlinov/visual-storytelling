import { readFile, access, realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { readStoryProject, storyModuleSource, storyProjectOwnerFiles } from './story-project.mjs';
import { readPreparedRuntime } from './runtime-reference.mjs';
import { assetURLs } from './asset-urls.mjs';
import { setNarrationMode } from './narration.mjs';
import { withStoryDocument, inStoryHead } from './story-html.mjs';

/** Compile authored JS/TS only. Its browser imports bind to the project's immutable common runtime. */
export async function preparedStoryTemplate(directory) {
  const manifest = await readStoryProject(directory);
  const pin = await readPreparedRuntime(directory);
  if (!manifest || !pin) return null;
  let factory = '';
  if (manifest.modules.length) {
    // Only the trusted pinned package is imported here. Authored code executes in the renderer.
    const { documentRuntime } = await import(
      pathToFileURL(join(pin.root, 'dist/story/runtime.js')).href
    );
    const exports = Object.keys(documentRuntime);
    const owner = await realpath(directory);
    const assertOwned = async (path) => {
      const physical = await realpath(path);
      if (
        !physical.startsWith(owner + sep) ||
        [...storyProjectOwnerFiles].some((name) => physical === join(owner, name))
      )
        throw new Error(
          'Author modules receive model inputs from the document; imports/resources must remain in their own project domain.',
        );
    };
    const result = await build({
      stdin: { contents: storyModuleSource(manifest, directory), resolveDir: directory },
      bundle: true,
      write: false,
      format: 'iife',
      globalName: 'authored',
      platform: 'browser',
      target: 'es2022',
      define: { 'import.meta.url': 'document.baseURI' },
      plugins: [
        {
          name: 'common-story-runtime',
          setup(builder) {
            builder.onLoad({ filter: /.*/, namespace: 'file' }, async ({ path }) => {
              await assertOwned(path);
              return undefined;
            });
            builder.onResolve({ filter: /^@visual-storytelling\/core\/style\.css$/ }, () => ({
              path: 'style',
              namespace: 'story-runtime',
            }));
            builder.onResolve(
              { filter: /^@visual-storytelling\/core(?:\/(?:ink|recipes|story|three))?$/ },
              () => ({ path: 'runtime', namespace: 'story-runtime' }),
            );
            builder.onLoad({ filter: /.*/, namespace: 'story-runtime' }, ({ path }) => ({
              contents:
                path === 'style'
                  ? ''
                  : exports.map((name) => `export const ${name}=runtime.${name};`).join('\n'),
              loader: 'js',
            }));
          },
        },
        assetURLs({
          assertAsset: assertOwned,
        }),
      ],
      loader: {
        '.png': 'dataurl',
        '.svg': 'dataurl',
        '.webp': 'dataurl',
        '.woff2': 'dataurl',
        '.json': 'json',
      },
    });
    factory = `window.__visualStoryModuleFactory=function(runtime){${result.outputFiles[0].text}\nreturn authored;};`;
  }
  const setup = `<script>${factory.replace(/<\/script/gi, '<\\/script')}</script>`;
  const head = [setup];
  // CSS is a declared resource; other resources remain in the ordinary source snapshot and packer.
  for (const resource of manifest.resources.filter((file) => file.endsWith('.css'))) {
    const css = await readFile(join(directory, resource), 'utf8');
    head.push(`<style>${css.replaceAll('</style', '<\\/style')}</style>`);
  }
  const html = inStoryHead(
    await readFile(join(pin.root, 'plugin/dist/live.html'), 'utf8'),
    head.join(''),
  );
  return { html, manifest, pin };
}

export async function preparedStoryHTML(directory, { silent = false } = {}) {
  const prepared = await preparedStoryTemplate(directory);
  if (!prepared) return null;
  const { manifest, pin } = prepared;
  const document = JSON.parse(await readFile(join(directory, 'story.json'), 'utf8'));
  let html = withStoryDocument(prepared.html, document);
  const voice = await readFile(join(directory, 'voice.json'), 'utf8').then(JSON.parse, (error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (
    voice?.enabled &&
    (await access(join(directory, 'audio.wav')).then(
      () => true,
      () => false,
    ))
  ) {
    html = setNarrationMode(html, false);
    if (silent) html = setNarrationMode(html, true);
  }
  return { html, manifest, pin };
}
