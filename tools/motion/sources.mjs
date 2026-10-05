import { readFile, realpath } from 'node:fs/promises';
import { resolve, isAbsolute, normalize, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { sourceHash } from '../build-sources.mjs';

/** Resolve only declared owners and assets actually requested by the scene. */
export async function sourceReferences(root, page) {
  root = await realpath(resolve(root));
  const cache = new Map();
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
  const inputs = [];
  for (const url of new Set(urls)) {
    const path = resolve(root, '.' + decodeURIComponent(new URL(url).pathname));
    if (path !== root && !path.startsWith(root + sep)) continue;
    try {
      const asset = {
        file: await realpath(path),
        hash: sourceHash(await readFile(path)),
      };
      assets.push(asset);
      let receipt;
      try {
        receipt = JSON.parse(await readFile(path + '.sources.json', 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      }
      if (receipt?.version === 1 && receipt.bundle === asset.hash && Array.isArray(receipt.inputs))
        inputs.push(...receipt.inputs);
    } catch (e) {
      if (!['ENOENT', 'EISDIR'].includes(e.code)) throw e;
    }
  }
  const owner = async (reference) => {
    if (reference && typeof reference === 'object') reference = reference.file;
    if (!reference || typeof reference !== 'string') return undefined;
    reference = normalize(reference);
    if (isAbsolute(reference)) {
      try {
        reference = await realpath(reference);
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
        return undefined;
      }
    }
    if (!cache.has(reference)) {
      const candidates = [
        ...inputs.filter(
          (input) =>
            input &&
            ((Array.isArray(input.references) &&
              input.references.some(
                (name) => typeof name === 'string' && normalize(name) === reference,
              )) ||
              input.file === reference),
        ),
        ...assets.filter((asset) => asset.file === resolve(root, reference)),
      ];
      const matching = [];
      for (const input of candidates) {
        if (
          typeof input.file !== 'string' ||
          !isAbsolute(input.file) ||
          typeof input.hash !== 'string'
        )
          continue;
        try {
          const file = await realpath(input.file);
          if (sourceHash(await readFile(file)) === input.hash) matching.push(file);
        } catch (error) {
          if (!['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code)) throw error;
        }
      }
      const unique = [...new Set(matching)];
      cache.set(reference, unique.length === 1 ? unique[0] : undefined);
    }
    return cache.get(reference);
  };
  return {
    owner,
    assets,
    fingerprint: createHash('sha256').update(JSON.stringify(assets)).digest('hex'),
  };
}
