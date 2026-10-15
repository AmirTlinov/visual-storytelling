import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScene } from '../tools/create-scene.mjs';
import { writeBuildInfo } from '../tools/build-info.mjs';
import { projectFiles } from '../tools/project-files.mjs';
import { readPinnedRuntime } from '../tools/runtime-reference.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'story-create-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'library');
  await mkdir(join(root, 'dist'), { recursive: true });
  await mkdir(join(root, 'examples/gpt-model'), { recursive: true });
  await cp(
    fileURLToPath(new URL('../tools/scaffold', import.meta.url)),
    join(root, 'tools/scaffold'),
    {
      recursive: true,
    },
  );
  // These inputs belong to the fixture's original receipt. Creation must filter
  // them without changing or silently repairing its immutable runtime package.
  const scaffold = join(root, 'tools/scaffold');
  for (const folder of ['dist', 'artifacts', 'nested/review', 'nested/.scratch']) {
    await mkdir(join(scaffold, folder), { recursive: true });
    await writeFile(join(scaffold, folder, 'old.json'), '{}');
  }
  await writeFile(join(scaffold, '.private.html'), '<script src="absent.js"></script>');
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: '@visual-storytelling/core',
      version: '0.0.1',
      type: 'module',
      files: ['dist', 'tools', 'examples'],
      exports: { '.': './dist/index.js' },
    }),
  );
  await writeFile(join(root, 'dist/index.js'), 'export const fixture = true;\n');
  await writeFile(join(root, 'dist/api.json'), JSON.stringify({ modules: {} }));
  await writeFile(
    join(root, 'examples/catalog.json'),
    JSON.stringify({
      'gpt-model': { title: 'Explicit exemplar', source: 'scene.js' },
    }),
  );
  await writeFile(join(root, 'examples/gpt-model/index.html'), '<title>Explicit exemplar</title>');
  await writeFile(join(root, 'examples/gpt-model/scene.js'), 'export const exemplar = true;\n');
  await writeBuildInfo(root, join(root, 'dist'));
  return { root, directory };
}

test('default create returns a neutral editable project and its exact pinned runtime before installation', async (t) => {
  const { root, directory } = await fixture(t);
  const target = join(directory, 'new-scene');
  const created = await createScene(target, { root, title: 'A < B & C' });
  assert.equal(created.example, undefined);
  assert.equal(created.entry, 'index.html');
  assert.equal(created.title, 'A < B & C');
  assert.match(
    await readFile(join(target, 'index.html'), 'utf8'),
    /<title>A &lt; B &amp; C<\/title>/,
  );
  assert.equal(
    await readFile(join(target, 'scene.js'), 'utf8'),
    await readFile(join(root, 'tools/scaffold/scene.js'), 'utf8'),
  );
  assert.equal((await readdir(target)).includes('node_modules'), false);
  for (const path of [
    'dist/old.json',
    'artifacts/old.json',
    'nested/review/old.json',
    'nested/.scratch/old.json',
    '.private.html',
  ])
    await assert.rejects(readFile(join(target, path)), { code: 'ENOENT' });
  assert.ok(created.files['scene.js']);
  assert.ok(created.files['index.html']);
  assert.ok(created.files['package-lock.json']);
  assert.deepEqual(await projectFiles(target), {
    files: created.files,
    revision: created.sourceRevision,
  });
  assert.deepEqual(created.runtime, (await readPinnedRuntime(target)).runtime);
  assert.match(created.runtime.build, /^[a-f0-9]{64}$/);
  assert.match(created.runtime.dependency, /^file:\.\/dependencies\/.*\.tgz$/);
});

test('an explicit exemplar is copied without overwriting existing authored files', async (t) => {
  const { root, directory } = await fixture(t);
  const target = join(directory, 'exemplar');
  const created = await createScene(target, { root, example: 'gpt-model' });
  assert.equal(created.title, 'Explicit exemplar');
  assert.equal(await readFile(join(target, 'scene.js'), 'utf8'), 'export const exemplar = true;\n');
  await assert.rejects(createScene(target, { root }), /empty output directory/);
  assert.equal(await readFile(join(target, 'scene.js'), 'utf8'), 'export const exemplar = true;\n');
  for (const example of ['unknown', '__proto__', 'constructor'])
    await assert.rejects(
      createScene(join(directory, example), { root, example }),
      /Choose an example/,
    );
  await assert.rejects(
    createScene(join(directory, 'empty-title'), { root, title: ' ' }),
    /project title/,
  );
});
