import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { pluginHost } from './plugin/host.mjs';

test(
  'card sizing respects host width and fullscreen without rewriting root layout',
  { timeout: 120000 },
  async () => {
    const host = await pluginHost();
    const browser = await chromium.launch(chromiumLaunchOptions());
    const page = await browser.newPage({ viewport: { width: 820, height: 850 } });
    try {
      await page.addInitScript(() => {
        window.sizeChanges = [];
        addEventListener('message', ({ data }) => {
          if (data?.method === 'ui/notifications/size-changed')
            window.sizeChanges.push(data.params);
        });
        window.rootHeightChanges = [];
        addEventListener('DOMContentLoaded', () => {
          new MutationObserver((records) => {
            for (const record of records) {
              if (
                /(^|;)\s*height\s*:/.test(record.oldValue ?? '') ||
                document.documentElement.style.height
              )
                window.rootHeightChanges.push(record.oldValue);
            }
          }).observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['style'],
            attributeOldValue: true,
          });
        });
      });
      await page.goto(host.url);
      await page
        .frameLocator('iframe[title="MCP App"]')
        .locator('html[data-connection="connected"]')
        .waitFor();
      const panel = page.frames().find((frame) => frame.url().endsWith('/app'));
      const settled = async () => {
        await panel.waitForFunction(
          () => Math.abs(document.body.getBoundingClientRect().height - innerHeight) <= 1,
        );
        await panel.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
      };
      await settled();
      const initial = await page.evaluate(() => sizeChanges);
      assert.ok(initial.length > 0);
      assert.ok(
        initial.every((size) => !Object.hasOwn(size, 'width')),
        'content sizing must not echo host width',
      );

      await page.evaluate(() => pluginTest.display('fullscreen', ['inline', 'fullscreen']));
      await panel.waitForFunction(() => document.documentElement.dataset.mode === 'fullscreen');
      await settled();
      await page.evaluate(() => {
        sizeChanges.length = 0;
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await panel.waitForFunction(() => innerWidth <= 390);
      await settled();
      assert.deepEqual(
        await page.evaluate(() => sizeChanges),
        [],
        'fullscreen takes its dimensions from the host',
      );

      await page.evaluate(() => pluginTest.display('inline', ['inline', 'fullscreen']));
      await panel.waitForFunction(() => document.documentElement.dataset.mode === 'inline');
      await settled();
      assert.ok(
        (await page.evaluate(() => sizeChanges)).length > 0,
        'returning inline restores content sizing',
      );
      await panel.evaluate(() => {
        const notice = document.querySelector('#notice');
        notice.textContent = 'Сохранённое положение восстановлено. Можно продолжить исследование.';
        notice.hidden = false;
      });
      await settled();
      assert.equal(
        await panel.evaluate(() => document.documentElement.scrollHeight > innerHeight),
        false,
        'status margins fit inside the requested height',
      );

      await page.evaluate(() => {
        sizeChanges.length = 0;
      });
      await panel.evaluate(
        () =>
          new Promise((resolve) => {
            let frames = 60;
            const sample = () => (--frames ? requestAnimationFrame(sample) : resolve());
            requestAnimationFrame(sample);
          }),
      );
      assert.deepEqual(
        await page.evaluate(() => sizeChanges),
        [],
        'an idle card stops negotiating its size',
      );
      assert.deepEqual(
        await panel.evaluate(() => rootHeightChanges),
        [],
        'measurement must not mutate root height',
      );
    } finally {
      await browser.close();
      await host.close();
    }
  },
);
