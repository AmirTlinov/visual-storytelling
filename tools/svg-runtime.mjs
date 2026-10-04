import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { assetURLs } from './asset-urls.mjs';

/** Embed maintained package APIs into a standalone SVG without local copies of their code. */
export async function svgRuntime(modules) {
  const names = Object.values(modules).flat();
  const contents =
    Object.entries(modules)
      .map(
        ([module, exports]) =>
          `import {${exports.join(',')}} from ${JSON.stringify('@visual-storytelling/core' + module)};`,
      )
      .join('\n') + `\nglobalThis.VisualStory = {${names.join(',')}};`;
  const result = await build({
    stdin: { contents, resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
    bundle: true,
    format: 'iife',
    minify: true,
    write: false,
    target: 'es2022',
    plugins: [assetURLs()],
    define: { 'import.meta.url': 'document.baseURI' },
    loader: { '.woff2': 'dataurl' },
    legalComments: 'inline',
  });
  return result.outputFiles[0].text;
}
