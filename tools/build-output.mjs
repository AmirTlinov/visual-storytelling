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
  const transaction = await mkdtemp(join(dirname(output), '.visual-story-build-'));
  const staging = join(transaction, 'next'),
    previous = join(transaction, 'previous');
  let preservePrevious = false;
  try {
    await mkdir(staging);
    await build(staging);
    let replaced = false;
    try {
      await rename(output, previous);
      replaced = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      await rename(staging, output);
    } catch (error) {
      if (replaced) {
        try {
          await rename(previous, output);
        } catch (restoreError) {
          preservePrevious = true;
          throw new AggregateError(
            [error, restoreError],
            `Build publication and rollback failed; the previous delivery remains at ${previous}`,
          );
        }
      }
      throw error;
    }
  } finally {
    if (!preservePrevious) await rm(transaction, { recursive: true, force: true });
  }
}
