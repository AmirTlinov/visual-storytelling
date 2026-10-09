import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { assetURLs } from '../tools/asset-urls.mjs';

test('chapter edits, prediction, history and seeks share the accepted lesson position', async () => {
  const bundle = await build({
    entryPoints: ['examples/area-lesson/scene.js'],
    bundle: true,
    format: 'iife',
    write: false,
    outdir: '.',
    loader: { '.woff2': 'dataurl', '.png': 'dataurl' },
    plugins: [
      {
        name: 'source-library',
        setup(builder) {
          builder.onResolve({ filter: /^@visual-storytelling\/core(?:\/[^/]+)?$/ }, ({ path }) => ({
            path: resolve(
              'src',
              path.endsWith('.css')
                ? 'style.css'
                : path === '@visual-storytelling/core'
                  ? 'index.ts'
                  : `${path.split('/').at(-1)}/index.ts`,
            ),
          }));
        },
      },
      assetURLs(),
    ],
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 1050 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent('<body class="ve-standalone"><main id="story" class="ve-scene"></main>');
    await page.addStyleTag({
      content: bundle.outputFiles.find((file) => file.path.endsWith('.css')).text,
    });
    await page.addScriptTag({
      content: bundle.outputFiles.find((file) => file.path.endsWith('.js')).text,
    });
    await page.evaluate(async () => {
      window.lesson = await window.galleryReady;
      window.condition = () => ({
        values: lesson.story.requested.values,
        shown: lesson.scene.snapshot(),
        time: lesson.story.requested.time,
        clock: lesson.story.currentTime,
        chapter: lesson.story.currentChapter,
        navigation: document.querySelector('.ve-chapter-navigation [role="combobox"]').textContent,
        playing: lesson.story.player.state.playing,
      });
    });
    const read = () => page.evaluate(() => condition());
    let state = await read();
    assert.equal(state.values.chapter, 'unit');
    assert.deepEqual([state.values.width, state.values.height], [1, 1]);

    await page.evaluate(() =>
      lesson.scene.control([{ type: 'parameters', values: { chapter: 'prediction' } }]),
    );
    state = await read();
    assert.equal(state.values.chapter, 'prediction');
    assert.deepEqual(
      [state.values.width, state.values.height, state.values.guess, state.values.checked],
      [3, 2, -1, false],
    );
    assert.equal(state.shown.content.area, 6);
    assert.equal(state.chapter, 'prediction.try');
    assert.equal(state.navigation, 'Записываем прогноз перед удвоением ширины.');
    assert.equal(state.time, state.clock);

    await page.getByRole('button', { name: '24 см²', exact: true }).click();
    state = await read();
    assert.equal(state.values.guess, 24);
    assert.equal(state.shown.content.area, 6, 'recording a guess preserves the measured rectangle');
    await page.getByRole('button', { name: 'Удвоить ширину и проверить' }).click();
    assert.equal((await read()).shown.content.area, 12);
    await page.getByRole('button', { name: 'Отменить условие', exact: true }).click();
    state = await read();
    assert.deepEqual(
      [state.values.width, state.values.height, state.values.guess, state.values.checked],
      [3, 2, 24, false],
    );
    assert.equal(state.shown.content.area, 6);
    assert.equal(state.chapter, 'prediction.try');
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    assert.equal((await read()).shown.content.area, 12);

    await page.evaluate(async () => {
      lesson.shell.input({ chapter: 'rows', sceneTime: 1 });
      await lesson.story.ready();
    });
    state = await read();
    assert.equal(state.values.chapter, 'rows');
    assert.deepEqual(
      [state.values.width, state.values.height, state.values.guess, state.values.checked],
      [3, 2, -1, false],
    );
    assert.equal(state.shown.chapter, 'rows');
    assert.equal(state.shown.content.area, 6);
    assert.equal(state.chapter, 'rows.rule');
    assert.equal(state.navigation, 'Три умножить на два равно шести квадратным сантиметрам.');
    assert.equal(state.time, state.clock);
    assert.equal(state.playing, false);
    const boundary = await page.evaluate(() => lesson.scene.capture());
    assert.equal(boundary.chapter, 'rows.rule');
    assert.ok(boundary.cue === 'rows' || boundary.cue.startsWith('rows.'));
    assert.equal(boundary.progress, 1);

    await page.evaluate(async () => {
      lesson.shell.input({ height: 1 });
      await lesson.story.ready();
      await lesson.scene.control([{ type: 'undoExperiment' }]);
    });
    state = await read();
    assert.equal(
      state.shown.chapter,
      'rows',
      'undo preserves the outgoing chapter at its exact end',
    );
    assert.equal(state.values.sceneTime, 1);
    assert.equal(state.shown.content.area, 6);
    assert.equal(state.chapter, 'rows.rule');

    await page.evaluate(async () => {
      lesson.story.seek(lesson.story.currentTime);
      await lesson.story.ready();
    });
    state = await read();
    assert.equal(
      state.values.chapter,
      'prediction',
      'a narrative seek owns the next chapter at the shared boundary',
    );
    assert.equal(state.values.sceneTime, 0);
    assert.equal(state.chapter, 'prediction.try');

    await page.evaluate(async () => {
      lesson.shell.input({ chapter: 'experiment', sceneTime: 1, width: 6, height: 5 });
      await lesson.story.ready();
    });
    state = await read();
    assert.deepEqual(
      [state.values.width, state.values.height],
      [6, 5],
      'explicit fields override the new chapter baseline',
    );
    assert.equal(state.shown.content.area, 30);
    await page.evaluate(() => lesson.scene.control([{ type: 'undoExperiment' }]));
    state = await read();
    assert.equal(state.values.chapter, 'prediction');
    assert.equal(state.shown.content.area, 6);

    await page.evaluate(async () => {
      lesson.shell.input({ chapter: 'unit' });
      lesson.shell.input({ chapter: 'prediction' });
      await lesson.story.ready();
    });
    state = await read();
    assert.equal(state.shown.chapter, 'prediction');
    assert.deepEqual([state.values.width, state.values.height], [3, 2]);
    const invalid = await page.evaluate(() => {
      const before = lesson.story.requested;
      try {
        lesson.shell.input({ chapter: 'missing' });
      } catch (error) {
        return { message: error.message, unchanged: before === lesson.story.requested };
      }
    });
    assert.match(invalid.message, /Unknown chapter/);
    assert.equal(invalid.unchanged, true);
    await page.evaluate(async () => {
      lesson.story.seek(0);
      await lesson.story.ready();
    });
    state = await read();
    assert.equal(state.shown.chapter, 'unit');
    assert.equal(state.chapter, 'unit.length');
    assert.equal(state.shown.content.area, 1);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
