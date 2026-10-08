import {
  readdir,
  readFile,
  writeFile,
  mkdir,
  realpath,
  lstat,
  rm,
} from 'node:fs/promises';
import { join, dirname, relative, resolve, sep, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { sceneInput } from '../tools/assets.mjs';
import { copySceneInput } from '../tools/copy-scene-input.mjs';

const inside = (root, path) => path === root || path.startsWith(root + sep);
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The same bounded source reader serves working files and the inputs of a shown build. */
export async function readProjectFile(root, name) {
  const file = await projectFile(root, name),
    bytes = await readFile(file);
  if (
    bytes.length > 1_000_000 ||
    bytes.includes(0) ||
    !Buffer.from(bytes.toString('utf8')).equals(bytes)
  )
    throw new Error('Use the local file path for binary or large source files.');
  return { file, content: bytes.toString('utf8'), digest: digest(bytes) };
}

/** Only authored files enter snapshots. Dotfiles, generated output and dependency trees stay out. */
export async function projectFiles(root) {
  root = await realpath(root);
  const files = {};
  async function visit(directory, prefix = '', ancestors = new Set()) {
    const actual = await realpath(directory);
    if (!inside(root, actual)) throw new Error(`Project link leaves its directory: ${prefix}`);
    if (ancestors.has(actual)) throw new Error(`Circular project link: ${prefix}`);
    const next = new Set(ancestors).add(actual);
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!sceneInput(name) || name === 'story.vstory') continue;
      const path = join(directory, entry.name),
        target = await realpath(path);
      if (!inside(root, target)) throw new Error(`Project link leaves its directory: ${name}`);
      const stat = await lstat(target);
      if (stat.isDirectory()) await visit(target, name, next);
      else if (stat.isFile()) files[name] = digest(await readFile(target));
    }
  }
  await visit(root);
  return { revision: digest(JSON.stringify(files)), files };
}

/** Resolve a write without following a link outside the project or replacing its metadata. */
export async function projectFile(root, name, { writable = false } = {}) {
  if (
    typeof name !== 'string' ||
    !name ||
    isAbsolute(name) ||
    name.includes('\\') ||
    name.split('/').some((p) => !p || p === '..' || p === '.') ||
    !sceneInput(name) ||
    name === 'story.vstory'
  )
    throw new Error(`Invalid authored file: ${name}`);
  root = await realpath(root);
  const path = resolve(root, name);
  if (!inside(root, path)) throw new Error('File leaves the project');
  if (writable) {
    let part = root;
    for (const segment of name.split('/')) {
      part = join(part, segment);
      const entry = await lstat(part).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (entry?.isSymbolicLink())
        throw new Error(`Edit the original project file instead of its link: ${name}`);
    }
  }
  let parent = path;
  while (parent !== root) {
    try {
      const actual = await realpath(parent);
      if (!inside(root, actual)) throw new Error(`Project link leaves its directory: ${name}`);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      parent = dirname(parent);
    }
  }
  return path;
}

export async function snapshotProject(root, target, expected) {
  root = await realpath(root);
  target = resolve(target);
  let ancestor = target,
    actual;
  while (!actual) {
    try {
      actual = await realpath(ancestor);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      ancestor = dirname(ancestor);
    }
  }
  const location = resolve(actual, relative(ancestor, target));
  if (inside(root, location) || inside(location, root))
    throw new Error('A snapshot must be outside its working project.');
  const before = await projectFiles(root);
  // Identity is metadata rather than authored content, but portable delivery needs it.
  const readManifest = async () => {
    const path = join(root, 'story.vstory');
    const stat = await lstat(path).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (!stat) return null;
    if (!stat.isFile()) throw new Error('story.vstory must be a regular project file.');
    return readFile(path);
  };
  const manifest = await readManifest();
  if (expected && before.revision !== expected)
    throw new Error('Project changed before preparation. Inspect the working revision.');
  await mkdir(dirname(target), { recursive: true });
  // Only a directory created by this operation may be cleaned up on failure.
  await mkdir(target);
  try {
    if (manifest) await writeFile(join(target, 'story.vstory'), manifest, { flag: 'wx' });
    for (const name of Object.keys(before.files)) {
      const to = join(target, name);
      await mkdir(dirname(to), { recursive: true });
      await copySceneInput(await projectFile(root, name), to);
    }
    const [after, copied] = await Promise.all([projectFiles(root), projectFiles(target)]);
    if (after.revision !== before.revision || copied.revision !== before.revision)
      throw new Error('Project changed while capturing its inputs. Retry after edits finish.');
    const latestManifest = await readManifest();
    if (
      Boolean(manifest) !== Boolean(latestManifest) ||
      (manifest && !manifest.equals(latestManifest))
    )
      throw new Error('Project identity changed while capturing its inputs. Open it again.');
    return before;
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
}
