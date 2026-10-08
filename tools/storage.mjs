import { mkdir, readFile, open, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';

export const dataDirectory = () =>
  process.env.VISUAL_STORY_DATA_DIR ??
  join(homedir(), 'Library/Application Support/Visual Storytelling');

export async function readJSON(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** Publish one complete private snapshot; a failed write leaves the previous value intact. */
export async function writeJSON(file, value) {
  const contents = JSON.stringify(value);
  if (contents === undefined) throw new TypeError('A snapshot must be JSON serializable.');
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.' + randomUUID();
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(contents);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}
