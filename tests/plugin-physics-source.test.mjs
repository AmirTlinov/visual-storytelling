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
  'a physical source revision preserves the paused live world through installed reopen and undo',
  { timeout: 120000 },
  async () => {
    const root = process.env.VS_ACCEPT_ROOT ?? resolve('.plugin-release');
    const output = resolve(process.env.VS_ACCEPT_OUTPUT ?? 'artifacts/slice10-source-reload');
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
        title: 'Installed physics revision',
        example: 'push-block',
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
          { type: 'seek', time: 3.6 },
          { type: 'select', ids: ['block'] },
        ],
        detail: 'model',
      });
      const originalCaption = await scene.locator('[data-caption]').textContent();

      await scene.getByRole('button', { name: 'Условия', exact: true }).click();
      await scene.getByRole('button', { name: 'Живой опыт', exact: true }).click();
      await scene.locator('main').evaluate((root) => root.scene.play());
      await page.waitForTimeout(200);
      await scene.locator('main').evaluate((root) => root.scene.pause());
      const physical = await scene
        .locator('main')
        .evaluate((root) => root.scene.capture().simulation);
      assert(physical.time > 0.958);

      const originalSource = await readFile(join(created.project.path, 'story.json'), 'utf8');
      const changed = JSON.parse(originalSource);
      const newCaption = 'Приложим ту же силу и посмотрим на брусок.';
      changed.chapters.find((c) => c.id === 'trial').beats.find((b) => b.id === 'push').text =
        newCaption;
      observed = await call('story_inspect', { sessionId: opened.sessionId, detail: 'model' });
      const edited = await call('story_edit', {
        context: observed.context,
        requestId: randomUUID(),
        changes: [{ path: 'story.json', content: JSON.stringify(changed, null, 2) + '\n' }],
      });
      await finishFixtureJob(host.client, edited.job.id);
      await call('story_open', { sessionId: opened.sessionId });
      await scene
        .locator('[data-caption]')
        .filter({ hasText: newCaption })
        .waitFor({ state: 'attached' });
      await scene.getByRole('button', { name: 'Условия', exact: true }).click();
      await scene
        .getByRole('button', { name: 'К рассказу', exact: true })
        .waitFor({ state: 'attached' });
      await scene.getByRole('button', { name: 'Закрыть условия', exact: true }).click();
      const after = await call('story_inspect', { sessionId: opened.sessionId, detail: 'model' });
      assert.equal(after.shownSourceRevision, after.sourceRevision);
      assert.equal(after.state.time, 3.6);
      assert.deepEqual(after.state.selected, ['block']);
      assert.equal(after.state.snapshot.content.model.time, physical.time);
      assert.deepEqual(
        await scene.locator('main').evaluate((root) => root.scene.capture().simulation),
        physical,
      );
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
      await scene
        .locator('[data-caption]')
        .filter({ hasText: originalCaption })
        .waitFor({ state: 'attached' });
      // Wide chrome keeps the live-mode action in its header.
      await scene
        .getByRole('button', { name: 'К рассказу', exact: true })
        .waitFor({ state: 'attached' });
      const restored = await call('story_inspect', {
        sessionId: opened.sessionId,
        detail: 'model',
      });
      assert.equal(
        await readFile(join(created.project.path, 'story.json'), 'utf8'),
        originalSource,
      );
      assert.equal(restored.state.time, 3.6);
      assert.deepEqual(restored.state.selected, ['block']);
      assert(restored.generation > after.generation);
      assert.deepEqual(
        await scene.locator('main').evaluate((root) => root.scene.capture().simulation),
        physical,
      );
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
    } catch (cause) {
      await page.screenshot({ path: join(output, 'failure.png') });
      const app = page.frameLocator('iframe[title="MCP App"]');
      const scene = app.frameLocator('#scene');
      await writeFile(
        join(output, 'failure.json'),
        JSON.stringify(
          {
            error: cause.message,
            inspect: await host.client.callTool({
              name: 'story_inspect',
              arguments: { sessionId: initialTarget.sessionId, detail: 'model' },
            }),
            visible: await scene
              .locator('main')
              .evaluate((root) => ({
                checkpoint: root.scene.capture(),
                state: root.scene.inspect(),
              }))
              .catch((error) => ({ error: error.message })),
            errors,
          },
          null,
          2,
        ),
      );
      throw cause;
    } finally {
      await browser.close();
      await host.close();
    }
  },
);
