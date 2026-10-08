import { chmod, copyFile, lstat, mkdir, readdir, readlink, symlink } from 'node:fs/promises';
import { join } from 'node:path';

/** An owned authoring or build copy is writable even when its packaged source is immutable. */
export async function copySceneInput(source, destination, { filter, signal } = {}) {
  signal?.throwIfAborted();
  if (filter && !(await filter(source, destination))) return;
  const entry = await lstat(source);
  if (entry.isSymbolicLink()) {
    // Preserve the link itself; never chmod its target in a protected runtime.
    await symlink(await readlink(source), destination);
  } else if (entry.isDirectory()) {
    const mode = (entry.mode & 0o777) | 0o700;
    await mkdir(destination, { mode });
    await chmod(destination, mode);
    for (const name of await readdir(source))
      await copySceneInput(join(source, name), join(destination, name), { filter, signal });
  } else if (entry.isFile()) {
    await copyFile(source, destination);
    await chmod(destination, (entry.mode & 0o777) | 0o600);
  } else throw new Error(`A scene input must be a file, directory or symbolic link: ${source}`);
}
