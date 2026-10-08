import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { build } from 'esbuild';

test('drawn SVG controls own pointer, keyboard, disabled state and disposal inside scene objects', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
        import { svgButton } from './src/controls/svg.ts';
        import { describeObject, sceneObjects } from './src/scene-objects.ts';
        import './src/styles/scene.css';
        const parent = document.querySelector('g');
        describeObject(parent, {label: 'Circuit'});
        const objects = sceneObjects(document.querySelector('main'));
        let count = 0;
        const button = svgButton(parent, {
          x: 40, y: 40, width: 100, height: 60, label: 'Switch', pressed: false,
          onPress() { count++; button.update({pressed: count % 2 === 1}); }
        });
        window.lab = {button, objects, count: () => count};`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    outdir: resolve('artifacts/test-svg-button'),
    loader: { '.woff2': 'dataurl' },
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<main class="ve-scene"><svg width="300" height="200" viewBox="0 0 300 200"><g data-object="circuit"><path d="M50 60L130 80" fill="none" stroke="black"/></g></svg></main>',
    );
    await page.addStyleTag({
      content: bundle.outputFiles.find((file) => file.path.endsWith('.css')).text,
    });
    await page.addScriptTag({
      content: bundle.outputFiles.find((file) => file.path.endsWith('.js')).text,
    });
    const control = page.getByRole('button', { name: 'Switch', exact: true });
    const count = () => page.evaluate(() => lab.count());
    await control.click();
    assert.equal(await count(), 1, 'pointer down/up and click activate only once');
    assert.equal(await control.getAttribute('aria-pressed'), 'true');
    assert.deepEqual(
      await page.evaluate(() => lab.objects.selected),
      [],
      'the control keeps scene selection',
    );
    await control.focus();
    await page.keyboard.down('Enter');
    await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    assert.equal(await count(), 2, 'a held Enter activates once');
    await page.keyboard.down('Space');
    await page.keyboard.down('Space');
    assert.equal(await count(), 2, 'Space waits for release');
    await page.keyboard.up('Space');
    assert.equal(await count(), 3);
    assert.equal(await control.evaluate((node) => getComputedStyle(node).outlineStyle), 'solid');
    assert.deepEqual(await page.evaluate(() => lab.objects.selected), []);
    await page.keyboard.down('Space');
    await page.locator('svg > g').focus();
    await control.focus();
    await page.keyboard.up('Space');
    assert.equal(await count(), 3, 'a blurred Space press is cancelled');
    await page.evaluate(() => lab.button.update({ disabled: true, label: 'Unavailable' }));
    assert.equal(await control.count(), 0, 'the accessible name follows the subject');
    const disabled = page.getByRole('button', { name: 'Unavailable', exact: true });
    assert.equal(await disabled.getAttribute('tabindex'), '-1');
    await disabled.dispatchEvent('click');
    await disabled.dispatchEvent('keydown', { key: 'Enter' });
    await disabled.dispatchEvent('keydown', { key: ' ' });
    await disabled.dispatchEvent('keyup', { key: ' ' });
    assert.equal(await count(), 3, 'disabled controls ignore all activation paths');
    await page.evaluate(() => {
      lab.button.update({ disabled: false });
      lab.button.bounds({ x: 160, y: 100, width: 110, height: 70 });
    });
    assert.equal(await disabled.getAttribute('tabindex'), '0');
    await page.mouse.click(210, 140);
    assert.equal(await count(), 4, 'updated bounds move the actual hit target');
    assert.equal(
      await page.evaluate(() => {
        const element = lab.button.element;
        lab.button.dispose();
        element.dispatchEvent(new MouseEvent('click'));
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        element.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
        element.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }));
        return element.isConnected;
      }),
      false,
    );
    assert.equal(await count(), 4, 'detached controls have no live listeners');
  } finally {
    await browser.close();
  }
});
