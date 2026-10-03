import { build } from 'esbuild';
import { readdir, readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceAliases } from './source-package.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
export async function buildPage(source, target, { sourcePackage = false } = {}) {
  let html = await readFile(source, 'utf8');
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  let code = scripts
    .map(([, attrs, body]) => {
      const src = /\bsrc="([^"]+)"/.exec(attrs)?.[1];
      return src ? `import ${JSON.stringify(resolve(dirname(source), src))};` : body;
    })
    .join('\n');
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  const name = source
    .split('/')
    .pop()
    .replace(/\.html$/, '.js');
  const out = resolve(target, name);
  await mkdir(target, { recursive: true });
  if (code.trim()) {
    const result = await build({
      stdin: {
        contents: code,
        resolveDir: dirname(source),
        loader: 'js',
        sourcefile: 'page-entry.js',
      },
      outfile: out,
      bundle: true,
      format: 'iife',
      target: 'es2022',
      ...(sourcePackage ? { alias: sourceAliases } : {}),
      loader: { '.woff2': 'dataurl', '.wav': 'dataurl', '.m4a': 'dataurl' },
      legalComments: 'inline',
      metafile: true,
    });
    if (Object.values(result.metafile.outputs).some((output) => output.cssBundle))
      html = html.replace(
        '</head>',
        `<link rel="stylesheet" href="${name.replace(/\.js$/, '.css')}"></head>`,
      );
    html = html.replace('</body>', `<script src="${name}"></script></body>`);
  }
  await writeFile(resolve(target, source.split('/').pop()), html);
}
export async function buildPages() {
  const entries = await readdir(resolve(root, 'examples'), { withFileTypes: true });
  for (const entry of entries)
    if (entry.isDirectory()) {
      const dir = resolve(root, 'examples', entry.name),
        dest = resolve(root, 'site', entry.name);
      const files = await readdir(dir);
      if (!files.some((x) => x.endsWith('.html')) && !files.some((x) => x.endsWith('.svg')))
        continue;
      await mkdir(dest, { recursive: true });
      for (const name of files) {
        if (name.endsWith('.html'))
          await buildPage(resolve(dir, name), dest, { sourcePackage: true });
        else if (
          ['.svg', '.png', '.wav', '.m4a', '.json', '.css', '.glb', '.txt'].includes(extname(name))
        )
          await cp(resolve(dir, name), resolve(dest, name));
      }
    }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await buildPages();
