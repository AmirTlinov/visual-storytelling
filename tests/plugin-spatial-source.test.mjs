import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { pluginHost } from './plugin/host.mjs';
import { finishFixtureJob } from './plugin/authoring-fixture.mjs';

test(
  'a source revision prepares a concealed 3D chapter, preserves the subject and undoes in the installed card',
  { timeout: 120000 },
  async () => {
    const root = process.env.VS_ACCEPT_ROOT ?? resolve('.plugin-release');
    const output = resolve(process.env.VS_ACCEPT_OUTPUT ?? 'artifacts/slice09-source-reload');
    await mkdir(output, { recursive: true });
    const initialTarget = {};
    const host = await pluginHost({
      dataDirectory: join(output, 'data'),
      initialTarget,
      serverCommand: join(root, 'runtime/node'),
      serverEntry: join(root, 'plugin/dist/server.mjs'),
    });
    const browser = await chromium.launch(chromiumLaunchOptions());
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    page.setDefaultTimeout(25000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const call = async (name, args) => {
      const r = await host.client.callTool({ name, arguments: args });
      assert(!r.isError, JSON.stringify(r));
      return r.structuredContent;
    };
    try {
      const created = await call('story_create', {
        title: 'Installed spatial revision',
        example: 'spatial-order',
        path: join(output, 'project'),
        requestId: randomUUID(),
      });
      if (created.job) await finishFixtureJob(host.client, created.job.id);
      const opened = await call('story_open', { projectId: created.project.id });
      initialTarget.sessionId = opened.sessionId;
      await page.goto(host.url);
      const app = page.frameLocator('iframe[title="MCP App"]');
      const scene = app.frameLocator('#scene');
      await scene.locator('[data-caption]').waitFor();
      let observed = await call('story_inspect', { sessionId: opened.sessionId, detail: 'model' });
      await call('story_control', {
        context: observed.context,
        requestId: randomUUID(),
        commands: [
          { type: 'seek', time: 22 },
          { type: 'select', ids: ['route:order:417'] },
        ],
        detail: 'model',
      });
      const originalCaption = await scene.locator('[data-caption]').innerText();
      const originalSource = await readFile(join(created.project.path, 'story.json'), 'utf8');
      const changed = JSON.parse(originalSource);
      const newCaption = 'Проследим этот заказ от магазина до банка через А.';
      changed.chapters.find((c) => c.id === 'network').beats.find((b) => b.id === 'send').text =
        newCaption;
      observed = await call('story_inspect', { sessionId: opened.sessionId, detail: 'model' });
      const edited = await call('story_edit', {
        context: observed.context,
        requestId: randomUUID(),
        changes: [{ path: 'story.json', content: JSON.stringify(changed, null, 2) + '\n' }],
      });
      await finishFixtureJob(host.client, edited.job.id);
      await call('story_open', { sessionId: opened.sessionId });
      await scene.locator('[data-caption]').filter({ hasText: newCaption }).waitFor();
      const after = await call('story_inspect', { sessionId: opened.sessionId, detail: 'model' });
      assert.equal(after.shownSourceRevision, after.sourceRevision);
      assert.equal(after.state.time, 22);
      assert.deepEqual(after.state.selected, ['route:order:417']);
      assert.equal(after.state.snapshot.content.order.observation.outcome, 'travelling');
      await page.screenshot({ path: join(output, 'edited-390.png') });
      await page.setViewportSize({ width: 1200, height: 900 });
      await page.screenshot({ path: join(output, 'edited-1200.png') });
      const project = await call('story_inspect', { projectId: created.project.id });
      const undo = await call('story_edit', {
        context: project.context,
        requestId: randomUUID(),
        undo: true,
      });
      await finishFixtureJob(host.client, undo.job.id);
      await call('story_open', { sessionId: opened.sessionId });
      await scene.locator('[data-caption]').filter({ hasText: originalCaption }).waitFor();
      const restored = await call('story_inspect', {
        sessionId: opened.sessionId,
        detail: 'model',
      });
      assert.equal(
        await readFile(join(created.project.path, 'story.json'), 'utf8'),
        originalSource,
      );
      assert.equal(restored.state.time, 22);
      assert.deepEqual(restored.state.selected, ['route:order:417']);
      assert(restored.generation > after.generation);
      assert.equal(await app.locator('.candidate').count(), 0);
      assert.equal(await app.locator('#error').isVisible(), false);
      assert.deepEqual(errors, []);
      await writeFile(
        join(output, 'receipt.json'),
        JSON.stringify(
          {
            root,
            server: host.client.getServerVersion(),
            before: observed,
            after,
            restored,
            errors,
          },
          null,
          2,
        ),
      );
    } finally {
      await browser.close();
      await host.close();
    }
  },
);
