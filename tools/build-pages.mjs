import { build } from 'esbuild';
import { readdir, readFile, writeFile, mkdir, cp, access } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
import { sourceAliases } from './source-package.mjs';
import { sceneAsset, sceneInput } from './assets.mjs';
import { generateScene } from './generate-scene.mjs';
import { buildOutput } from './build-output.mjs';
import { assetURLs, moduleAssetURLs } from './asset-urls.mjs';
import { checkNarration, setNarrationMode, playbackTimeline } from './narration.mjs';
import { resolvePackage } from './build-info.mjs';
import { readCatalog } from './catalog.mjs';
import { writeBundleNotices } from './bundle-notices.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));

export async function buildPage(
  source,
  target,
  { sourcePackage = false, tsconfig, cdn = false, html: suppliedHTML, silent = false } = {},
) {
  let html = suppliedHTML ?? (await readFile(source, 'utf8'));
  if (silent) html = setNarrationMode(html, true);
  await checkNarration(html, dirname(source));
  const document = parse(html, { sourceCodeLocationInfo: true });
  const scripts = [],
    edits = [];
  let head, body;
  const visit = (node) => {
    if (node.tagName === 'head') head = node;
    if (node.tagName === 'body') body = node;
    if (node.tagName === 'script') {
      const attrs = Object.fromEntries(node.attrs.map(({ name, value }) => [name, value]));
      if (
        ['', 'module', 'text/javascript', 'application/javascript'].includes(
          (attrs.type ?? '').trim().toLowerCase(),
        )
      )
        scripts.push({ attrs, location: node.sourceCodeLocation });
    }
    // Template contents are inert until the scene inserts them into the document.
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(document);
  const code = scripts
    .map(({ attrs, location }) => {
      const src = attrs.src;
      if (src && /^(?:[a-z][\w+.-]*:|\/\/)/i.test(src))
        throw new Error(`Import a local script before building: ${src}`);
      return src
        ? `import ${JSON.stringify(resolve(dirname(source), decodeURIComponent(src.split(/[?#]/)[0])))};`
        : html.slice(
            location.startTag.endOffset,
            location.endTag?.startOffset ?? location.endOffset,
          );
    })
    .join('\n');
  for (const { location } of scripts)
    edits.push({ start: location.startOffset, end: location.endOffset, value: '' });
  const name = basename(source).replace(/\.html$/, '.js');
  const out = resolve(target, name);
  await mkdir(target, { recursive: true });
  if (code.trim()) {
    const assets = new Set();
    const result = await build({
      stdin: {
        contents: await moduleAssetURLs(code, source),
        resolveDir: dirname(source),
        loader: 'js',
        sourcefile: 'page-entry.js',
      },
      outfile: out,
      bundle: true,
      format: cdn ? 'esm' : 'iife',
      // Asset URLs were resolved against each module above; IIFEs use the page for other metadata.
      ...(cdn ? {} : { define: { 'import.meta.url': 'document.baseURI' } }),
      target: 'es2022',
      ...(tsconfig ? { tsconfig } : { tsconfigRaw: { compilerOptions: {} } }),
      ...(sourcePackage ? { alias: sourceAliases } : {}),
      plugins: [
        assetURLs({ onAsset: (file) => assets.add(file) }),
        ...(cdn
          ? [
              {
                name: 'rapier-cdn',
                setup(build) {
                  build.onResolve(
                    { filter: /^@dimforge\/rapier[23]d-compat$/ },
                    async ({ path, importer }) => {
                      const installed = await resolvePackage(path, dirname(importer || source));
                      if (!installed)
                        throw new Error(`Install the scene dependency before building: ${path}`);
                      const { version } = JSON.parse(
                        await readFile(resolve(installed, 'package.json'), 'utf8'),
                      );
                      return {
                        path: `https://cdn.jsdelivr.net/npm/${path}@${version}/dist/rapier.mjs`,
                        external: true,
                      };
                    },
                  );
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
    await writeBundleNotices(out, result.metafile, { assets });
    if (Object.values(result.metafile.outputs).some((output) => output.cssBundle)) {
      const at =
        head?.sourceCodeLocation?.endTag?.startOffset ?? body?.sourceCodeLocation?.startOffset ?? 0;
      edits.push({
        start: at,
        end: at,
        value: `<link rel="stylesheet" href="${name.replace(/\.js$/, '.css')}">`,
      });
    }
    const at = body?.sourceCodeLocation?.endTag?.startOffset ?? html.length;
    edits.push({
      start: at,
      end: at,
      value: `<script${cdn ? ' type="module"' : ''} src="${name}"></script>`,
    });
  }
  for (const edit of edits.sort((a, b) => b.start - a.start))
    html = html.slice(0, edit.start) + edit.value + html.slice(edit.end);
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
  const configuration = new Set(['package.json', 'package-lock.json', 'scene.json']);
  async function visit(directory, output) {
    options.signal?.throwIfAborted();
    const entries = (await readdir(directory, { withFileTypes: true })).filter((entry) => {
      const from = resolve(directory, entry.name);
      return (
        sceneInput(entry.name) &&
        !configuration.has(entry.name) &&
        from !== target &&
        !options.exclude?.some((path) => resolve(path) === from)
      );
    });
    for (const entry of entries) {
      const from = resolve(directory, entry.name),
        to = resolve(output, entry.name);
      if (entry.isDirectory()) await visit(from, to);
      else if (entry.isFile() && sceneAsset(entry.name)) {
        await mkdir(output, { recursive: true });
        if (entry.name === 'timeline.json')
          await writeFile(
            to,
            JSON.stringify(playbackTimeline(JSON.parse(await readFile(from, 'utf8')))) + '\n',
          );
        else await cp(from, to);
      }
    }
    for (const entry of entries)
      if (entry.isFile() && entry.name.endsWith('.html'))
        await buildPage(resolve(directory, entry.name), output, options);
    await generateScene(directory, output, options);
  }
  await buildOutput(source, target, (output) => visit(source, output));
}

export async function buildPages(target = resolve(root, 'site'), catalog) {
  catalog ??= await readCatalog();
  for (const name of Object.keys(catalog))
    await buildScene(resolve(root, 'examples', name), resolve(target, name), {
      sourcePackage: true,
    });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await buildPages();
