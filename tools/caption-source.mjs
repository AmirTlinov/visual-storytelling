import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { renderer } from './render.mjs';

/** A mounted story owns its captions. Audio-only folders retain their authored timeline route. */
export async function captionSource(directory, { signal } = {}) {
  signal?.throwIfAborted();
  if (
    await access(join(directory, 'index.html')).then(
      () => true,
      () => false,
    )
  ) {
    const capture = await renderer({ directory, controls: true, signal });
    try {
      const script = await capture.capture.evaluate((scene) => scene.review());
      if (!script.segments?.length) throw new Error('The mounted scene has no caption segments');
      return script;
    } finally {
      await capture.close();
    }
  }
  try {
    return JSON.parse(await readFile(join(directory, 'timeline.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT')
      throw new Error(
        'This scene exposes no caption script. Attach its Story to SceneShell, or provide timeline.json for an audio-only export.',
      );
    throw error;
  }
}
