import { fileURLToPath } from 'node:url';
import manifest from '../package.json' with { type: 'json' };

/** Development and example builds resolve the same public entry points as the package. */
export const sourceAliases = Object.fromEntries(
  Object.entries(manifest.exports)
    .map(([subpath, entry]) => [
      manifest.name + (subpath === '.' ? '' : subpath.slice(1)),
      fileURLToPath(
        new URL(
          '../' +
            (typeof entry === 'string' ? entry : entry.import)
              .replace('./dist/', 'src/')
              .replace(/\.js$/, '.ts'),
          import.meta.url,
        ),
      ),
    ])
    .sort(([a], [b]) => b.length - a.length),
);
