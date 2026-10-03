import { mkdir, mkdtemp, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

async function canonical(path) {
  try {
    return await realpath(path);
  } catch (error) {
    const parent = dirname(path);
    if (error.code !== 'ENOENT' || parent === path) throw error;
    return join(await canonical(parent), basename(path));
  }
}

/** Keep the last delivery until its complete replacement is ready. */
export async function buildOutput(source, output, build) {
  output = resolve(output);
  const [destination, sources] = await Promise.all([canonical(output), canonical(resolve(source))]);
  const inside = relative(destination, sources);
  if (!inside || (!isAbsolute(inside) && inside.split(sep)[0] !== '..'))
    throw new Error('The build output must not contain scene sources');
  await mkdir(dirname(output), { recursive: true });
  const staging = await mkdtemp(join(dirname(output), '.visual-story-build-'));
  try {
    await build(staging);
    await rm(output, { recursive: true, force: true });
    await rename(staging, output);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
