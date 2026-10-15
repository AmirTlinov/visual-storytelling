import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { assetURLs } from '../tools/asset-urls.mjs';

test('one conditions owner exposes resources in both frame scopes and rejects unsafe replacement', async () => {
  const bundled = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
    import {SceneShell} from './dist/index.js';
    window.mount = scope => {
      window.shell?.dispose();
      window.shell = SceneShell.mount(document.querySelector('main'), {
        title:'Источник', frame:{width:1280,height:720,scope},
        resources:[{id:'data',title:'<img src=x onerror=alert(1)>',kind:'data',description:'Три наблюдения',limits:['Одна выборка']}]
      });
    };
    mount('stage');
  `,
    },
    bundle: true,
    write: false,
    format: 'iife',
    loader: { '.woff2': 'dataurl' },
    plugins: [assetURLs()],
  });
  const browser = await chromium.launch(chromiumLaunchOptions());
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 760 } });
    await page.setContent('<main class="ve-scene" style="width:100%"></main>');
    const css = await build({
      entryPoints: ['dist/style.css'],
      bundle: true,
      write: false,
      loader: { '.woff2': 'dataurl' },
    });
    await page.addStyleTag({ content: css.outputFiles[0].text });
    await page.addScriptTag({ content: bundled.outputFiles[0].text });
    for (const scope of ['stage', 'scene']) {
      await page.evaluate((scope) => mount(scope), scope);
      const button = page.getByRole('button', { name: 'Условия', exact: true });
      assert.equal(await button.count(), 1);
      await button.click();
      await page.locator('.ve-scene-resources > summary').click();
      const panel = page.getByRole('dialog', { name: 'Условия объяснения' });
      assert.ok(await panel.isVisible());
      await page.mouse.click(1, 1);
      assert.ok(await panel.isVisible(), 'conditions stay open while the drawing is explored');
      const geometry = await page.evaluate(() => ({
        panel: document.querySelector('.ve-scene-conditions').getBoundingClientRect().toJSON(),
        drawing: document.querySelector('[data-scene-frame]').getBoundingClientRect().toJSON(),
        root: document.querySelector('main').getBoundingClientRect().toJSON(),
      }));
      assert(
        geometry.panel.top >= geometry.drawing.bottom,
        'conditions leave the complete drawing visible',
      );
      assert(
        geometry.root.bottom >= geometry.panel.bottom,
        'conditions participate in the card layout',
      );
      await page.locator('main').evaluate((root) =>
        root.dispatchEvent(
          new CustomEvent('scene-playback-error', {
            detail: new Error('Проверка изменения высоты сообщения при открытых условиях.'),
          }),
        ),
      );
      await page.waitForFunction(
        () =>
          document.querySelector('.ve-scene-conditions').getBoundingClientRect().top >=
          document.querySelector('.ve-status').getBoundingClientRect().bottom,
      );
      assert.equal(await panel.locator('img').count(), 0);
      assert.equal(await panel.locator('[data-resource-id="data"]').count(), 1);
      const rejected = await page.evaluate(() => {
        try {
          shell.setResources([
            {
              id: 'bad',
              title: 'Bad',
              kind: 'data',
              description: 'Bad',
              url: 'javascript:alert(1)',
            },
          ]);
          return false;
        } catch {
          return true;
        }
      });
      assert.ok(rejected);
      assert.equal(await panel.locator('[data-resource-id="data"]').count(), 1);
      await panel.press('Escape');
      await page.waitForFunction(
        () =>
          document.querySelector('.ve-conditions-trigger').getAttribute('aria-expanded') ===
          'false',
      );
      assert.equal(await button.getAttribute('aria-expanded'), 'false');
      assert(await panel.isHidden(), 'closed conditions leave no empty space');
      await page.evaluate(() => shell.setResources([]));
      assert.equal(await page.locator('[data-resource-id]').count(), 0);
      if (scope === 'stage') assert.ok(await button.isHidden());
    }
    await page.setViewportSize({ width: 375, height: 280 });
    await page.evaluate(() => {
      mount('scene');
      shell.setResources(
        Array.from({ length: 8 }, (_, index) => ({
          id: 'source' + index,
          title: 'Источник ' + index,
          kind: 'data',
          description: 'Описание источника и границ применимости примера.',
        })),
      );
    });
    await page.getByRole('button', { name: 'Условия', exact: true }).click();
    await page.locator('.ve-scene-resources > summary').click();
    const short = page.getByRole('dialog', { name: 'Условия объяснения' });
    await page.waitForFunction(
      () => document.querySelector('.ve-scene-conditions').scrollHeight > 480,
    );
    const shortGeometry = await short.evaluate((node) => ({
      height: node.getBoundingClientRect().height,
      maximum: getComputedStyle(node).maxHeight,
      viewport: innerHeight,
      sizing: getComputedStyle(node).boxSizing,
    }));
    assert(shortGeometry.height <= 264.01, JSON.stringify(shortGeometry));
  } finally {
    await browser.close();
  }
});
