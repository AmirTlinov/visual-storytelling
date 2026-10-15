import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workflows } from '../plugin/workflows.mjs';
import { ProjectStore } from '../plugin/projects.mjs';
import { commitStoreEdit } from './plugin/store-edit.mjs';
import { renderer } from '../tools/render.mjs';
import { sceneEntry, scenePage } from '../tools/scene-entry.mjs';
import { createScene } from '../tools/create-scene.mjs';
import { preparedBuildHTML } from '../plugin/build-payload.mjs';

test('a malformed draft entry remains inspectable for an authoring repair', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-entry-draft-'));
  try {
    const projects = new ProjectStore(join(directory, 'data'));
    await projects.start();
    const project = await projects.create(join(directory, 'project'));
    await writeFile(join(project.path, 'scene.json'), '{"entry":');
    const draft = await projects.inspect(project.id);
    assert.equal(draft.entry, undefined);
    assert.ok(draft.files['scene.json']);
    assert.match(draft.sourceRevision, /^[a-f0-9]{64}$/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  'editing a neutral project into SVG and alternate HTML entries preserves one source and export scene',
  { timeout: 300000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'story-entries-'));
    const evidence = fileURLToPath(
      new URL('../artifacts/coherent-authoring/entries/', import.meta.url),
    );
    await mkdir(evidence, { recursive: true });
    const data = join(directory, 'data');
    const projects = new ProjectStore(data);
    await projects.start();
    try {
      for (const [fixture, entry, time] of [
        ['svg', 'build.mjs', 0],
        ['scene-shell', 'preview.html', 7.2],
      ]) {
        const created = await createScene(join(directory, fixture), { title: fixture });
        assert.equal(created.entry, 'index.html');
        const project = await projects.register(created.directory, { title: fixture });
        const source = new URL(`./fixtures/${fixture}/`, import.meta.url);
        const changes = [{ path: 'index.html', content: null }];
        if (fixture === 'svg') changes.push({ path: 'scene.js', content: null });
        for (const name of await readdir(source))
          changes.push({
            path: name === 'index.html' ? 'preview.html' : name,
            content: await readFile(new URL(name, source), 'utf8'),
          });
        if (fixture === 'scene-shell')
          changes.push({ path: 'scene.json', content: JSON.stringify({ entry }) });
        const authored = await commitStoreEdit(projects, {
          projectId: project.id,
          sourceRevision: (await projects.inspect(project.id)).sourceRevision,
          requestId: randomUUID(),
          changes,
        });
        assert.equal(authored.entry, entry, fixture);
        assert.ok(authored.files[entry], `${fixture}: authored entry exists before build`);
        assert.equal(authored.files['index.html'], undefined, 'no duplicate editable entry');
        const result = await workflows.build(
          {
            data,
            projectPath: project.path,
            projectId: project.id,
            sourceRevision: authored.sourceRevision,
            title: fixture,
          },
          {
            jobId: randomUUID(),
            signal: new AbortController().signal,
            progress() {},
          },
        );
        assert.equal(result.sourceRevision, authored.sourceRevision);
        assert.equal((await projects.inspect(project.id)).entry, entry);
        assert.equal((await sceneEntry(project.path)).source, entry);
        const built = JSON.parse(
          await readFile(join(data, 'builds', result.buildRevision + '.json'), 'utf8'),
        );
        const packed = join(directory, fixture + '-portable');
        await mkdir(packed);
        await writeFile(join(packed, scenePage), await preparedBuildHTML(data, built));
        const capture = await renderer({
          directory: packed,
          theme: 'light',
          width: 800,
          controls: true,
        });
        try {
          assert.equal(
            await capture.page.evaluate(() => Boolean(document.querySelector('.ve-scene')?.scene)),
            true,
            fixture,
          );
          await capture.seek(time);
          const before = await capture.capture.evaluate((value) => value.snapshot());
          if (capture.info.seekable) {
            await capture.seek(0);
            await capture.seek(time);
            assert.deepEqual(
              await capture.capture.evaluate((value) => value.snapshot()),
              before,
              fixture,
            );
          }
          const checkpoint = await capture.page.evaluate(() =>
            document.querySelector('.ve-scene').scene.capture(),
          );
          await capture.capture.evaluate((value, saved) => value.restore(saved), checkpoint);
          assert.match(await capture.svg(), /<svg\b/, fixture);
          const pixels = await capture.png();
          assert.ok(pixels.byteLength > 10000, fixture);
          await writeFile(join(evidence, fixture + '.png'), pixels);
          if (fixture === 'svg') {
            const slider = capture.page.getByRole('slider');
            await slider.fill('0.3');
            await capture.page.waitForFunction(
              () => document.querySelector('.ve-scene').scene.snapshot().t === 0.3,
            );
          }
          assert.deepEqual(
            capture.messages.filter(({ type }) => type === 'error'),
            [],
            fixture,
          );
          await capture.page.evaluate(() => {
            const root = document.querySelector('.ve-scene');
            root.scene.dispose();
            if (root.scene) throw new Error('Scene disposal did not unregister its owner');
          });
        } finally {
          await capture.close();
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
