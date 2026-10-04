import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { join } from 'node:path';

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
