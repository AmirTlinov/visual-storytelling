import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from '@babel/parser';
import { inlineResources } from './inline-resources.mjs';

const literal = (node) =>
  node?.type === 'StringLiteral'
    ? node.value
    : node?.type === 'TemplateLiteral' && !node.expressions.length
      ? node.quasis[0].value.cooked
      : undefined;
const property = (node, object, name) =>
  node?.type === 'MemberExpression' &&
  !node.computed &&
  node.object?.type === 'Identifier' &&
  node.object.name === object &&
  node.property?.name === name;
const moduleURL = (node) =>
  node?.type === 'MemberExpression' &&
  !node.computed &&
  node.object?.type === 'MetaProperty' &&
  node.object.meta.name === 'import' &&
  node.object.property.name === 'meta' &&
  node.property?.name === 'url';

/** Parse JavaScript and TypeScript without changing unrelated syntax or comments. */
export function resourceNodes(source, file = 'scene.js') {
  const ast = parse(source, {
    sourceType: 'unambiguous',
    allowAwaitOutsideFunction: true,
    plugins: [
      ...(/\.[cm]?tsx?$/.test(file) ? ['typescript'] : []),
      ...(/\.[jt]sx$/.test(file) ? ['jsx'] : []),
    ],
  });
  const nodes = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (
      (node.type === 'NewExpression' &&
        node.callee?.type === 'Identifier' &&
        node.callee.name === 'URL') ||
      ((node.type === 'ImportDeclaration' ||
        node.type === 'ExportNamedDeclaration' ||
        node.type === 'ExportAllDeclaration') &&
        node.source) ||
      (node.type === 'CallExpression' &&
        (node.callee?.type === 'Import' ||
          (node.callee?.type === 'Identifier' && node.callee.name === 'fetch')))
    )
      nodes.push(node);
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'comments', 'tokens', 'extra'].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object' && value.type) visit(value);
    }
  };
  visit(ast);
  return nodes;
}

/** Resolve the standard module-relative asset idiom before modules lose their own base URL. */
export async function moduleAssetURLs(source, file) {
  if (!source.includes('import.meta')) return source;
  const edits = [];
  for (const node of resourceNodes(source, file)) {
    if (node.type !== 'NewExpression') continue;
    if (!moduleURL(node.arguments[1])) continue;
    const value = literal(node.arguments[0]);
    if (value === undefined)
      throw new Error(
        `${file}: asset URLs relative to import.meta.url must name a static file; import the asset or use ?url`,
      );
    const url = new URL(value, pathToFileURL(file));
    if (url.protocol !== 'file:') continue;
    const path = fileURLToPath(url);
    if (!extname(path) || /\.[cm]?tsx?$/.test(path))
      throw new Error(`${file}: ${value} is not a standalone data asset; import code as a module`);
    if (/\.[cm]?jsx?$/.test(path)) {
      const asset = await readFile(path, 'utf8');
      if (
        resourceNodes(asset, path).some(
          (resource) =>
            resource.source ||
            resource.callee?.type === 'Import' ||
            (resource.type === 'NewExpression' && moduleURL(resource.arguments[1])),
        )
      )
        throw new Error(
          `${file}: ${value} still depends on other modules or module-relative resources; bundle that script before using it as an asset`,
        );
    }
    const data = await inlineResources(dirname(path)).data(
      encodeURIComponent(basename(path)) + url.hash,
    );
    edits.push({
      start: node.arguments[0].start,
      end: node.arguments[0].end,
      text: JSON.stringify(data),
    });
  }
  for (const edit of edits.sort((a, b) => b.start - a.start))
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return source;
}

/** A prebuilt script may still name page-relative resources. Close those before single-file delivery. */
export async function standaloneAssetURLs(source, resources, base) {
  if (!/\b(?:URL|fetch|import|export)\b/.test(source)) return source;
  const edits = [];
  for (const node of resourceNodes(source)) {
    if (node.source || node.callee?.type === 'Import')
      throw new Error(
        'Standalone JavaScript still imports another module. Build the scene without --cdn before packing.',
      );
    const value = literal(node.arguments[0]);
    if (value === undefined || /^(?:data:|blob:|#)/i.test(value)) continue;
    if (
      node.callee?.name !== 'fetch' &&
      !moduleURL(node.arguments[1]) &&
      !property(node.arguments[1], 'document', 'baseURI') &&
      !property(node.arguments[1], 'location', 'href')
    )
      continue;
    const data = await resources.data(value, base);
    edits.push({
      start: node.arguments[0].start,
      end: node.arguments[0].end,
      text: JSON.stringify(data),
    });
  }
  for (const edit of edits.sort((a, b) => b.start - a.start))
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return source;
}

/** Ship decoder bytes as ordinary ESM, so consumers need no special asset loader. */
export async function embedRuntimeAssets(output) {
  const file = join(output, 'viewport/gltf.js');
  await build({
    entryPoints: [file],
    outfile: file,
    allowOverwrite: true,
    bundle: true,
    format: 'esm',
    // esbuild's debug headers otherwise include the random transactional output path.
    minifyWhitespace: true,
    external: ['three/addons/loaders/*'],
    plugins: [assetURLs()],
    sourcemap: true,
  });
}

/** Vite-compatible ?url assets are embedded by the offline scene builder. */
export function assetURLs() {
  return {
    name: 'scene-asset-urls',
    setup(build) {
      build.onLoad({ filter: /\.[cm]?[jt]sx?$/, namespace: 'file' }, async (args) => {
        const source = await readFile(args.path, 'utf8');
        if (!source.includes('import.meta')) return;
        const extension = extname(args.path).slice(1);
        return {
          contents: await moduleAssetURLs(source, args.path),
          loader: extension.endsWith('ts')
            ? 'ts'
            : ['jsx', 'tsx'].includes(extension)
              ? extension
              : 'js',
        };
      });
      build.onResolve({ filter: /\?url$/ }, async (args) => {
        const resolved = await build.resolve(args.path.slice(0, -4), {
          resolveDir: args.resolveDir,
          kind: args.kind,
        });
        if (resolved.errors.length) return { errors: resolved.errors };
        return { path: resolved.path, namespace: 'scene-asset-url' };
      });
      build.onLoad({ filter: /.*/, namespace: 'scene-asset-url' }, async (args) => ({
        contents: await readFile(args.path),
        loader: 'dataurl',
      }));
    },
  };
}
