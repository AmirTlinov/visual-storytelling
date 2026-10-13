import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildScene } from '../tools/build-pages.mjs';
import { renderer } from '../tools/render.mjs';
import { pinSceneProject } from '../tools/scene-project.mjs';
import { readStoryProject } from '../tools/story-project.mjs';
import { packDirectory } from '../tools/standalone.mjs';
const release = join(process.cwd(), '.plugin-release');
test(
  'authored TS and nested SVG bind to the common runtime and reopen as one HTML',
  { timeout: 60000 },
  async (t) => {
    const temporary = await mkdtemp(join(tmpdir(), 'custom-story-'));
    t.after(() => rm(temporary, { recursive: true, force: true }));
    const source = join(temporary, 'source'),
      built = join(temporary, 'built'),
      portable = join(temporary, 'portable');
    await cp('tools/document-modules/route', source, { recursive: true });
    await pinSceneProject(source, { root: release, prepared: true });
    await buildScene(source, built);
    const html = await packDirectory(built, 'index.html', { audio: 'original' });
    assert.ok(html.includes('data:image/svg+xml;base64,'));
    await mkdir(portable);
    await writeFile(join(portable, 'index.html'), html);
    const r = await renderer({ directory: portable, width: 960, controls: true });
    try {
      assert.equal((await r.capture.evaluate((scene) => scene.snapshot())).blocked, 'warehouse');
      await r.control([{ type: 'parameters', values: { reserve: 'independent' } }]);
      assert.deepEqual((await r.capture.evaluate((scene) => scene.snapshot())).route, [
        'maker',
        'home',
      ]);
      const symbol = await r.page.locator('[data-parcel]').getAttribute('href');
      assert.ok(symbol.startsWith('data:image/svg+xml;base64,'));
      const normalized = await r.page
        .locator('main')
        .evaluate((root) =>
          root.scene.authoring.prepare(root.scene.authoring.document, [
            { op: 'set-inputs', modelId: 'delivery', values: { 'disabled-home': true } },
          ]),
        );
      assert.equal(normalized.models[0].inputs['disabled-home'], true);
      assert.equal(
        (await r.capture.evaluate((scene) => scene.snapshot())).status,
        'delivered',
        'preparation is read-only',
      );
      assert.deepEqual(
        r.messages.filter((m) => m.type === 'error'),
        [],
      );
    } finally {
      await r.close();
    }
  },
);
test(
  'non-idempotent authored operation runs once; switching mode and seeking do not add steps',
  { timeout: 60000 },
  async (t) => {
    const temporary = await mkdtemp(join(tmpdir(), 'counter-story-'));
    t.after(() => rm(temporary, { recursive: true, force: true }));
    const source = join(temporary, 'source'),
      built = join(temporary, 'built');
    await cp('tools/document-modules/counter', source, { recursive: true });
    await pinSceneProject(source, { root: release, prepared: true });
    await buildScene(source, built);
    const r = await renderer({ directory: built, width: 960, controls: true });
    try {
      await r.seek(1);
      assert.equal((await r.capture.evaluate((scene) => scene.snapshot())).count, 1);
      await r.control([{ type: 'mode', value: 'explore' }]);
      assert.equal((await r.capture.evaluate((scene) => scene.snapshot())).count, 1);
      await r.control([{ type: 'parameters', values: { count: 7 } }]);
      assert.equal((await r.capture.evaluate((scene) => scene.snapshot())).count, 7);
      await r.seek(0);
      await r.seek(1);
      assert.equal((await r.capture.evaluate((scene) => scene.snapshot())).count, 7);
      await r.control([{ type: 'mode', value: 'story' }]);
      assert.equal((await r.capture.evaluate((scene) => scene.snapshot())).count, 1);
      await assert.rejects(
        r.page
          .locator('main')
          .evaluate((root) =>
            root.scene.authoring.prepare(root.scene.authoring.document, [
              { op: 'set-inputs', modelId: 'sample', values: { count: 99 } },
            ]),
          ),
        /count/,
      );
      assert.equal(
        (await r.capture.evaluate((scene) => scene.snapshot())).count,
        1,
        'invalid future operation preserves the accepted frame',
      );
      assert.deepEqual(
        r.messages.filter((m) => m.type === 'error'),
        [],
      );
    } finally {
      await r.close();
    }
  },
);
test('manifest rejects competing entries, outside resources and duplicate module owners', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'story-manifest-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  await cp('tools/document-modules/route', temporary, { recursive: true });
  await writeFile(join(temporary, 'scene.js'), '// competing source');
  await assert.rejects(readStoryProject(temporary), /competing scene.js/);
  await rm(join(temporary, 'scene.js'));
  const manifest = JSON.parse(await readFile(join(temporary, 'story-project.json'), 'utf8'));
  await writeFile(
    join(temporary, 'story-project.json'),
    JSON.stringify({ ...manifest, resources: ['../outside.svg'] }),
  );
  await assert.rejects(readStoryProject(temporary), /Invalid authored resource/);
  await writeFile(
    join(temporary, 'story-project.json'),
    JSON.stringify({ ...manifest, modules: [manifest.modules[0], manifest.modules[0]] }),
  );
  await assert.rejects(readStoryProject(temporary), /unique IDs/);
});
