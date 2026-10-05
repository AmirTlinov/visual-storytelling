import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { pluginHost } from './plugin/host.mjs';

test(
  'inline scene fits its player and resizes through the SDK without nested scrolling',
  {
    timeout: 45000,
  },
  async () => {
    const host = await pluginHost(),
      browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 820, height: 850 } });
    try {
      await page.goto(host.url);
      const app = page.frameLocator('iframe[title="MCP App"]');
      await app.locator('#connection').filter({ hasText: 'Готово' }).waitFor();
      const scene = page.frames().find((frame) => frame.url() === 'about:srcdoc');
      const panel = scene.parentFrame();
      const fits = async () => {
        await scene.waitForFunction(
          () => {
            const player = document.querySelector('.ve-player')?.getBoundingClientRect();
            return (
              player &&
              player.top >= 0 &&
              player.bottom <= innerHeight + 1 &&
              document.documentElement.scrollHeight <= innerHeight + 1
            );
          },
          undefined,
          { timeout: 5000 },
        );
        await panel.waitForFunction(
          () =>
            Math.abs(
              document.querySelector('footer').getBoundingClientRect().bottom - innerHeight,
            ) <= 1 && document.documentElement.scrollHeight <= innerHeight + 1,
          undefined,
          { timeout: 5000 },
        );
        return scene.evaluate(() => innerHeight);
      };
      const wideHeight = await fits();
      assert.ok(wideHeight > 570, 'the normal player exceeds the former fixed viewport');
      await mkdir('artifacts/plugin', { recursive: true });
      await page.screenshot({ path: 'artifacts/plugin/viewer-layout-wide.png', fullPage: true });
      await app.locator('#expand').click();
      await panel.waitForFunction(() => document.documentElement.dataset.mode === 'fullscreen');
      await fits();
      await app.locator('#expand').click();
      await panel.waitForFunction(() => document.documentElement.dataset.mode === 'inline');
      assert.equal(await fits(), wideHeight, 'fullscreen must not inflate the inline card');
      await page.setViewportSize({ width: 390, height: 844 });
      await scene.waitForFunction((height) => innerHeight < height, wideHeight);
      const narrowHeight = await fits();
      assert.ok(narrowHeight < wideHeight, 'content measurement also permits the iframe to shrink');
      await page.screenshot({ path: 'artifacts/plugin/viewer-layout-narrow.png', fullPage: true });
      await page.evaluate(() =>
        pluginTest.openResult({
          isError: true,
          content: [{ type: 'text', text: 'Переподключите плагин для обновления.' }],
        }),
      );
      await app.locator('#error').filter({ hasText: 'Переподключите плагин' }).waitFor();
      assert.equal(await app.locator('#connection').textContent(), 'Не удалось открыть');
    } finally {
      await browser.close();
      await host.close();
    }
  },
);
