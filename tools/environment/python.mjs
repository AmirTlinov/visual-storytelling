import { withPreparationLock } from './lock.mjs';
import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

export const pythonVersion = '3.12.13';

/** Generators and voice share the managed interpreter and package cache. */
export function pythonEnvironment(data) {
  return {
    UV_PYTHON_INSTALL_DIR: join(data, 'environment', 'python'),
    UV_CACHE_DIR: join(data, 'environment', 'uv-cache'),
    PYTHONDONTWRITEBYTECODE: '1',
  };
}

export async function managedPython(data, executable) {
  const [directory, python] = await Promise.all([
    realpath(pythonEnvironment(data).UV_PYTHON_INSTALL_DIR),
    realpath(executable),
  ]);
  if (!python.startsWith(directory + '/'))
    throw new Error('Prepared Python must belong to the managed environment.');
  return python;
}

/** Install only Python. Inline generator dependencies stay with the generator. */
export async function preparePythonEnvironment(data, uv, { signal, progress }) {
  return withPreparationLock(
    join(data, 'environment', `python-${pythonVersion}.lock`),
    { signal, progress },
    async () => {
      signal.throwIfAborted();
      const env = { ...process.env, ...pythonEnvironment(data) };
      const execute = promisify(execFile);
      progress('Подготавливаю Python…');
      await execute(uv, ['python', 'install', '--no-bin', pythonVersion], { env, signal });
      const { stdout } = await execute(uv, ['python', 'find', '--managed-python', pythonVersion], {
        env,
        signal,
      });
      return managedPython(data, stdout.trim());
    },
  );
}
