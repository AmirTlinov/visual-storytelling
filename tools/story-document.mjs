import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolvePackage } from './build-info.mjs';
import { readStoryProject } from './story-project.mjs';
import { readPinnedRuntime } from './runtime-reference.mjs';

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
    const manifest = await readStoryProject(directory);
    let spec;
    if (manifest?.modules.length) {
      // Authored JS/TS executes only in the existing browser renderer, against its pinned runtime.
      const pin = await readPinnedRuntime(directory);
      if (!pin?.root) throw new Error('Pin this authored-module project before preparing speech.');
      const { preparedStoryHTML } = await import(
        pathToFileURL(join(pin.root, 'tools/prepare-story-project.mjs')).href
      );
      const { renderer } = await import(pathToFileURL(join(pin.root, 'tools/render.mjs')).href);
      const page = await preparedStoryHTML(directory, { silent: true });
      if (!page) throw new Error('Pin this authored-module project before preparing speech.');
      const capture = await renderer({
        directory,
        html: page.html,
        entry: '__speech_projection__.html',
      });
      try {
        ({ document, spec } = await capture.page.evaluate(() => {
          const authoring = document.querySelector('main').scene.authoring;
          return { document: authoring.document, spec: authoring.narration };
        }));
        if (!spec)
          throw new Error(
            'The pinned runtime has no document speech projection; migrate it explicitly.',
          );
      } finally {
        await capture.close();
      }
    } else {
      const { documentNarration, validateStoryDocument } = await import(projection.href);
      document = validateStoryDocument(document);
      spec = documentNarration(document);
    }
    const text = JSON.stringify(spec, null, 2) + '\n';
    const file = join(
      tmpdir(),
      'visual-story-narration',
      createHash('sha256').update(resolve(directory)).update(text).digest('hex'),
      'narration.json',
    );
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
    return { file, directory: resolve(directory), document };
  }
}
