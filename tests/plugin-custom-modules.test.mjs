import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { pluginHost } from './plugin/host.mjs';
import { finishFixtureJob } from './plugin/authoring-fixture.mjs';
async function files(directory, root = directory) {
  const changes = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) changes.push(...(await files(path, root)));
    else changes.push({ path: relative(root, path), content: await readFile(path, 'utf8') });
  }
  return changes;
}
test(
  'installed custom modules use create/edit/semantic undo/reopen/HTML and reject failed candidates atomically',
  { timeout: 120000 },
  async (t) => {
    const temporary = await mkdtemp(join(tmpdir(), 'plugin-custom-modules-'));
    const release = process.env.VISUAL_STORY_RELEASE ?? join(process.cwd(), '.plugin-release');
    const host = await pluginHost({
      dataDirectory: join(temporary, 'data'),
      initialTarget: {},
      serverEntry: join(release, 'plugin/dist/server.mjs'),
    });
    const browser = await chromium.launch(chromiumLaunchOptions());
    t.after(async () => {
      await browser.close();
      await host.close();
      await rm(temporary, { recursive: true, force: true });
    });
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    page.setDefaultTimeout(15000);
    const call = async (name, args) => {
      const r = await host.client.callTool({ name, arguments: args });
      assert.equal(r.isError, undefined, JSON.stringify(r));
      return r;
    };
    const created = await call('story_create', {
      title: 'Проверяем независимый маршрут',
      document: {
        recipe: 'dependency-route',
        inputs: { orderId: '417', reserve: 'none' },
        chapters: [],
      },
      requestId: randomUUID(),
    });
    await page.goto(host.url);
    await page.waitForFunction(() => Boolean(window.pluginTest));
    await page.evaluate((result) => window.pluginTest.result(result), created);
    const app = page.frameLocator('iframe[title="MCP App"]');
    await app.locator('html[data-connection="connected"]').waitFor();
    let project = created.structuredContent.project;
    const edit = async (changes) => {
      const r = (
        await call('story_edit', { context: project.context, requestId: randomUUID(), changes })
      ).structuredContent;
      const job = await finishFixtureJob(host.client, r.job.id);
      project = job.result.project;
      return job;
    };
    await edit(await files(join(process.cwd(), 'tools/document-modules/route')));
    const snapshot = () =>
      app
        .frameLocator('#scene')
        .locator('main')
        .evaluate((root) => root.scene.snapshot());
    await assertEventually(async () => (await snapshot()).blocked === 'warehouse');
    const edited = (
      await call('story_edit', {
        context: project.context,
        requestId: randomUUID(),
        operations: [{ op: 'set-inputs', modelId: 'delivery', values: { reserve: 'independent' } }],
      })
    ).structuredContent;
    project = edited.project;
    assert.equal(edited.delivery, 'shown');
    assert.equal((await snapshot()).status, 'delivered');
    const before = project.sourceRevision;
    const failed = (
      await call('story_edit', {
        context: project.context,
        requestId: randomUUID(),
        changes: [
          {
            path: 'modules/model.ts',
            content: "throw new Error('invalid authored module');\nexport default {};\n",
          },
        ],
      })
    ).structuredContent;
    const failedJob = (await call('story_inspect', { jobId: failed.job.id, waitMs: 15000 }))
      .structuredContent;
    assert.equal(failedJob.status, 'failed', JSON.stringify(failedJob));
    const working = (await call('story_inspect', { context: project.context, scope: 'working' }))
      .structuredContent;
    assert.equal(working.sourceRevision, before);
    assert.equal((await snapshot()).status, 'delivered');
    const invalid = await host.client.callTool({
      name: 'story_edit',
      arguments: {
        context: project.context,
        requestId: randomUUID(),
        operations: [{ op: 'set-inputs', modelId: 'delivery', values: { 'disabled-home': 1 } }],
      },
    });
    assert.equal(invalid.isError, true);
    assert.equal((await snapshot()).status, 'delivered');
    const undo = (
      await call('story_edit', { context: project.context, requestId: randomUUID(), undo: true })
    ).structuredContent;
    project = undo.project;
    assert.equal(undo.delivery, 'shown');
    assert.equal((await snapshot()).blocked, 'warehouse');
    await page.evaluate(() => window.pluginTest.remount());
    await app.locator('html[data-connection="connected"]').waitFor();
    await assertEventually(async () => (await snapshot()).blocked === 'warehouse');
    const produced = (
      await call('story_produce', {
        target: { kind: 'working', context: project.context },
        requestId: randomUUID(),
        options: { formats: ['html'] },
      })
    ).structuredContent;
    const result = await finishFixtureJob(host.client, produced.id);
    assert.ok(result.result.files.some((file) => file.endsWith('.html')));
    assert.equal(await app.frameLocator('#scene').locator('[data-parcel]').count(), 1);
    t.diagnostic(
      JSON.stringify({
        plugin: JSON.parse(await readFile(join(release, 'plugin.json'), 'utf8')).version,
        project: project.id,
        sourceRevision: project.sourceRevision,
        html: result.result.files,
      }),
    );
  },
);
async function assertEventually(check) {
  for (let i = 0; i < 40; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail('The accepted module frame did not appear.');
}
