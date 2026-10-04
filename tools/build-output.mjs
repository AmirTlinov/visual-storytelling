import { lstat, mkdir, mkdtemp, readdir, realpath, rename, rm } from 'node:fs/promises';
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
export async function buildOutput(source, output, build, { ownedFiles, commitFile } = {}) {
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
    if (ownedFiles) {
      // A release may share its directory with an excerpt or an active exporter.
      // Publish only owned files; never move or delete that surrounding directory.
      const entries = await readdir(staging, { withFileTypes: true });
      const names = entries.map((entry) => entry.name);
      const owned = new Set(ownedFiles);
      if (
        entries.some((entry) => !entry.isFile()) ||
        (commitFile && !names.includes(commitFile)) ||
        [...owned].some((name) => !name || basename(name) !== name || name === '.' || name === '..')
      )
        throw new Error('A file delivery must contain only named files');
      for (const name of new Set([...owned, ...names])) {
        const entry = await lstat(join(output, name)).catch((error) => {
          if (error.code === 'ENOENT') return false;
          throw error;
        });
        if (entry && (!owned.has(name) || !entry.isFile()))
          throw new Error(
            `Delivery does not own ${join(output, name)}; choose a new output directory`,
          );
      }
      await mkdir(output, { recursive: true });
      await mkdir(previous);
      const replaced = [],
        published = [];
      try {
        for (const name of new Set([...owned, ...names])) {
          try {
            await rename(join(output, name), join(previous, name));
            replaced.push(name);
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
        }
        for (const name of names.sort(
          (a, b) => Number(a === commitFile) - Number(b === commitFile),
        )) {
          await rename(join(staging, name), join(output, name));
          published.push(name);
        }
      } catch (error) {
        try {
          for (const name of published) await rm(join(output, name));
          for (const name of replaced) await rename(join(previous, name), join(output, name));
        } catch (restoreError) {
          preservePrevious = true;
          throw new AggregateError(
            [error, restoreError],
            `Delivery publication and rollback failed; the previous files remain at ${previous}`,
          );
        }
        throw error;
      }
      return;
    }
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
