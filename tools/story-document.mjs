import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

/** Project-owned story.json is the source; this generated speech projection is disposable. */
export async function narrationSource(directory) {
  let document;
  try {
    document = JSON.parse(await readFile(join(directory, 'story.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (document?.narration?.enabled === false) return;
  if (document) {
    const { documentNarration } = await import('../dist/story/document.js');
    const spec = documentNarration(document);
    if (spec.voice.reference_audio)
      spec.voice.reference_audio = resolve(directory, spec.voice.reference_audio);
    if (spec.music?.path) spec.music.path = resolve(directory, spec.music.path);
    const text = JSON.stringify(spec, null, 2) + '\n';
    const file = join(
      tmpdir(),
      'visual-story-narration',
      createHash('sha256').update(resolve(directory)).update(text).digest('hex'),
      'narration.json',
    );
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
    return file;
  }
  const file = join(directory, 'narration.json');
  try {
    await readFile(file);
    return file;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
