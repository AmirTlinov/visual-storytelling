import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { pluginHost } from './plugin/host.mjs';

test(
  'MCP App controls the existing isolated renderer, preserves context and remounts the same position',
  { timeout: 30000 },
  async () => {
    const host = await pluginHost();
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 820, height: 850 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.goto(host.url);
      const app = page.frameLocator('iframe[title="MCP App"]'),
        scene = app.frameLocator('#scene');
      await app.locator('#connection').filter({ hasText: 'Готово' }).waitFor();
      const session = await page.evaluate(() => window.pluginTest.session);
      const call = (name, args = {}) =>
        host.client.callTool({ name, arguments: { sessionId: session.sessionId, ...args } });
      const inspect = async () => {
        const result = await call('story_inspect');
        assert.equal(result.isError, undefined, JSON.stringify(result));
        return result.structuredContent;
      };
      const start = await inspect();
      const action = {
        requestId: randomUUID(),
        buildRevision: start.buildRevision,
        stateRevision: start.stateRevision,
        commands: [{ type: 'cue', id: 'move_x', progress: 0.5 }],
      };
      const before = performance.now();
      const controlled = await call('story_control', action);
      assert.equal(controlled.isError, undefined, JSON.stringify(controlled));
      const latency = performance.now() - before;
      assert.equal(
        controlled.structuredContent.state.parameters.find((p) => p.key === 'x').value,
        1.5,
      );
      assert.deepEqual(
        await call('story_control', action),
        controlled,
        'a retried intent keeps its receipt',
      );
      assert.equal(
        await page.locator('iframe[title="MCP App"]').count(),
        1,
        'controls do not render another card',
      );
      const oldFrame = page.frames().find((f) => f.url() === 'about:srcdoc');
      const isolation = await oldFrame.evaluate(() => {
        let parentAccess = false;
        try {
          void parent.document.body;
          parentAccess = true;
        } catch {
          /* sandbox is opaque */
        }
        return {
          parentAccess,
          hostSDK: !!window.openai,
          fonts: document.fonts.check('16px SketchShantell'),
        };
      });
      assert.deepEqual(isolation, { parentAccess: false, hostSDK: false, fonts: true });
      assert.equal(await app.locator('header, #browse, #voice, #release, #expand').count(), 0);
      assert.equal(await app.locator('#scene-actions').isVisible(), false);
      assert.equal(
        await app.locator('#scene').evaluate((frame) => frame.getBoundingClientRect().top),
        0,
      );
      await page.evaluate(() => window.pluginTest.display('fullscreen', ['fullscreen']));
      await app.locator('html[data-mode="fullscreen"]').waitFor();
      await page.evaluate(() => window.pluginTest.theme('dark'));
      await app.locator('html[data-theme="dark"][data-mode="fullscreen"]').waitFor();
      await page.evaluate(() => window.pluginTest.display('inline', ['inline', 'fullscreen']));
      await app.locator('html[data-mode="inline"]').waitFor();
      await page.evaluate(() => window.pluginTest.theme('light'));
      assert.deepEqual(
        await page.evaluate(() => window.pluginTest.displayRequests),
        [],
        'the host owns the presentation size without plugin toolbar requests',
      );
      assert.equal((await inspect()).state.time, controlled.structuredContent.state.time);
      assert.equal(
        page.frames().includes(oldFrame),
        true,
        'display-mode change keeps the active renderer',
      );
      await scene.getByRole('button', { name: 'Исследовать', exact: true }).click();
      await scene.getByRole('slider', { name: 'По горизонтали', exact: true }).fill('-2');
      await page.waitForFunction(
        () => window.pluginTest.context?.structuredContent?.visualStory?.parameters?.x === -2,
      );
      assert.ok(
        JSON.stringify(await page.evaluate(() => window.pluginTest.context)).length < 1800,
        'one compact context slot',
      );
      await scene.getByRole('button', { name: 'Отменить условие', exact: true }).click();
      assert.equal((await inspect()).state.parameters.find((p) => p.key === 'x').value, 1.5);
      await scene.getByRole('button', { name: 'Повторить', exact: true }).click();
      assert.equal((await inspect()).state.parameters.find((p) => p.key === 'x').value, -2);
      await scene
        .getByRole('button', { name: 'Результат двух перемещений', exact: true })
        .press('Enter');
      const selected = await inspect();
      assert.deepEqual(selected.state.selected, ['result']);
      assert.deepEqual(selected.state.objects.find((o) => o.id === 'result').inputs, [
        'horizontal',
        'vertical',
      ]);
      await call('story_control', {
        requestId: randomUUID(),
        buildRevision: selected.buildRevision,
        stateRevision: selected.stateRevision,
        commands: [{ type: 'rate', value: 0.5 }],
      });
      const stale = await call('story_control', { ...action, requestId: randomUUID() });
      assert.equal(stale.isError, true);
      const changed = await inspect();
      assert.equal(changed.state.parameters.find((p) => p.key === 'x').value, -2);
      await page.evaluate(() => window.pluginTest.remount());
      await app.locator('#connection').filter({ hasText: 'Готово' }).waitFor();
      const restored = await inspect();
      assert.equal(restored.state.mode, 'explore');
      assert.equal(restored.state.parameters.find((p) => p.key === 'x').value, -2);
      assert.equal(restored.state.rate, 0.5);
      assert.deepEqual(restored.state.selected, ['result']);
      assert.deepEqual(
        restored.state.experimentHistory,
        { undo: false, redo: false },
        'restoring a view is not an author gesture',
      );
      assert.equal(restored.state.time, changed.state.time);
      assert.equal(restored.generation, changed.generation + 1);
      await page.evaluate(() => window.pluginTest.theme('dark'));
      await scene
        .locator('.ve-scene')
        .filter({ has: scene.locator('[data-player]') })
        .waitFor();
      await page.waitForFunction(
        () =>
          document.querySelector('iframe').contentDocument.documentElement.dataset.theme === 'dark',
      );
      await page.waitForFunction(() => window.pluginTest.context?.structuredContent?.visualStory);
      await page.evaluate(() => window.pluginTest.removeContext());
      const removed = await page.evaluate(() => window.pluginTest.context);
      await scene.getByRole('slider', { name: 'По горизонтали', exact: true }).fill('-1');
      await scene.getByRole('slider', { name: 'По вертикали', exact: true }).fill('1');
      // A subsequent inspected frame passes the debounce point without relying on a broad sleep.
      await inspect();
      await inspect();
      assert.deepEqual(
        await page.evaluate(() => window.pluginTest.context),
        removed,
        'a dismissed attachment stays dismissed',
      );
      assert.deepEqual(
        await page.evaluate(() => window.pluginTest.messages),
        [],
        'frame changes never send chat messages',
      );
      assert.deepEqual(errors, []);
      console.log(`Local MCP command → two renderer frames: ${latency.toFixed(1)} ms`);
    } finally {
      await browser.close();
      await host.close();
    }
  },
);
