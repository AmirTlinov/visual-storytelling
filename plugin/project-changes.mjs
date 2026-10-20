import {
  readFile,
  writeFile,
  mkdir,
  rename,
  rm,
  realpath,
  stat,
  copyFile,
  link,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectFile, digest } from '../tools/project-files.mjs';

export const readOptional = (file) =>
  readFile(file).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
export const matches = (bytes, text) =>
  text === null ? bytes === null : bytes !== null && bytes.equals(Buffer.from(text));
export const conflict = (name) =>
  new Error(`Interrupted edit conflicts with ${name}. Resolve it using .vstory/transaction.json.`);
export async function copyImmutableAsset(source, target, hash) {
  const existing = await readOptional(target);
  if (existing) {
    if (digest(existing) !== hash) throw new Error('Runtime archive integrity changed.');
    return;
  }
  if (digest(await readFile(source)) !== hash)
    throw new Error('Runtime archive integrity changed.');
  await mkdir(dirname(target), { recursive: true });
  const temporary = join(dirname(target), '.vstory-asset-' + randomUUID());
  try {
    await copyFile(source, temporary, constants.COPYFILE_EXCL);
    if (digest(await readFile(temporary)) !== hash)
      throw new Error('Runtime archive integrity changed.');
    try {
      await link(temporary, target);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    if (digest(await readFile(target)) !== hash)
      throw new Error('Runtime archive integrity changed.');
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Validate the same bounded UTF-8 authoring changes for a working edit or migration candidate. */
export async function prepareProjectChanges(root, changes) {
  if (
    !changes?.length ||
    changes.length > 64 ||
    new Set(changes.map((c) => c.path)).size !== changes.length
  )
    throw new Error('Supply 1–64 distinct authored files.');
  const edits = [];
  for (const change of changes) {
    const file = await projectFile(root, change.path, { writable: true });
    const bytes = await readOptional(file);
    if (
      bytes &&
      (bytes.length > 1_000_000 ||
        bytes.includes(0) ||
        !Buffer.from(bytes.toString('utf8')).equals(bytes))
    )
      throw new Error(`Use ordinary file tools for binary or large source files: ${change.path}`);
    const before = bytes?.toString('utf8') ?? null;
    if (typeof change.content !== 'string' && change.content !== null)
      throw new Error('File content must be text or null for deletion.');
    if (
      change.content !== null &&
      (Buffer.byteLength(change.content) > 1_000_000 || change.content.includes('\0'))
    )
      throw new Error('Use ordinary file tools for binary content or changes over 1 MB.');
    if (before !== change.content) edits.push({ path: change.path, before, after: change.content });
  }
  return edits;
}

/** Apply a verified file transition without replacing a concurrent edit. */
export async function writeProjectChange(root, entry) {
  const file = await projectFile(root, entry.path, { writable: true });
  const check = async () => {
    await projectFile(root, entry.path, { writable: true });
    const current = await readOptional(file);
    if (matches(current, entry.after)) return false;
    if (!matches(current, entry.before)) throw conflict(entry.path);
    return true;
  };
  if (!(await check())) return;
  if (entry.after === null) {
    await rm(file, { force: true });
    return;
  }
  await mkdir(dirname(file), { recursive: true });
  const mode = await stat(file).then(
    (info) => info.mode,
    (error) => {
      if (error.code === 'ENOENT') return 0o644;
      throw error;
    },
  );
  const temporary = join(dirname(file), '.vstory-edit-' + randomUUID());
  try {
    await writeFile(temporary, entry.after, { flag: 'wx', mode });
    if (await check()) await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}
