import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { buildScene } from '../tools/build-pages.mjs';
import { serve } from '../tools/site.mjs';

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
