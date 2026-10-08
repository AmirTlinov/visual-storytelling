import { acquireDirectoryLock } from '../file-lock.mjs';

/** CLI and MCP wait only for preparation of the same resource. */
export async function withPreparationLock(lock, { signal, progress }, prepare) {
  const release = await acquireDirectoryLock(lock, {
    signal,
    onWait: () => progress('Ожидаю завершения общей подготовки ресурса…'),
  });
  try {
    signal.throwIfAborted();
    return await prepare();
  } finally {
    await release();
  }
}
