import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { pluginHost } from './plugin/host.mjs';

test(
  'inline scene fits its player and resizes through the SDK without nested scrolling',
  {
    timeout: 60000,
  },
  async () => {
    const host = await pluginHost(),
      browser = await chromium.launch(chromiumLaunchOptions());
    const page = await browser.newPage({ viewport: { width: 820, height: 850 } });
    try {
      await page.goto(host.url);
      const app = page.frameLocator('iframe[title="MCP App"]');
      await app.locator('html[data-connection="connected"]').waitFor();
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
            Math.abs(document.querySelector('main').getBoundingClientRect().bottom - innerHeight) <=
              1 && document.documentElement.scrollHeight <= innerHeight + 1,
          undefined,
          { timeout: 5000 },
        );
        const frame = await scene.locator('[data-scene-frame]').boundingBox();
        assert.ok(frame && Math.abs(frame.width / frame.height - 16 / 9) < 0.001);
        return scene.evaluate(() => innerHeight);
      };
      const wideHeight = await fits();
      await mkdir('artifacts/plugin', { recursive: true });
      await page.screenshot({ path: 'artifacts/plugin/viewer-layout-wide.png', fullPage: true });
      await page.evaluate(() => window.pluginTest.display('fullscreen', ['inline', 'fullscreen']));
      await panel.waitForFunction(() => document.documentElement.dataset.mode === 'fullscreen');
      await fits();
      await page.evaluate(() => window.pluginTest.display('inline', ['inline', 'fullscreen']));
      await panel.waitForFunction(() => document.documentElement.dataset.mode === 'inline');
      assert.equal(await fits(), wideHeight, 'fullscreen must not inflate the inline card');
      await page.setViewportSize({ width: 390, height: 844 });
      await scene.waitForFunction((height) => innerHeight < height, wideHeight);
      const narrowHeight = await fits();
      assert.ok(narrowHeight < wideHeight, 'content measurement also permits the iframe to shrink');
      await page.screenshot({ path: 'artifacts/plugin/viewer-layout-narrow.png', fullPage: true });
      const drawing = app.frameLocator('#scene');
      const beforeTransitions = await scene.evaluate(() =>
        document.querySelector('.ve-scene').scene.capture(),
      );
      const session = await page.evaluate(() => pluginTest.session.sessionId);
      const transport = drawing.locator('.ve-player button').first();
      await transport.focus();
      const wholeFrame = async () => {
        const geometry = await scene.locator('[data-scene-frame]').evaluate((frame) => {
          const outer = frame.getBoundingClientRect(),
            content = frame.firstElementChild.getBoundingClientRect();
          frame.scrollLeft = 400;
          frame.scrollTop = 180;
          return {
            ratio: outer.width / outer.height,
            difference: Math.max(
              Math.abs(outer.width - content.width),
              Math.abs(outer.height - content.height),
            ),
            scroll: [frame.scrollLeft, frame.scrollTop],
          };
        });
        assert.ok(Math.abs(geometry.ratio - 16 / 9) < 0.001);
        assert.ok(geometry.difference < 1, 'the whole composition fits its aperture');
        assert.deepEqual(geometry.scroll, [0, 0], 'the wrapper has no zoom or scroll surface');
        assert.equal(
          await drawing
            .getByRole('button', { name: /^(Читать крупнее|Открыть крупнее|Весь кадр)$/ })
            .count(),
          0,
        );
        assert.equal(
          await transport.evaluate((node) => document.activeElement === node),
          true,
          'native host transitions preserve focus',
        );
      };
      for (let index = 0; index < 10; index++) {
        await page.evaluate(() => pluginTest.display('fullscreen', ['inline', 'fullscreen']));
        await panel.waitForFunction(() => document.documentElement.dataset.mode === 'fullscreen');
        await fits();
        await wholeFrame();
        await page.evaluate(() => pluginTest.display('inline', ['inline', 'fullscreen']));
        await panel.waitForFunction(() => document.documentElement.dataset.mode === 'inline');
        assert.equal(await fits(), narrowHeight);
        await wholeFrame();
        assert.ok(await scene.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
      await page.evaluate(() => {
        for (let index = 0; index < 10; index++) {
          pluginTest.display('fullscreen', ['inline', 'fullscreen']);
          pluginTest.display('inline', ['inline', 'fullscreen']);
        }
      });
      await panel.waitForFunction(() => document.documentElement.dataset.mode === 'inline');
      await fits();
      await wholeFrame();
      assert.deepEqual(
        await scene.evaluate(() => document.querySelector('.ve-scene').scene.capture()),
        beforeTransitions,
      );
      assert.equal(
        await scene.evaluate(() => document.querySelector('.ve-scene').scene.inspect().playing),
        false,
      );
      assert.equal(await page.evaluate(() => pluginTest.session.sessionId), session);
      assert.equal(await drawing.locator('[data-player]').count(), 1);
      assert.equal(
        page.frames().includes(scene),
        true,
        'native display changes keep the same renderer',
      );
      assert.deepEqual(
        await page.evaluate(() => pluginTest.displayRequests),
        [],
        'only native Codex UI owns expansion',
      );
      const player = await scene.evaluate(() => {
        const player = document.querySelector('.ve-player');
        return {
          framed: Boolean(player.closest('[data-scene-frame]')),
          controls: [...player.querySelectorAll('button, input, [role="slider"]')]
            .filter((node) => node.checkVisibility())
            .map((node) => ({
              height: node.getBoundingClientRect().height,
              width: node.getBoundingClientRect().width,
            })),
        };
      });
      assert.equal(player.framed, false, 'the only player is outside the drawing scale');
      assert.ok(
        player.controls.every((control) => control.height >= 32 && control.width >= 44),
        JSON.stringify(player),
      );
      await page.evaluate(() =>
        pluginTest.openResult({
          isError: true,
          content: [{ type: 'text', text: 'Переподключите плагин для обновления.' }],
        }),
      );
      await app.locator('#error').filter({ hasText: 'Переподключите плагин' }).waitFor();
    } finally {
      await browser.close();
      await host.close();
    }
  },
);
