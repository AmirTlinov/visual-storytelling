import { readFile, writeFile, mkdir, readdir, cp, access } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinSceneProject } from './scene-project.mjs';
import { sceneInput } from './assets.mjs';
import { buildNarration, setNarrationMode, silenceSceneCopy } from './narration.mjs';

/** CLI and plugin create the same editable project with an immutable runtime dependency. */
export async function createScene(
  destination,
  {
    example = 'explorer-svg',
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
  for (const name of await readdir(source)) {
    if (
      (name.startsWith('preview') && name.endsWith('.png')) ||
      !sceneInput(name) ||
      ['voice.wav', 'music.wav'].includes(name) ||
      ((deferAudio || silent) && name === 'audio.wav')
    )
      continue;
    await cp(join(source, name), join(destination, name), {
      recursive: true,
      filter: (path) => sceneInput(relative(source, path)),
    });
  }
  if (catalog[example].page !== 'index.html') {
    const page = catalog[example].page;
    if (page.endsWith('.html')) await cp(join(destination, page), join(destination, 'index.html'));
    else
      await writeFile(
        join(destination, 'index.html'),
        `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script type="module">import '@visual-storytelling/core/style.css';</script></head><body class="ve-standalone"><main class="ve-scene" data-paper="false"><object data="${page}" type="image/svg+xml" style="width:100%;height:1200px"></object></main></body></html>`,
      );
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
  return { directory: destination, example, title: catalog[example].title };
}
