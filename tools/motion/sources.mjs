import { readFile, stat, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const library = fileURLToPath(new URL('../../', import.meta.url));

/** Resolve only declared owners and assets actually requested by the scene. */
export async function sourceReferences(root, page) {
  const cache = new Map();
  const owner = async (reference) => {
    if (!reference || typeof reference !== 'string') return undefined;
    if (!cache.has(reference)) {
      let file;
      for (const base of [root, library]) {
        try {
          const path = await realpath(resolve(base, reference));
          if ((await stat(path)).isFile()) {
            file = path;
            break;
          }
        } catch (e) {
          if (!['ENOENT', 'ENOTDIR'].includes(e.code)) throw e;
        }
      }
      cache.set(reference, file);
    }
    return cache.get(reference);
  };
  const urls = await page.evaluate(() =>
    [location.href, ...performance.getEntriesByType('resource').map((e) => e.name)].filter((u) => {
      const url = new URL(u, location.href);
      return (
        url.origin === location.origin &&
        (/\.(?:html?|m?js|css)$/.test(url.pathname) || u === location.href)
      );
    }),
  );
  const assets = [];
  for (const url of new Set(urls)) {
    const path = resolve(root, '.' + decodeURIComponent(new URL(url).pathname));
    if (path !== root && !path.startsWith(root + '/')) continue;
    try {
      assets.push({
        file: await realpath(path),
        hash: createHash('sha256')
          .update(await readFile(path))
          .digest('hex'),
      });
    } catch (e) {
      if (!['ENOENT', 'EISDIR'].includes(e.code)) throw e;
    }
  }
  return {
    owner,
    assets,
    fingerprint: createHash('sha256').update(JSON.stringify(assets)).digest('hex'),
  };
}
