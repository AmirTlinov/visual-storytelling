import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { pluginHost } from './plugin/host.mjs';

test(
  'control can return the computed model and replay its original observation',
  { timeout: 30000 },
  async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'story-control-detail-'));
    const host = await pluginHost({
      dataDirectory: join(temporary, 'data'),
      initialTarget: {},
      serverEntry: fileURLToPath(
        new URL('../.plugin-release/plugin/dist/server.mjs', import.meta.url),
      ),
    });
    const browser = await chromium.launch(chromiumLaunchOptions({ headless: true }));
    const call = async (name, args) => {
      const result = await host.client.callTool({ name, arguments: args });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      return result;
    };
    try {
      const page = await browser.newPage();
      await page.goto(host.url);
      const app = page.frameLocator('iframe[title="MCP App"]');
      await app.locator('#catalog:not([hidden])').waitFor();
      const created = await call('story_create', {
        title: 'Проверить полную группу',
        path: join(temporary, 'project'),
        requestId: randomUUID(),
        explanation: { model: { kind: 'division', count: 13, divisor: 3 } },
      });
      await page.evaluate((result) => window.pluginTest.result(result), created);
      await app.locator('html[data-connection="connected"]').waitFor();
      const session = created.structuredContent;
      const request = {
        sessionId: session.sessionId,
        buildRevision: session.buildRevision,
        stateRevision: 0,
        requestId: randomUUID(),
        detail: 'model',
        commands: [
          { type: 'mode', value: 'explore' },
          { type: 'parameters', values: { count: 15 } },
        ],
      };
      const checked = (await call('story_control', request)).structuredContent;
      assert.equal(checked.acknowledgement, 'rendered');
      assert.deepEqual(checked.state.snapshot, {
        id: 'division',
        count: 15,
        divisor: 3,
        quotient: 5,
        remainder: 0,
      });
      assert.equal(checked.state.objects.find((o) => o.id === 'division:quotient').value, 5);
      assert.equal(checked.state.objects.find((o) => o.id === 'division:remainder').value, 0);
      const changed = (
        await call('story_control', {
          ...request,
          stateRevision: checked.stateRevision,
          requestId: randomUUID(),
          detail: undefined,
          commands: [{ type: 'parameters', values: { count: 16 } }],
        })
      ).structuredContent;
      assert.equal(changed.state.snapshot, undefined, 'the default response remains compact');
      assert.deepEqual(
        (await call('story_control', request)).structuredContent,
        checked,
        'retry preserves the original model observation',
      );
      const current = (
        await call('story_inspect', { sessionId: session.sessionId, detail: 'model' })
      ).structuredContent;
      assert.equal(
        current.state.snapshot.count,
        16,
        'replaying the receipt does not repeat the input',
      );
      assert.equal(current.state.snapshot.remainder, 1);
      const paused = (
        await call('story_control', {
          sessionId: session.sessionId,
          requestId: randomUUID(),
          detail: 'model',
          commands: [{ type: 'pause' }],
        })
      ).structuredContent;
      assert.deepEqual(
        paused.state.snapshot,
        current.state.snapshot,
        'pause needs no revision and still returns the requested model',
      );
    } finally {
      await browser.close();
      await host.close();
      await rm(temporary, { recursive: true, force: true });
    }
  },
);
