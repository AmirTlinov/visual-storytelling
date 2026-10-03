import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { buildScene } from '../tools/build-pages.mjs';
import { serve } from '../tools/site.mjs';

test('manual SVG camera survives a hidden host and preserves its framing on resize', async () => {
  const bundle = await build({
    stdin: {
      contents:
        "import { ViewportSVG } from './src/viewport/svg.ts'; window.mountCamera = ViewportSVG.mount;",
      resolveDir: resolve('.'),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<div id="host" style="width:400px;height:300px"><svg style="width:100%;height:100%" viewBox="0 0 400 300"><g data-camera-world data-camera-transform><rect width="100" height="100"/></g></svg></div>',
    );
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      window.cameraView = window.mountCamera(document.querySelector('svg'));
      cameraView.shot({ target: { x: 0, y: 0, w: 100, h: 100 } });
    });
    await page.locator('svg').focus();
    await page.keyboard.press('ArrowLeft');
    const before = await page.evaluate(() => cameraView.pose);
    const layout = async (style) =>
      page.evaluate(async (style) => {
        Object.assign(document.querySelector('#host').style, style);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, style);
    await layout({ display: 'none' });
    await layout({ display: 'block' });
    assert.deepEqual(await page.evaluate(() => cameraView.pose), before);
    assert(await page.locator('svg rect').isVisible(), 'the drawing remains visible after return');
    await layout({ width: '800px', height: '600px' });
    assert.deepEqual(await page.evaluate(() => cameraView.pose), {
      s: before.s * 2,
      x: before.x * 2,
      y: before.y * 2,
    });
    assert(await page.locator('svg rect').isVisible());
    await page.evaluate(() => cameraView.dispose());
  } finally {
    await browser.close();
  }
});

test('typed examples release drawing observers and theme subscriptions through their sole scene handle', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-lifetime-'));
  let browser, server;
  try {
    for (const name of ['vector', 'materials'])
      await buildScene(resolve('examples', name), join(directory, name), { sourcePackage: true });
    server = await serve(directory);
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.addInitScript(() => {
      const Native = ResizeObserver,
        active = new Set();
      window.liveObservers = active;
      window.ResizeObserver = class extends Native {
        observe(...args) {
          active.add(this);
          return super.observe(...args);
        }
        disconnect() {
          active.delete(this);
          return super.disconnect();
        }
      };
    });
    for (const name of ['vector', 'materials']) {
      await page.goto(`${server.url}/${name}/index.html`);
      await page.waitForFunction(() => !!document.querySelector('.ve-scene')?.scene);
      assert(await page.evaluate(() => liveObservers.size > 0));
      assert.equal(await page.evaluate(() => typeof window.explainer), 'undefined');
      const result = await page.evaluate(() => {
        const root = document.querySelector('.ve-scene'),
          scene = root.scene;
        scene.seek(2);
        const time = scene.currentTime;
        scene.dispose();
        scene.dispose();
        return {
          time,
          observers: liveObservers.size,
          connected: root.isConnected,
          published: !!root.scene,
        };
      });
      assert.deepEqual(result, { time: 2, observers: 0, connected: false, published: false });
    }
  } finally {
    await browser?.close();
    await server?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
