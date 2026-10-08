import { readFile, writeFile, mkdir, readdir, access } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinSceneProject } from './scene-project.mjs';
import { sceneInput } from './assets.mjs';
import { buildNarration, setNarrationMode, silenceSceneCopy } from './narration.mjs';
import { buildOutput } from './build-output.mjs';
import { sceneEntry } from './scene-entry.mjs';
import { copySceneInput } from './copy-scene-input.mjs';

/** CLI and plugin create the same editable project with an immutable runtime dependency. */
export async function createScene(
  destination,
  {
    example,
    deferAudio = false,
    silent = false,
    audio = false,
    signal,
    root = fileURLToPath(new URL('../', import.meta.url)),
  } = {},
) {
  signal?.throwIfAborted();
  destination = resolve(destination);
  const catalog = JSON.parse(await readFile(join(root, 'examples/catalog.json'), 'utf8'));
  if (!example)
    throw new Error(
      'Choose a starting point with visual-story examples, then pass --example NAME.',
    );
  if ([audio, deferAudio, silent].filter(Boolean).length > 1)
    throw new Error('Choose one of --audio, --no-audio or --silent');
  if (!catalog[example]) throw new Error(`Choose an example: ${Object.keys(catalog).join(', ')}`);
  try {
    if ((await readdir(destination)).some((name) => name !== 'story.vstory'))
      throw new Error('Choose an empty output directory');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(destination, { recursive: true });
  const source = join(root, 'examples', example);
  const target = destination;
  const manifest = await readFile(join(target, 'story.vstory')).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  await buildOutput(source, target, async (destination) => {
    if (manifest) await writeFile(join(destination, 'story.vstory'), manifest);
    for (const name of await readdir(source)) {
      if (
        (name.startsWith('preview') && name.endsWith('.png')) ||
        !sceneInput(name) ||
        ['voice.wav', 'music.wav'].includes(name) ||
        ((deferAudio || silent) && name === 'audio.wav')
      )
        continue;
      await copySceneInput(join(source, name), join(destination, name), {
        filter: (path) => sceneInput(relative(source, path)),
        signal,
      });
    }
    if (silent) await silenceSceneCopy(destination);
    await pinSceneProject(destination, { root, signal });
    const hasAudio = await access(join(destination, 'audio.wav')).then(
      () => true,
      () => false,
    );
    if (deferAudio || (!audio && !hasAudio))
      for (const name of await readdir(destination))
        if (name.endsWith('.html')) {
          const file = join(destination, name);
          await writeFile(file, setNarrationMode(await readFile(file, 'utf8'), true));
        }
    if (audio) await buildNarration(destination, { signal });
    signal?.throwIfAborted();
    if ((await readdir(target)).some((name) => name !== 'story.vstory'))
      throw new Error(
        'The project directory changed while preparing it. Choose another directory.',
      );
    const current = await readFile(join(target, 'story.vstory')).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (Boolean(current) !== Boolean(manifest) || (current && !current.equals(manifest)))
      throw new Error('The project manifest changed while preparing it. Open it again.');
  });
  return {
    directory: target,
    example,
    title: catalog[example].title,
    entry: (await sceneEntry(target)).source,
  };
}
