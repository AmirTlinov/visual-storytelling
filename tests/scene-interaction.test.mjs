import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { assetURLs } from '../tools/asset-urls.mjs';

test('one live scene owns disposal, semantic visibility, keyboard history and cue-based restoration', async () => {
  const bundled = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
    import { SceneShell } from './src/scene.ts';
    import { mountScene } from './src/scene-handle.ts';
    import { describeObject } from './src/scene-objects.ts';
    const root = document.querySelector('main');
    let selections = 0;
    root.addEventListener('scene-selection', () => selections++);
    window.mount = (split = 5, duration = 10) => {
      const shell = SceneShell.mount(root, { title: 'Interactive model', parameters: [{ key: 'x', label: 'X', value: 1, min: 0, max: 10 }] });
      shell.stage.innerHTML = '<svg width="200" height="80"><g id="group"><g data-object="item"><rect width="100" height="50" fill="blue"/></g></g></svg>';
      describeObject(shell.stage.querySelector('[data-object]'), { label: 'Meaningful item', value: () => shell.parameters.x });
      shell.attachStory({ script: { duration, cues: { first: { start: 0, end: split }, second: { start: split, end: duration } } }, stateAt: () => ({ x: 1 }), render: () => {} });
      window.shell = shell; window.scene = root.scene;
    };
    window.count = () => selections;
    mount();
    const parameters = [{ key: 'chapter', label: 'Chapter', value: 0 }, { key: 'x', label: 'X', value: 1, min: 0, max: 10 }];
    let values = { chapter: 0, x: 1 };
    window.dynamic = mountScene(document.querySelector('aside'), { dispose() {} }, { parameters, values: () => values, setValues(next) { values = next; parameters[1].max = next.chapter === 1 ? 2 : 10; } });
  `,
    },
    bundle: true,
    write: false,
    format: 'iife',
    loader: { '.woff2': 'dataurl' },
    plugins: [assetURLs()],
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<main class="ve-scene" style="width:500px"></main><aside></aside>');
    await page.addScriptTag({ content: bundled.outputFiles[0].text });
    const old = await page.evaluate(() => {
      window.first = scene;
      shell.dispose();
      mount();
      try {
        first.select(['item']);
        return 'old owner remained live';
      } catch (error) {
        return error.message;
      }
    });
    assert.match(old, /disposed/);
    await page.getByRole('button', { name: 'Meaningful item', exact: true }).press('Enter');
    assert.equal(
      await page.evaluate(() => count()),
      1,
      'shell.dispose must remove the old semantic listeners',
    );
    assert.deepEqual(await page.evaluate(() => scene.selected), ['item']);
    await page.evaluate(() => scene.select([]));
    const item = page.getByRole('button', { name: 'Meaningful item', exact: true });
    await item.click();
    assert.deepEqual(await page.evaluate(() => scene.selected), ['item']);
    await page.getByRole('button', { name: 'Воспроизвести', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => scene.selected), ['item']);
    await page.getByRole('button', { name: 'Пауза', exact: true }).click();
    await item.click();
    assert.deepEqual(await page.evaluate(() => scene.selected), []);
    await item.click();
    await page.locator('.ve-stage svg').click({ position: { x: 160, y: 65 } });
    assert.deepEqual(await page.evaluate(() => scene.selected), []);
    await page
      .getByRole('button', { name: 'Meaningful item', exact: true })
      .click({ button: 'right' });
    assert.deepEqual(
      await page.evaluate(() => scene.selected),
      [],
      'a context click does not select a subject',
    );
    const visibility = await page.evaluate(() => {
      const group = document.querySelector('#group');
      group.style.display = 'none';
      const hidden = scene.inspect({ presentation: false }).objects[0].visible;
      group.style.display = '';
      group.style.opacity = '0';
      const transparent = scene.inspect({ presentation: false }).objects[0].visible;
      group.style.opacity = '';
      return {
        hidden,
        transparent,
        shown: scene.inspect({ presentation: false }).objects[0].visible,
      };
    });
    assert.deepEqual(visibility, { hidden: false, transparent: false, shown: true });
    await page.evaluate(() =>
      scene.control([
        { type: 'mode', value: 'explore' },
        { type: 'parameters', values: { x: 7 } },
      ]),
    );
    await page.getByRole('button', { name: 'Отменить условие', exact: true }).click();
    assert.equal(await page.getByRole('slider', { name: 'X', exact: true }).inputValue(), '1');
    await page.keyboard.press('Control+Shift+z');
    await page.waitForFunction(() => scene.inspect().parameters[0].value === 7);
    const restored = await page.evaluate(async () => {
      await scene.control([
        { type: 'seek', time: 5 },
        { type: 'mode', value: 'explore' },
        { type: 'parameters', values: { x: 4 } },
        { type: 'select', ids: ['item'] },
      ]);
      const saved = scene.capture();
      shell.dispose();
      mount(12, 20);
      const state = await scene.restore(saved);
      return {
        cue: saved.cue,
        time: state.time,
        value: state.parameters[0].value,
        selected: state.selected,
        history: state.experimentHistory,
        playing: state.playing,
      };
    });
    assert.deepEqual(restored, {
      cue: 'second',
      time: 12,
      value: 4,
      selected: ['item'],
      history: { undo: false, redo: false },
      playing: false,
    });
    const ordered = await page.evaluate(async () => {
      try {
        await dynamic.control([
          { type: 'parameters', values: { chapter: 1 } },
          { type: 'parameters', values: { x: 7 } },
        ]);
        return { error: null };
      } catch (error) {
        return { error: error.message, values: dynamic.inspect().parameters.map((p) => p.value) };
      }
    });
    assert.match(ordered.error, /Invalid scene parameter/);
    assert.deepEqual(
      ordered.values,
      [1, 1],
      'a preceding command cannot make a later value bypass live bounds',
    );
  } finally {
    await browser.close();
  }
});
