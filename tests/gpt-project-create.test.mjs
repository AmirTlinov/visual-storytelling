import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScene } from '../tools/create-scene.mjs';

test('the default source CLI creates the GPT manifest with the current generated release pin', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'gpt-project-create-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const project = join(directory, 'project');
  const created = await createScene(project, { example: 'gpt-model', silent: true });
  assert.equal(created.entry, 'story-project.json');
  const pin = JSON.parse(await readFile(join(project, 'scene-runtime.json'), 'utf8'));
  const release = await realpath(fileURLToPath(new URL('../.plugin-release', import.meta.url)));
  assert.equal(pin.root, release);
  assert.equal(await realpath(join(project, 'node_modules/@visual-storytelling/core')), release);
  assert.equal(created.runtime.build, pin.build);
  assert.equal((await readdir(project)).includes('dependencies'), false);
  assert.equal((await readdir(project)).includes('scene.js'), false);
  assert.equal((await readdir(project)).includes('index.html'), false);
  assert.ok(created.files['subject-model.js']);
});
