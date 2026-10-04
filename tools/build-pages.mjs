import { build } from 'esbuild';
import { readdir, readFile, writeFile, mkdir, cp, access } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse } from 'parse5';
import { sourceAliases } from './source-package.mjs';
import { sceneAsset } from './assets.mjs';
import { generateScene } from './generate-scene.mjs';
import { buildOutput } from './build-output.mjs';
import { assetURLs } from './asset-urls.mjs';
import { setNarrationMode } from './narration.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));

async function checkNarration(html, directory) {
  const audioFiles = new Set();
  const local = (url, base = directory) => {
    if (typeof url !== 'string') return;
    url = url.trim();
    if (!url || /^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(url)) return;
    const path = decodeURIComponent(url.split(/[?#]/)[0]);
    return path.startsWith('/') ? resolve(directory, '.' + path) : resolve(base, path);
  };
  function visit(node) {
    if (node.tagName === 'audio') {
      const attrs = Object.fromEntries(node.attrs.map(({ name, value }) => [name, value]));
      if (attrs['data-silent'] === 'true') return;
      const urls =
        attrs.src || attrs['data-src']
          ? [attrs.src || attrs['data-src']]
          : (node.childNodes ?? [])
              .filter((child) => child.tagName === 'source')
              .map((child) => child.attrs.find(({ name }) => name === 'src')?.value);
      for (const url of urls) {
        const path = local(url);
        if (path) audioFiles.add(path);
      }
    }
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(parse(html));
  if (!audioFiles.size) return;
  const script = resolve(directory, 'narration.json');
  try {
    await access(script);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const audio of audioFiles) {
    // Aligned cues live with their generated audio; an old template may remain at the root.
    for (const folder of new Set([dirname(audio), directory])) {
      const timeline = resolve(folder, 'timeline.json');
      let receipt;
      try {
        receipt = JSON.parse(await readFile(timeline, 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      if (!receipt.source_sha256 || local(receipt.audio, folder) !== audio) continue;
      try {
        await promisify(execFile)(
          'python3',
          [resolve(root, 'tools/audio/cli.py'), 'check', script, '--timeline', timeline],
          { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } },
        );
      } catch (error) {
        if (error.code === 'ENOENT')
          throw new Error('Checking generated narration requires python3 (standard library only).');
        throw new Error(`${timeline}: ${error.stderr?.trim() || error.message}`);
      }
      break;
    }
  }
}

export async function buildPage(
  source,
  target,
  { sourcePackage = false, tsconfig, cdn = false, html: suppliedHTML, silent = false } = {},
) {
  let html = suppliedHTML ?? (await readFile(source, 'utf8'));
  if (silent) html = setNarrationMode(html, true);
  await checkNarration(html, dirname(source));
  const attribute = (attrs, name) =>
    new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(attrs)?.[2];
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  const scripts = [...html.matchAll(scriptPattern)].filter(([, attrs]) =>
    ['', 'module', 'text/javascript', 'application/javascript'].includes(
      attribute(attrs, 'type') ?? '',
    ),
  );
  const code = scripts
    .map(([, attrs, body]) => {
      const src = attribute(attrs, 'src');
      return src ? `import ${JSON.stringify(resolve(dirname(source), src))};` : body;
    })
    .join('\n');
  const bundled = new Set(scripts.map(([markup]) => markup));
  html = html.replace(scriptPattern, (markup) => (bundled.has(markup) ? '' : markup));
  const name = basename(source).replace(/\.html$/, '.js');
  const out = resolve(target, name);
  await mkdir(target, { recursive: true });
  if (code.trim()) {
    const dependencies = cdn
      ? JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).dependencies
      : undefined;
    const result = await build({
      stdin: {
        contents: code,
        resolveDir: dirname(source),
        loader: 'js',
        sourcefile: 'page-entry.js',
      },
      outfile: out,
      bundle: true,
      format: cdn ? 'esm' : 'iife',
      // Bundled assets share the page's base; IIFEs have no native import.meta.
      ...(cdn ? {} : { define: { 'import.meta.url': 'document.baseURI' } }),
      target: 'es2022',
      ...(tsconfig ? { tsconfig } : { tsconfigRaw: { compilerOptions: {} } }),
      ...(sourcePackage ? { alias: sourceAliases } : {}),
      plugins: [
        assetURLs(),
        ...(cdn
          ? [
              {
                name: 'rapier-cdn',
                setup(build) {
                  build.onResolve({ filter: /^@dimforge\/rapier[23]d-compat$/ }, ({ path }) => ({
                    path: `https://cdn.jsdelivr.net/npm/${path}@${dependencies[path]}/dist/rapier.mjs`,
                    external: true,
                  }));
                },
              },
            ]
          : []),
      ],
      loader: Object.fromEntries(
        [
          '.woff2',
          '.woff',
          '.ttf',
          '.wav',
          '.m4a',
          '.mp3',
          '.png',
          '.jpg',
          '.jpeg',
          '.webp',
          '.gif',
          '.avif',
          '.glb',
        ].map((extension) => [extension, 'dataurl']),
      ),
      legalComments: 'inline',
      metafile: true,
    });
    if (Object.values(result.metafile.outputs).some((output) => output.cssBundle))
      html = html.replace(
        '</head>',
        `<link rel="stylesheet" href="${name.replace(/\.js$/, '.css')}"></head>`,
      );
    html = html.replace(
      '</body>',
      `<script${cdn ? ' type="module"' : ''} src="${name}"></script></body>`,
    );
  }
  await writeFile(resolve(target, basename(source)), html);
}

/** Both the gallery and copied projects build the same source tree. */
export async function buildScene(source, target, options = {}) {
  source = resolve(source);
  target = resolve(target);
  // A copied scene owns its imports. Never inherit unrelated ancestor workspace aliases.
  const tsconfig = resolve(source, 'tsconfig.json');
  options = {
    ...options,
    tsconfig: await access(tsconfig).then(
      () => tsconfig,
      () => undefined,
    ),
  };
  const ignored = new Set([
    'node_modules',
    '__pycache__',
    'dist',
    'site',
    'artifacts',
    'review',
    'package.json',
    'package-lock.json',
    'scene.json',
  ]);
  async function visit(directory, output) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const from = resolve(directory, entry.name),
        to = resolve(output, entry.name);
      if (
        entry.name.startsWith('.') ||
        ignored.has(entry.name) ||
        from === target ||
        options.exclude?.some((path) => resolve(path) === from)
      )
        continue;
      if (entry.isDirectory()) await visit(from, to);
      else if (entry.isFile() && sceneAsset(entry.name)) {
        await mkdir(output, { recursive: true });
        await cp(from, to);
      }
    }
    for (const entry of entries)
      if (entry.isFile() && entry.name.endsWith('.html'))
        await buildPage(resolve(directory, entry.name), output, options);
    await generateScene(directory, output);
  }
  await buildOutput(source, target, (output) => visit(source, output));
}

export async function buildPages(target = resolve(root, 'site')) {
  const catalog = JSON.parse(await readFile(resolve(root, 'examples/catalog.json'), 'utf8'));
  for (const name of Object.keys(catalog))
    await buildScene(resolve(root, 'examples', name), resolve(target, name), {
      sourcePackage: true,
    });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await buildPages();
