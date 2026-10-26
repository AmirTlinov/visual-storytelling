import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
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
        document: { recipe: 'division', inputs: { count: 13, divisor: 3 } },
      });
      await page.evaluate((result) => window.pluginTest.result(result), created);
      await app.locator('html[data-connection="connected"]').waitFor();
      const session = created.structuredContent;
      let initial;
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const views = (await call('story_inspect', {})).structuredContent.sessions;
        initial = views.find(
          (view) => view.sessionId === session.sessionId && view.status === 'connected',
        );
        if (initial) break;
        await delay(25);
      }
      assert.ok(initial, 'the scene, not just the MCP connection, acknowledged its first frame');
      const request = {
        context: initial.context,
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
          context: checked.context,
          requestId: randomUUID(),
          detail: undefined,
          commands: [{ type: 'parameters', values: { count: 16 } }],
        })
      ).structuredContent;
      assert.equal(changed.publication, 'shown');
      assert.ok(changed.context);
      const authoredRequest = {
        context: changed.context,
        requestId: randomUUID(),
        operations: [{ op: 'set-inputs', modelId: 'division', values: { divisor: 4 } }],
      };
      const authored = (await call('story_edit', authoredRequest)).structuredContent;
      assert.equal(authored.publication, 'shown');
      assert.equal(
        authored.shown[0].state.snapshot.count,
        16,
        'authorship preserves the viewer input',
      );
      assert.equal(authored.shown[0].state.snapshot.divisor, 4);
      const sourceConflict = await host.client.callTool({
        name: 'story_edit',
        arguments: {
          ...authoredRequest,
          requestId: randomUUID(),
        },
      });
      assert.equal(sourceConflict.isError, true);
      assert.equal(sourceConflict.structuredContent.error.code, 'source_conflict');
      const undone = (
        await call('story_edit', {
          context: authored.context,
          requestId: randomUUID(),
          undo: true,
        })
      ).structuredContent;
      assert.equal(undone.publication, 'shown');
      assert.equal(undone.shown[0].state.snapshot.count, 16);
      assert.equal(undone.shown[0].state.snapshot.divisor, 3);
      assert.deepEqual(
        (await call('story_edit', authoredRequest)).structuredContent,
        authored,
        'an old authoring repeat retains its source and observed context after undo',
      );
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
          context: undone.context,
          requestId: randomUUID(),
          detail: 'model',
          commands: [{ type: 'pause' }],
        })
      ).structuredContent;
      assert.deepEqual(
        paused.state.snapshot,
        current.state.snapshot,
        'pause continues from the preceding result and still returns the requested model',
      );
      await page.evaluate(() => window.pluginTest.remount());
      await app.locator('html[data-connection="connected"]').waitFor();
      const formerRenderer = await host.client.callTool({
        name: 'story_control',
        arguments: {
          context: paused.context,
          requestId: randomUUID(),
          commands: [{ type: 'pause' }],
        },
      });
      assert.equal(formerRenderer.isError, true);
      assert.equal(formerRenderer.structuredContent.error.code, 'scene_context_conflict');
      assert.ok(formerRenderer.structuredContent.error.current.context);
      const recovered = (
        await call('story_control', {
          context: formerRenderer.structuredContent.error.current.context,
          requestId: randomUUID(),
          commands: [{ type: 'pause' }],
        })
      ).structuredContent;
      assert.equal(recovered.publication, 'shown');
      assert.deepEqual(
        (await call('story_control', request)).structuredContent,
        checked,
        'renderer replacement does not invalidate a completed historical request',
      );
    } finally {
      await browser.close();
      await host.close();
      await rm(temporary, { recursive: true, force: true });
    }
  },
);
