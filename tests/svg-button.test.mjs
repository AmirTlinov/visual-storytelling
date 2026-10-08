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
        import { inkButton } from './src/controls/ink-button.ts';
        import { surface } from './src/ink/surface.ts';
        import { loadFonts } from './src/ink/fonts.ts';
        import { describeObject, sceneObjects } from './src/scene-objects.ts';
        import './src/style.css';
        const parent = document.querySelector('g');
        describeObject(parent, {label: 'Circuit'});
        const objects = sceneObjects(document.querySelector('main'));
        let count = 0;
        const button = svgButton(parent, {
          x: 40, y: 40, width: 100, height: 60, label: 'Switch', pressed: false,
          onPress() { count++; button.update({pressed: count % 2 === 1}); }
        });
        window.lab = {button, objects, count: () => count};
        window.mountKey = async () => {
          await loadFonts();
          const host = document.createElement('main');
          host.className = 've-scene'; host.style.width = '400px';
          document.body.append(host);
          const drawing = surface(host, {id:'key-paper',width:360,height:180,title:'Key',description:'Drawn command',grid:false});
          drawing.element.setAttribute('role', 'group');
          const key = inkButton(drawing, 'write', 'WE', {label:'Enable write',width:100,onPress() {key.update({pressed:true});}});
          key.at(180,80);
          window.keyLab = {drawing,key};
        };`,
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
    await control.hover();
    await page.mouse.down();
    assert.equal(await control.getAttribute('data-pressing'), 'true');
    await page.mouse.move(290, 190);
    assert.equal(
      await control.getAttribute('data-pressing'),
      'false',
      'dragging away releases the face',
    );
    await page.mouse.up();
    assert.equal(await count(), 0, 'releasing outside cancels activation');
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
    assert.equal(await control.getAttribute('data-pressing'), 'true');
    await page.keyboard.up('Enter');
    assert.equal(await control.getAttribute('data-pressing'), 'false');
    assert.equal(await count(), 2, 'a held Enter activates once');
    await page.keyboard.down('Space');
    await page.keyboard.down('Space');
    assert.equal(await control.getAttribute('data-pressing'), 'true');
    assert.equal(await count(), 2, 'Space waits for release');
    await page.keyboard.up('Space');
    assert.equal(await control.getAttribute('data-pressing'), 'false');
    assert.equal(await count(), 3);
    assert.equal(await control.evaluate((node) => getComputedStyle(node).outlineStyle), 'solid');
    assert.deepEqual(await page.evaluate(() => lab.objects.selected), []);
    await page.keyboard.down('Space');
    await page.locator('svg > g').focus();
    await control.focus();
    await page.keyboard.up('Space');
    assert.equal(await count(), 3, 'a blurred Space press is cancelled');
    await control.hover();
    await page.mouse.down();
    await page.evaluate(() => lab.button.update({ disabled: true, label: 'Unavailable' }));
    assert.equal(await control.count(), 0, 'the accessible name follows the subject');
    const disabled = page.getByRole('button', { name: 'Unavailable', exact: true });
    assert.equal(await disabled.getAttribute('tabindex'), '-1');
    assert.equal(
      await disabled.getAttribute('data-pressing'),
      'false',
      'disabling releases the face',
    );
    await page.mouse.up();
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
    await page.evaluate(() => mountKey());
    const key = page.getByRole('button', { name: 'Enable write', exact: true });
    const appearance = () =>
      page.evaluate(() => {
        const root = keyLab.key.element,
          face = root.querySelector('.ve-ink-button-face'),
          edge = root.querySelector('.ve-ink-button-edge');
        return {
          wash: getComputedStyle(root).getPropertyValue('--ve-wash-strength').trim(),
          translation: getComputedStyle(face).translate,
          focus: getComputedStyle(root.querySelector('.ve-ink-button-focus')).visibility,
          edge: edge.getBBox().y + edge.getBBox().height > face.getBBox().y + face.getBBox().height,
          opacity: getComputedStyle(root).opacity,
        };
      });
    await page.mouse.move(0, 0);
    const idle = await appearance();
    assert.equal(idle.edge, true, 'the lower ink edge conveys a key before hover');
    assert.equal(idle.wash, '18%');
    await key.hover();
    assert.equal((await appearance()).wash, '26%');
    await page.mouse.down();
    assert.equal((await appearance()).translation, '0px 3px');
    await page.mouse.up();
    await page.mouse.move(0, 0);
    assert.equal((await appearance()).wash, '34%', 'toggle state remains after activation');
    assert.equal(
      (await appearance()).translation,
      'none',
      'toggle state does not keep the key physically down',
    );
    await key.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    assert.equal((await appearance()).focus, 'visible');
    await page.evaluate(() => keyLab.key.update({ disabled: true, pressed: false }));
    await key.hover();
    const inactive = await appearance();
    assert.equal(inactive.wash, '18%', 'disabled hover cannot highlight the key');
    assert.equal(inactive.focus, 'hidden');
    assert.equal(inactive.opacity, '0.42');
    const resized = await page.evaluate(() => {
      keyLab.key.text('A longer command');
      const width = keyLab.key.width,
        target = keyLab.key.control.getBBox();
      keyLab.drawing.dispose();
      return { width, targetWidth: target.width, connected: keyLab.key.element.isConnected };
    });
    assert.ok(resized.width > 100, 'long labels grow through the existing node');
    assert.ok(
      Math.abs(resized.targetWidth - resized.width - 6) < 0.001,
      'the hit region follows the face',
    );
    assert.equal(resized.connected, false, 'the surface owns control disposal');
  } finally {
    await browser.close();
  }
});
