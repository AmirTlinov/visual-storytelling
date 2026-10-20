import { validateStoryDocument } from '../dist/story/document.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { pluginHost } from './plugin/host.mjs';
import { finishFixtureJob } from './plugin/authoring-fixture.mjs';

const document = validateStoryDocument({
  recipe: 'division',
  id: 'division',
  inputs: { count: 11, divisor: 3 },
});

test(
  'partial subject becomes one saved live scene; atomic edits, retry, undo, reopen and production share its pin',
  { timeout: 120000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'story-live-authoring-'));
    const root = fileURLToPath(new URL('../', import.meta.url));
    const host = await pluginHost({
      dataDirectory: join(directory, 'data'),
      initialTarget: {},
      serverEntry: join(root, '.plugin-release/plugin/dist/server.mjs'),
    });
    const browser = await chromium.launch(chromiumLaunchOptions({ headless: true }));
    const page = await browser.newPage({ viewport: { width: 820, height: 850 } });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const call = async (name, args) => {
      const result = await host.client.callTool({ name, arguments: args });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      return result;
    };
    try {
      const invalidCreatePath = join(directory, 'invalid-project');
      const invalidCreate = await host.client.callTool({
        name: 'story_create',
        arguments: {
          title: 'Invalid references',
          path: invalidCreatePath,
          requestId: randomUUID(),
          document: {
            ...document,
            views: [{ id: 'objects', kind: 'groups', model: 'missing' }],
          },
        },
      });
      assert.equal(invalidCreate.isError, true);
      assert.ok(
        !(await readdir(directory)).includes('invalid-project'),
        'invalid document creates no project directory',
      );
      const registry = await readFile(join(directory, 'data/projects.json'), 'utf8').catch(
        (error) => {
          if (error.code !== 'ENOENT') throw error;
          return '[]';
        },
      );
      assert.ok(!JSON.parse(registry).some((entry) => entry.path === invalidCreatePath));
      await page.goto(host.url);
      await page.waitForFunction(() => Boolean(window.pluginTest));
      const app = page.frameLocator('iframe[title="MCP App"]');
      await app.locator('#catalog:not([hidden])').waitFor();
      await page.evaluate((document) => window.pluginTest.partial({ document }), {
        recipe: 'division',
        inputs: { count: 11, divisor: 3 },
      });
      await app.locator('#scene[data-provisional="true"]').waitFor();
      await app.frameLocator('#scene').locator('svg').first().waitFor();
      const scene = page.frames().find((frame) => frame.url() === 'about:srcdoc');
      await scene.waitForFunction(() => Boolean(document.querySelector('main')?.scene?.authoring));
      await scene.evaluate(() => {
        window.initialScene = document.querySelector('main').scene;
      });
      await page.evaluate((document) => window.pluginTest.partial({ document }), {
        ...document,
        models: [{ ...document.models[0], inputs: { ...document.models[0].inputs, divisor: 0 } }],
      });
      assert.equal(
        await scene.evaluate(() => window.initialScene.authoring.document.models[0].inputs.divisor),
        3,
      );
      const request = {
        title: 'Остаток от деления',
        path: join(directory, 'project'),
        document,
        requestId: randomUUID(),
      };
      request.document = { recipe: 'division', inputs: { count: 11, divisor: 3 } };
      const started = performance.now();
      const created = await call('story_create', request);
      const creationMs = performance.now() - started;
      assert.equal(
        created.structuredContent.job,
        undefined,
        'prepared creation has no compilation job',
      );
      assert.equal(created.structuredContent.authoring, 'ready');
      const project = created.structuredContent.project;
      assert.ok(project.files['scene-runtime.json']);
      assert.equal(project.files['package-lock.json'], undefined);
      assert.ok(!Object.keys(project.files).some((file) => file.endsWith('.tgz')));
      assert.deepEqual(
        (await call('story_create', request)).structuredContent,
        created.structuredContent,
      );
      const closedEdit = await host.client.callTool({
        name: 'story_edit',
        arguments: {
          context: project.context,
          requestId: randomUUID(),
          operations: [{ op: 'set-inputs', modelId: 'division', values: { count: 12 } }],
        },
      });
      assert.equal(closedEdit.isError, true);
      assert.match(JSON.stringify(closedEdit), /story_open/);
      assert.equal(
        (await call('story_inspect', { projectId: project.id })).structuredContent.sourceRevision,
        project.sourceRevision,
        'semantic editing requires a ready owner before any source write',
      );
      await page.evaluate((result) => window.pluginTest.result(result), created);
      await app.locator('html[data-connection="connected"]').waitFor();
      assert.ok(page.frames().includes(scene), 'confirmation reuses the provisional iframe');
      assert.equal(
        await scene.evaluate(() => document.querySelector('main').scene === window.initialScene),
        true,
      );
      let current = project;
      const latencies = [];
      const edit = async (count) => {
        const args = {
          context: current.context,
          requestId: randomUUID(),
          operations: [{ op: 'set-inputs', modelId: 'division', values: { count } }],
        };
        const start = performance.now();
        const changed = (await call('story_edit', args)).structuredContent;
        latencies.push(performance.now() - start);
        current = changed.project;
        assert.equal(changed.shown.length, 1);
        assert.equal(changed.shown[0].acknowledgement, 'rendered', JSON.stringify(changed));
        assert.equal(changed.shown[0].shownSourceRevision, current.sourceRevision);
        assert.ok(page.frames().includes(scene));
        assert.equal(
          await scene.evaluate(() => document.querySelector('main').scene === window.initialScene),
          true,
        );
        return { args, changed };
      };
      const first = await edit(14);
      await edit(17);
      const retry = (await call('story_edit', first.args)).structuredContent;
      assert.deepEqual(
        retry,
        first.changed,
        'retry returns the original accepted receipt after a later edit',
      );
      assert.equal(
        await scene.evaluate(() => window.initialScene.authoring.document.models[0].inputs.count),
        17,
      );
      const frameUI = app.frameLocator('#scene');
      await frameUI.getByRole('button', { name: 'Исследовать', exact: true }).click();
      const incrementCount = frameUI.getByRole('button', {
        name: 'Увеличить: Предметов',
        exact: true,
      });
      if (!(await incrementCount.isVisible()))
        await frameUI.getByRole('button', { name: 'Условия', exact: true }).click();
      await incrementCount.click();
      await frameUI.getByRole('button', { name: 'Увеличить: В группе', exact: true }).click();
      assert.equal(await scene.evaluate(() => window.initialScene.snapshot().count), 18);
      assert.equal(await scene.evaluate(() => window.initialScene.snapshot().divisor), 4);
      const beforeExplicit = current.sourceRevision;
      await edit(17);
      assert.equal(
        current.sourceRevision,
        beforeExplicit,
        'setting the same source value creates no file revision',
      );
      assert.equal(
        await scene.evaluate(() => window.initialScene.snapshot().count),
        17,
        'explicit count replaces the viewer experiment even when it equals the source default',
      );
      assert.equal(
        await scene.evaluate(() => window.initialScene.snapshot().divisor),
        4,
        'an untouched viewer condition survives the same operation',
      );
      const invalid = await host.client.callTool({
        name: 'story_edit',
        arguments: {
          context: current.context,
          requestId: randomUUID(),
          operations: [{ op: 'set-inputs', modelId: 'missing', values: { count: 9 } }],
        },
      });
      assert.equal(invalid.isError, true);
      assert.equal(
        (await call('story_inspect', { projectId: project.id })).structuredContent.sourceRevision,
        current.sourceRevision,
      );
      assert.equal(
        await scene.evaluate(() => window.initialScene.authoring.document.models[0].inputs.count),
        17,
      );
      const beforeInvalidLayout = await readFile(join(project.path, 'story.json'), 'utf8');
      const invalidLayout = await host.client.callTool({
        name: 'story_edit',
        arguments: {
          context: current.context,
          requestId: randomUUID(),
          operations: [
            {
              op: 'set-chapters',
              chapters: [
                {
                  id: 'experience',
                  title: 'Layout preflight',
                  beats: [
                    { id: 'start', operation: { model: 'division', name: 'gather' } },
                    {
                      id: 'future-caption',
                      operation: { model: 'division', name: 'group' },
                      text: 'W'.repeat(90),
                    },
                  ],
                },
              ],
            },
          ],
        },
      });
      assert.equal(invalidLayout.isError, true, 'future captions are checked before committing');
      assert.equal(await readFile(join(project.path, 'story.json'), 'utf8'), beforeInvalidLayout);
      assert.equal(
        (await call('story_inspect', { projectId: project.id })).structuredContent.sourceRevision,
        current.sourceRevision,
      );
      assert.equal(
        await scene.evaluate(() => window.initialScene.authoring.document.models[0].inputs.count),
        17,
      );
      const undone = (
        await call('story_edit', {
          context: current.context,
          requestId: randomUUID(),
          undo: true,
        })
      ).structuredContent;
      current = undone.project;
      assert.equal(undone.shown[0].acknowledgement, 'rendered');
      assert.equal(
        await scene.evaluate(() => window.initialScene.authoring.document.models[0].inputs.count),
        14,
      );
      const pin = JSON.parse(await readFile(join(project.path, 'scene-runtime.json'), 'utf8'));
      const metrics = await app.locator('body').evaluate(() => window.__visualStoryCreationMetrics);
      assert.ok(metrics.firstContentAt >= metrics.inputAt);
      assert.ok(metrics.confirmedAt >= metrics.firstContentAt);
      await page.evaluate(() => window.pluginTest.remount());
      await app.locator('html[data-connection="connected"]').waitFor();
      const reopened = await call('story_inspect', {
        sessionId: created.structuredContent.sessionId,
        detail: 'model',
      });
      assert.equal(reopened.structuredContent.shownSourceRevision, current.sourceRevision);
      const produced = (
        await call('story_produce', {
          target: {
            kind: 'build',
            context: reopened.structuredContent.context,
          },
          requestId: randomUUID(),
          options: { formats: ['html', 'source'], conditions: 'authored' },
        })
      ).structuredContent;
      const released = await finishFixtureJob(host.client, produced.id);
      assert.ok(released.result.files.some((file) => file.endsWith('source.tar.gz')));
      assert.ok(released.result.files.some((file) => file.endsWith('story.html')));
      assert.deepEqual(
        JSON.parse(await readFile(join(project.path, 'scene-runtime.json'), 'utf8')),
        pin,
      );
      assert.ok(
        !(await readdir(project.path)).includes('dependencies'),
        'production does not mutate the working pin',
      );
      assert.deepEqual(errors, []);
      t.diagnostic(
        JSON.stringify({ creationMs, semanticObservedMs: latencies, creationMetrics: metrics }),
      );
    } finally {
      await browser.close();
      await host.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
