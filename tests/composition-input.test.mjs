import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { openFixture } from './support/fixture.mjs';

test('chapter edits, history and seeks share the accepted composition position', async () => {
  const browser = await chromium.launch(chromiumLaunchOptions());
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 1050 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openFixture(page, 'chapters');
    await page.evaluate(async () => {
      window.lesson = await window.galleryReady;
      window.condition = () => ({
        values: lesson.story.requested.values,
        shown: lesson.scene.snapshot(),
        time: lesson.story.requested.time,
        clock: lesson.story.currentTime,
        chapter: lesson.story.currentChapter,
        playing: lesson.story.player.state.playing,
      });
    });
    const read = () => page.evaluate(() => condition());
    let state = await read();
    assert.equal(state.values.chapter, 'workshop');
    assert.equal(state.values.closed, true);
    await page.evaluate(() =>
      lesson.scene.control([{ type: 'parameters', values: { chapter: 'experiment' } }]),
    );
    state = await read();
    assert.equal(state.values.chapter, 'experiment');
    assert.equal(state.shown.chapter, 'experiment');
    assert.equal(state.values.closed, true);
    assert.equal(state.chapter, 'experiment.change');
    assert.equal(state.time, state.clock);
    await page.evaluate(async () => {
      lesson.shell.input({ closed: false });
      await lesson.story.ready();
    });
    assert.equal((await read()).values.closed, false);
    await page.evaluate(() => lesson.scene.control([{ type: 'undoExperiment' }]));
    assert.equal((await read()).values.closed, true);
    await page.evaluate(() => lesson.scene.control([{ type: 'redoExperiment' }]));
    assert.equal((await read()).values.closed, false);
    await page.evaluate(async () => {
      lesson.shell.input({ chapter: 'workshop', sceneTime: 1 });
      await lesson.story.ready();
    });
    state = await read();
    assert.equal(state.shown.chapter, 'workshop');
    assert.equal(state.chapter, 'workshop.idea');
    assert.equal(
      state.values.closed,
      false,
      'a document subject retains viewer conditions across chapters',
    );
    assert.equal(state.time, state.clock);
    assert.equal(state.playing, false);
    const boundary = await page.evaluate(() => lesson.scene.capture());
    assert.equal(boundary.chapter, 'workshop.idea');
    assert.equal(boundary.progress, 1);
    await page.evaluate(async () => {
      lesson.shell.input({ closed: true });
      await lesson.story.ready();
      await lesson.scene.control([{ type: 'undoExperiment' }]);
    });
    state = await read();
    assert.equal(
      state.shown.chapter,
      'workshop',
      'undo preserves the outgoing chapter at its exact end',
    );
    assert.equal(state.values.sceneTime, 1);
    assert.equal(state.values.closed, false);
    await page.evaluate(async () => {
      lesson.story.seek(lesson.story.currentTime);
      await lesson.story.ready();
    });
    state = await read();
    assert.equal(
      state.values.chapter,
      'experiment',
      'a narrative seek owns the next chapter at the shared boundary',
    );
    assert.equal(state.values.sceneTime, 0);
    assert.equal(state.chapter, 'experiment.change');
    await page.evaluate(async () => {
      lesson.shell.input({ chapter: 'workshop', sceneTime: 0.5, closed: true });
      await lesson.story.ready();
    });
    state = await read();
    assert.equal(state.values.closed, true, 'explicit fields override the new chapter baseline');
    await page.evaluate(() => lesson.scene.control([{ type: 'undoExperiment' }]));
    assert.equal((await read()).values.chapter, 'experiment');
    await page.evaluate(async () => {
      lesson.shell.input({ chapter: 'experiment' });
      lesson.shell.input({ chapter: 'workshop' });
      await lesson.story.ready();
    });
    assert.equal((await read()).shown.chapter, 'workshop');
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
    assert.equal(state.chapter, 'workshop.approach');
    assert.equal(state.values.closed, true);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
