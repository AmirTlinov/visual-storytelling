import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolvePackage } from './build-info.mjs';

/** Project-owned story.json is the source; this generated speech projection is disposable. */
export async function narrationSource(directory) {
  let document;
  try {
    document = JSON.parse(await readFile(join(directory, 'story.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (document) {
    const runtime = await resolvePackage('@visual-storytelling/core', directory);
    const projection = runtime
      ? pathToFileURL(join(runtime, 'dist/story/document.js'))
      : new URL('../dist/story/document.js', import.meta.url);
    const { documentNarration } = await import(projection.href);
    const spec = documentNarration(document);
    const text = JSON.stringify(spec, null, 2) + '\n';
    const file = join(
      tmpdir(),
      'visual-story-narration',
      createHash('sha256').update(resolve(directory)).update(text).digest('hex'),
      'narration.json',
    );
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
    return { file, directory: resolve(directory) };
  }
  const file = join(directory, 'narration.json');
  try {
    await readFile(file);
    return { file, directory: resolve(directory) };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
