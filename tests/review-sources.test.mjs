import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildScene } from '../tools/build-pages.mjs';
import { sourceReferences } from '../tools/motion/sources.mjs';

test('review opens the bundled consumer implementation, never the reviewing CLI version', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'review-sources-'));
  const scene = join(directory, 'scene'),
    output = join(directory, 'output'),
    runtime = join(scene, 'node_modules/@visual-storytelling/core'),
    module = join(runtime, 'dist/morph/three.js');
  try {
    await mkdir(join(runtime, 'dist/morph'), { recursive: true });
    await writeFile(
      join(runtime, 'package.json'),
      JSON.stringify({
        name: '@visual-storytelling/core',
        type: 'module',
        exports: './dist/morph/three.js',
      }),
    );
    await writeFile(module, 'export const version = "pinned consumer";');
    await writeFile(
      join(scene, 'scene.js'),
      'import { version } from "@visual-storytelling/core"; document.title = version;',
    );
    await writeFile(join(scene, 'index.html'), '<script type="module" src="scene.js"></script>');
    await buildScene(scene, output);
    const page = {
      evaluate: async () => ['http://localhost/index.html', 'http://localhost/index.js'],
    };
    let references = await sourceReferences(output, page);
    assert.equal(await references.owner('src/morph/three.ts'), await realpath(module));
    assert.equal(await references.owner('scene.js'), await realpath(join(scene, 'scene.js')));
    for (const reference of ['./scene.js', 'parts/../scene.js', join(scene, 'scene.js')])
      assert.equal(await references.owner(reference), await realpath(join(scene, 'scene.js')));
    assert.equal(
      await references.owner({ file: 'scene.js', line: 1 }),
      await realpath(join(scene, 'scene.js')),
    );
    assert.equal(
      await references.owner('src/viewport/three.ts'),
      undefined,
      'an unbundled CLI owner is not a source',
    );

    await writeFile(module, 'export const version = "edited after build";');
    references = await sourceReferences(output, page);
    assert.equal(
      await references.owner('src/morph/three.ts'),
      undefined,
      'a changed installed module no longer represents saved pixels',
    );
    await writeFile(
      join(output, 'index.js'),
      (await readFile(join(output, 'index.js'), 'utf8')) + '\n// changed bundle',
    );
    references = await sourceReferences(output, page);
    assert.equal(
      await references.owner('scene.js'),
      undefined,
      'a receipt from another bundle is unusable',
    );
    await rm(join(output, 'index.js.sources.json'));
    references = await sourceReferences(output, page);
    assert.equal(
      await references.owner('src/morph/three.ts'),
      undefined,
      'older films without an input receipt cannot fall back to the CLI checkout',
    );
    assert.equal(await references.owner('index.js'), await realpath(join(output, 'index.js')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
