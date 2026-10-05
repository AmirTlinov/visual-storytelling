import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { pluginHost } from './plugin/host.mjs';

test(
  'one panel visits an explanation and returns to the lesson; independent sessions arbitrate playback',
  { timeout: 90000 },
  async () => {
    const host = await pluginHost(),
      browser = await chromium.launch();
    const page = await browser.newPage();
    const call = async (name, args = {}) => {
      const result = await host.client.callTool({ name, arguments: args });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      return result;
    };
    const state = async (id) => (await call('story_inspect', { sessionId: id })).structuredContent;
    try {
      await page.goto(host.url);
      const app = page.frameLocator('iframe[title="MCP App"]');
      await app.locator('#connection').filter({ hasText: 'Готово' }).waitFor();
      const first = (await call('story_inspect')).structuredContent.sessions[0];
      await call('story_control', {
        ...Object.fromEntries(
          ['sessionId', 'buildRevision', 'stateRevision'].map((k) => [k, first[k]]),
        ),
        requestId: randomUUID(),
        commands: [
          { type: 'seek', time: 8 },
          { type: 'rate', value: 0.75 },
        ],
      });
      const before = await state(first.sessionId);
      const visited = await call('story_navigate', {
        sessionId: first.sessionId,
        target: { example: 'explorer-3d' },
      });
      await app.locator('#back').waitFor();
      await app.frameLocator('#scene').locator('canvas').waitFor();
      const spatial = await state(visited.structuredContent.sessionId);
      assert.ok(spatial.state.objects.length >= 1);
      await app.locator('#back').click();
      await app.locator('#back').waitFor({ state: 'hidden' });
      const returned = await state(first.sessionId);
      assert.equal(returned.state.time, before.state.time);
      assert.equal(returned.state.rate, 0.75);
      assert.equal(returned.state.playing, false);
      // A second chat opens an independent session rather than stealing the first renderer.
      const other = await browser.newPage();
      await other.goto(host.url);
      const otherApp = other.frameLocator('iframe[title="MCP App"]');
      await otherApp.locator('#connection').filter({ hasText: 'Готово' }).waitFor();
      const otherId = (await call('story_inspect')).structuredContent.sessions.find(
        (s) => s.sessionId !== first.sessionId && s.sessionId !== spatial.sessionId,
      ).sessionId;
      for (const id of [first.sessionId, otherId]) {
        const current = await state(id);
        await call('story_control', {
          sessionId: id,
          buildRevision: current.buildRevision,
          stateRevision: current.stateRevision,
          requestId: randomUUID(),
          commands: [{ type: 'play' }],
        });
      }
      assert.equal((await state(first.sessionId)).state.playing, false);
      assert.equal((await state(otherId)).state.playing, true);
      assert.equal((await state(first.sessionId)).status, 'connected');
      const priorFocus = await page.evaluate(() => {
        pluginTest.delayFocus(1000);
        return pluginTest.focusRequests;
      });
      const current = await state(first.sessionId);
      const pendingPlay = host.client.callTool({
        name: 'story_control',
        arguments: {
          sessionId: first.sessionId,
          buildRevision: current.buildRevision,
          stateRevision: current.stateRevision,
          requestId: randomUUID(),
          commands: [{ type: 'play' }],
        },
      });
      await page.waitForFunction((count) => pluginTest.focusRequests > count, priorFocus);
      const pauseStart = performance.now();
      await call('story_control', {
        sessionId: first.sessionId,
        requestId: randomUUID(),
        commands: [{ type: 'pause' }],
      });
      assert.ok(
        performance.now() - pauseStart < 500,
        'pause interrupts pending playback rather than awaiting permission',
      );
      assert.equal((await pendingPlay).isError, true);
      await page.waitForTimeout(1100);
      assert.equal((await state(first.sessionId)).state.playing, false);
      assert.equal(
        (await state(otherId)).state.playing,
        true,
        'a cancelled late focus cannot stop the other lesson',
      );
    } finally {
      await browser.close();
      await host.close();
    }
  },
);
