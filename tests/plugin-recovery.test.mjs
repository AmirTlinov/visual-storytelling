import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { pluginHost } from './plugin/host.mjs';

test(
  'recovery is bounded, preserves its paused renderer and supports manual recovery before navigation',
  { timeout: 50000 },
  async () => {
    const host = await pluginHost();
    const browser = await chromium.launch(chromiumLaunchOptions({ headless: true }));
    const page = await browser.newPage({ viewport: { width: 820, height: 850 } });
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const original = host.client.callTool.bind(host.client);
    let failExchange = false,
      offline = false,
      updateRequired = false,
      recoveries = 0;
    host.client.callTool = async (request, ...options) => {
      if (request.name === 'story_view' && request.arguments.action === 'recover') {
        recoveries++;
        if (!updateRequired) await new Promise((resolve) => setTimeout(resolve, 150));
      }
      if (updateRequired && request.name === 'story_view')
        return {
          isError: true,
          content: [
            { type: 'text', text: 'This MCP connection belongs to a previous installed release.' },
          ],
          structuredContent: { error: { code: 'RUNTIME_UPDATE_REQUIRED' } },
        };
      if (
        offline &&
        request.name === 'story_view' &&
        ['exchange', 'recover'].includes(request.arguments.action)
      )
        return { isError: true, content: [{ type: 'text', text: 'Connection is offline' }] };
      if (
        failExchange &&
        request.name === 'story_view' &&
        request.arguments.action === 'exchange' &&
        request.arguments.wait !== false
      ) {
        failExchange = false;
        return { isError: true, content: [{ type: 'text', text: 'Transient exchange failure' }] };
      }
      return original(request, ...options);
    };
    try {
      await page.goto(host.url);
      const app = page.frameLocator('iframe[title="MCP App"]');
      await app.locator('#connection').filter({ hasText: 'Готово' }).waitFor();
      const opened = await original({ name: 'story_open', arguments: { example: 'gpt-model' } });
      assert.equal(opened.isError, undefined, JSON.stringify(opened));
      await page.evaluate((result) => window.pluginTest.openResult(result), opened);
      await app.locator('#connection').filter({ hasText: 'Готово' }).waitFor();
      const sessionId = opened.structuredContent.sessionId;
      const inspect = async () => {
        const result = await original({ name: 'story_inspect', arguments: { sessionId } });
        assert.equal(result.isError, undefined, JSON.stringify(result));
        return result.structuredContent;
      };
      const before = await inspect();
      const frame = page.frames().find((value) => value.url() === 'about:srcdoc');
      await original({
        name: 'story_control',
        arguments: {
          sessionId,
          requestId: randomUUID(),
          buildRevision: before.buildRevision,
          stateRevision: before.stateRevision,
          commands: [{ type: 'play' }],
        },
      });
      failExchange = true;
      await app.locator('#connection').filter({ hasText: 'Восстанавливаю связь…' }).waitFor();
      await app.locator('#connection').filter({ hasText: 'Готово' }).waitFor();
      const after = await inspect();
      assert.equal(recoveries, 1);
      assert.equal(after.generation, before.generation);
      assert.equal(after.buildRevision, before.buildRevision);
      assert.equal(after.state.playing, false);
      assert.ok(
        page.frames().includes(frame),
        'a transient exchange preserves the actual renderer',
      );
      offline = true;
      const disconnectedAt = Date.now();
      await app.locator('#reconnect').waitFor({ state: 'visible', timeout: 17000 });
      assert.ok(
        Date.now() - disconnectedAt < 17000,
        'automatic recovery stops within its 15 second window plus the pending poll',
      );
      assert.ok(recoveries <= 11, 'exponential backoff bounds the number of transport attempts');
      assert.equal(await app.locator('#connection').innerText(), 'Сцена на паузе');
      offline = false;
      await app.locator('#reconnect').click();
      await app.locator('#connection').filter({ hasText: 'Готово' }).waitFor();
      assert.equal((await inspect()).generation, before.generation);
      assert.ok(page.frames().includes(frame));
      const navigation = await original({
        name: 'story_navigate',
        arguments: { sessionId, target: { example: 'gpt-model' } },
      });
      assert.equal(navigation.isError, undefined, JSON.stringify(navigation));
      assert.notEqual(navigation.structuredContent.sessionId, sessionId);
      await app.locator('#back').waitFor();
      await app.locator('#connection').filter({ hasText: 'Готово' }).waitFor();
      await app.locator('#back').click();
      await app.frameLocator('#scene').locator('[data-scene-frame]').waitFor();
      await app.locator('#back').waitFor({ state: 'hidden' });
      await app.locator('#connection').filter({ hasText: 'Готово' }).waitFor();
      assert.equal(await app.locator('#error').isVisible(), false);
      const recoveriesBeforeUpdate = recoveries,
        frameBeforeUpdate = page.frames().find((value) => value.url() === 'about:srcdoc');
      updateRequired = true;
      await app
        .locator('#error')
        .filter({ hasText: 'Установлена новая версия' })
        .waitFor({ timeout: 3000 });
      assert.equal(await app.locator('#connection').innerText(), 'Сцена на паузе');
      assert.equal(await app.locator('#reconnect').isVisible(), false);
      assert.equal(
        recoveries,
        recoveriesBeforeUpdate,
        'a stale MCP does not retry recovery against the wrong release',
      );
      assert.ok(page.frames().includes(frameBeforeUpdate), 'the update keeps the displayed frame');
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await host.close();
    }
  },
);
