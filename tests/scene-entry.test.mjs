import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workflows } from '../plugin/workflows.mjs';
import { ProjectStore } from '../plugin/projects.mjs';
import { renderer } from '../tools/render.mjs';
import { sceneEntry, scenePage } from '../tools/scene-entry.mjs';

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
  'generated SVG and alternate HTML entries create editable projects, open and export through one scene',
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
      for (const [example, entry, time] of [
        ['logic-gates', 'build.py', 0],
        ['geometric-tensor', 'build.mjs', 0],
        ['parameter-cube', 'preview.html', 7.2],
        ['lc-oscillator', 'preview.html', 0.75],
      ]) {
        const project = await projects.create(join(directory, example), {
          title: example,
          example,
        });
        let authored;
        const result = await workflows.create(
          {
            data,
            projectPath: project.path,
            projectId: project.id,
            title: example,
            example,
          },
          {
            jobId: randomUUID(),
            signal: new AbortController().signal,
            progress() {},
            authored(value) {
              authored = value;
              assert.equal(value.entry, entry, example);
              assert.ok(value.files[entry], `${example}: returned entry exists before build`);
              assert.equal(value.files['index.html'], undefined, 'no duplicate editable entry');
            },
          },
        );
        assert.ok(authored, example);
        assert.equal(result.sourceRevision, authored.sourceRevision);
        assert.equal((await projects.inspect(project.id)).entry, entry);
        assert.equal((await sceneEntry(project.path)).source, entry);
        const built = JSON.parse(
          await readFile(join(data, 'builds', result.buildRevision + '.json'), 'utf8'),
        );
        const packed = join(directory, example + '-portable');
        await mkdir(packed);
        await writeFile(join(packed, scenePage), built.html);
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
            example,
          );
          await capture.seek(time);
          const before = await capture.capture.evaluate((value) => value.snapshot());
          if (capture.info.seekable) {
            await capture.seek(0);
            await capture.seek(time);
            assert.deepEqual(
              await capture.capture.evaluate((value) => value.snapshot()),
              before,
              example,
            );
          }
          const checkpoint = await capture.page.evaluate(() =>
            document.querySelector('.ve-scene').scene.capture(),
          );
          await capture.capture.evaluate((value, saved) => value.restore(saved), checkpoint);
          assert.match(await capture.svg(), /<svg\b/, example);
          const pixels = await capture.png();
          assert.ok(pixels.byteLength > 10000, example);
          await writeFile(join(evidence, example + '.png'), pixels);
          if (example === 'geometric-tensor') {
            const slider = capture.page.getByRole('slider');
            await slider.fill('0.3');
            await capture.page.waitForFunction(
              () => document.querySelector('.ve-scene').scene.snapshot().t === 0.3,
            );
          }
          assert.deepEqual(
            capture.messages.filter(({ type }) => type === 'error'),
            [],
            example,
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
