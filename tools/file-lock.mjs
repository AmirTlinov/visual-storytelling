import {
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
  lstat,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

async function removeEmpty(directory) {
  await rmdir(directory).catch((error) => {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
  });
}

/** Publish a complete owner atomically; stale contenders cannot delete a successor. */
export async function acquireDirectoryLock(
  lock,
  { signal = new AbortController().signal, onWait } = {},
) {
  signal.throwIfAborted();
  await mkdir(dirname(lock), { recursive: true, mode: 0o700 });
  const candidate = await mkdtemp(lock + '.candidate-');
  const owner = `${process.pid}-${randomUUID()}`;
  let acquired = false,
    waiting = false;
  try {
    await writeFile(join(candidate, owner), '', { flag: 'wx', mode: 0o600 });
    while (!acquired) {
      signal.throwIfAborted();
      try {
        // The owner is present before publication. A live lock is always nonempty.
        await rename(candidate, lock);
        acquired = true;
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
        const info = await lstat(lock).catch((error) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (info && (!info.isDirectory() || (process.getuid && info.uid !== process.getuid())))
          throw new Error('Directory lock has an unexpected owner or type.');
        const owners = await readdir(lock).catch((error) => {
          if (error.code === 'ENOENT') return [];
          throw error;
        });
        for (const name of owners) {
          const match = /^(\d+)-[\da-f-]{36}$/.exec(name);
          if (!match) throw new Error('Directory lock has an unknown owner.');
          try {
            process.kill(Number(match[1]), 0);
          } catch (error) {
            if (error.code === 'ESRCH')
              await unlink(join(lock, name)).catch((error) => {
                if (error.code !== 'ENOENT') throw error;
              });
            else if (error.code !== 'EPERM') throw error;
          }
        }
        // A stale contender can only remove the owner it saw, never a successor.
        await removeEmpty(lock);
        if (!waiting) {
          onWait?.();
          waiting = true;
        }
        await delay(100, undefined, { signal });
      }
    }
    signal.throwIfAborted();
    return async () => {
      await unlink(join(lock, owner)).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
      await removeEmpty(lock);
    };
  } catch (error) {
    if (acquired) {
      await unlink(join(lock, owner)).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
      await removeEmpty(lock);
    }
    throw error;
  } finally {
    await rm(candidate, { recursive: true, force: true });
  }
}
