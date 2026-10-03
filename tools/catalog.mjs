import { readFile } from 'node:fs/promises';

/** Examples belong to the authoring workspace, never to the scene's runtime dependency. */
export async function readCatalog({ optional = false } = {}) {
  try {
    return JSON.parse(await readFile(new URL('../examples/catalog.json', import.meta.url), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (optional) return undefined;
    throw new Error(
      'Examples live in the visual-explainer workspace. Create scenes with its tools/scene.mjs; the installed CLI builds and serves existing scene directories.',
    );
  }
}
