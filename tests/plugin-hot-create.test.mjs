import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { pluginHost } from './plugin/host.mjs';
import { ProjectStore } from '../plugin/projects.mjs';
import { validateExplanation } from '../dist/explanation/document.js';

test(
  'MCP reconnect resumes a reserved creation before its manifest without a second project',
  { timeout: 30000 },
  async (t) => {
    for (const explicit of [false, true])
      await t.test(explicit ? 'explicit path' : 'implicit path', async () => {
        const temporary = await mkdtemp(join(tmpdir(), 'story-hot-reservation-'));
        const dataDirectory = join(temporary, 'data');
        const path = join(temporary, 'reserved');
        const explanation = { model: { kind: 'division', count: 13, divisor: 3 } };
        const request = {
          title: 'Reserved creation',
          requestId: randomUUID(),
          explanation,
          ...(explicit ? { path } : {}),
        };
        const store = new ProjectStore(dataDirectory);
        const input = {
          title: request.title,
          explanation: validateExplanation(explanation),
          ...(explicit ? { path } : {}),
        };
        const remember = store.remember.bind(store);
        store.remember = async (record) => {
          await remember(record);
          throw new Error('interrupted after reservation');
        };
        await assert.rejects(
          store.create(path, {
            title: request.title,
            creation: { requestId: request.requestId, input },
          }),
          /interrupted after reservation/,
        );
        const reserved = store.creation(request.requestId);
        await assert.rejects(readdir(path), { code: 'ENOENT' });
        const root = fileURLToPath(new URL('../', import.meta.url));
        const host = await pluginHost({
          dataDirectory,
          initialTarget: {},
          serverEntry: join(root, '.plugin-release/plugin/dist/server.mjs'),
        });
        try {
          const conflicting = await host.client.callTool({
            name: 'story_create',
            arguments: { ...request, title: 'Changed' },
          });
          assert.equal(conflicting.isError, true);
          assert.match(conflicting.content[0].text, /requestId/);
          const result = await host.client.callTool({ name: 'story_create', arguments: request });
          assert.equal(result.isError, undefined, JSON.stringify(result));
          assert.equal(result.structuredContent.project.id, reserved.id);
          assert.equal(result.structuredContent.project.path, reserved.path);
          assert.equal(result.structuredContent.authoring, 'ready');
          const repeated = await host.client.callTool({ name: 'story_create', arguments: request });
          assert.deepEqual(repeated.structuredContent, result.structuredContent);
          const projects = JSON.parse(await readFile(join(dataDirectory, 'projects.json'), 'utf8'));
          assert.equal(projects.length, 1);
          assert.equal(projects[0].creation.sessionId, result.structuredContent.sessionId);
          assert.equal((await readdir(join(dataDirectory, 'sessions'))).length, 1);
          assert.equal(
            JSON.parse(await readFile(join(path, 'story.vstory'), 'utf8')).id,
            reserved.id,
          );
        } finally {
          await host.close();
          await rm(temporary, { recursive: true, force: true });
        }
      });
  },
);

test('queued project metadata updates preserve a terminal creation delivery and unrelated metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-creation-registry-'));
  try {
    const store = new ProjectStore(directory);
    await store.start();
    const id = randomUUID();
    await store.remember({
      id,
      path: directory,
      buildRevision: 'initial',
      creation: {
        requestId: 'hot-create-registry',
        input: { sessionId: randomUUID() },
        delivery: { result: { delivery: 'pending', shown: [] } },
      },
    });
    let release;
    store.registrySave = new Promise((resolve) => {
      release = resolve;
    });
    const shown = store.update(id, (current) => ({
      creation: {
        ...current.creation,
        delivery: { result: { delivery: 'shown', shown: [{ sessionId: 'observed' }] } },
      },
    }));
    const metadata = store.update(id, { buildRevision: 'new-build', lastSessionId: 'new-session' });
    release();
    await Promise.all([shown, metadata]);
    const expected = store.get(id);
    assert.equal(expected.creation.delivery.result.delivery, 'shown');
    assert.equal(expected.buildRevision, 'new-build');
    assert.equal(expected.lastSessionId, 'new-session');
    const restored = new ProjectStore(directory);
    await restored.start();
    assert.deepEqual(restored.get(id), expected);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  'create navigates the ready card once, keeps receipts and resumes a closed-card failure',
  { timeout: 90000 },
  async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'story-hot-create-'));
    const dataDirectory = join(temporary, 'data');
    const root = fileURLToPath(new URL('../', import.meta.url));
    const host = await pluginHost({
      dataDirectory,
      initialTarget: {},
      serverEntry: join(root, '.plugin-release/plugin/dist/server.mjs'),
    });
    const browser = await chromium.launch(chromiumLaunchOptions({ headless: true }));
    const call = async (name, args = {}) => {
      const result = await host.client.callTool({ name, arguments: args });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      return result;
    };
    const inspect = async (sessionId) =>
      (await call('story_inspect', { sessionId })).structuredContent;
    const waitConnected = (sessionId) =>
      until(async () => {
        const result = await host.client.callTool({
          name: 'story_inspect',
          arguments: { sessionId },
        });
        if (result.isError && result.structuredContent?.error?.code === 'view_closed') return false;
        assert.equal(result.isError, undefined, JSON.stringify(result));
        return result.structuredContent.status === 'connected';
      });
    const create = (title, count, sessionId) => ({
      title,
      path: join(temporary, title),
      requestId: randomUUID(),
      explanation: { model: { kind: 'division', count, divisor: 3 } },
      ...(sessionId && { sessionId }),
    });
    try {
      const page = await browser.newPage();
      await page.goto(host.url);
      const app = page.frameLocator('iframe[title="MCP App"]');
      await app.locator('#catalog:not([hidden])').waitFor();
      const original = await call('story_create', create('Original', 13));
      const originalId = original.structuredContent.sessionId;
      await page.evaluate((result) => window.pluginTest.result(result), original);
      await waitConnected(originalId);
      let before = await inspect(originalId);
      await call('story_control', {
        sessionId: originalId,
        buildRevision: before.buildRevision,
        stateRevision: before.stateRevision,
        requestId: randomUUID(),
        commands: [{ type: 'pause' }, { type: 'seek', time: 6 }, { type: 'rate', value: 0.75 }],
      });
      before = await inspect(originalId);
      const renderer = before.presentationMetrics.current.renderer;
      await app.locator('body').evaluate(() => {
        window.hotCardIdentity = 'original-app';
      });
      const request = create('Next', 17, originalId);
      const next = await call('story_create', request);
      const nextId = next.structuredContent.sessionId;
      assert.equal(next.structuredContent.presentation.kind, 'existing-card');
      assert.ok(['pending', 'prepared', 'shown'].includes(next.structuredContent.delivery));
      // Native hosts can also deliver the result to the original resource; its poll owns navigation.
      await page.evaluate((result) => window.pluginTest.result(result), next);
      await waitConnected(nextId);
      let current = await inspect(nextId);
      assert.equal(current.presentationMetrics.current.renderer, renderer);
      assert.equal(
        await app.locator('body').evaluate(() => window.hotCardIdentity),
        'original-app',
      );
      assert.equal(current.state.parameters.find((item) => item.key === 'count').value, 17);
      assert.equal((await call('story_inspect')).structuredContent.sessions.length, 2);
      const repeated = await call('story_create', request);
      assert.equal(repeated.structuredContent.delivery, 'shown');
      assert.equal(repeated.structuredContent.project.id, next.structuredContent.project.id);
      assert.equal(
        repeated.structuredContent.sourceRevision,
        next.structuredContent.sourceRevision,
      );
      assert.equal(repeated.structuredContent.sessionId, nextId);
      assert.equal(
        (await readdir(join(dataDirectory, 'sessions'))).filter((name) => name.endsWith('.json'))
          .length,
        2,
      );
      const wrongTarget = await host.client.callTool({
        name: 'story_create',
        arguments: { ...request, sessionId: nextId },
      });
      assert.equal(wrongTarget.isError, true);
      // A ready destination remains authorable through its own existing revision path.
      await call('story_edit', {
        projectId: next.structuredContent.project.id,
        sourceRevision: next.structuredContent.sourceRevision,
        requestId: randomUUID(),
        operations: [{ op: 'set-inputs', modelId: 'division', values: { count: 18 } }],
      });
      assert.equal(
        (await inspect(nextId)).state.parameters.find((item) => item.key === 'count').value,
        18,
      );
      const failedRequest = create('Closed-target', 21, originalId);
      const failed = await call('story_create', failedRequest);
      assert.equal(failed.structuredContent.delivery, 'failed');
      assert.equal(failed.structuredContent.error.code, 'view_closed');
      const failedId = failed.structuredContent.sessionId;
      assert.equal(
        (await call('story_inspect')).structuredContent.sessions.find(
          (s) => s.sessionId === failedId,
        ).generation,
        0,
      );
      await call('story_navigate', { sessionId: nextId, back: true });
      await waitConnected(originalId);
      const returned = await inspect(originalId);
      assert.equal(returned.state.time, before.state.time);
      assert.equal(returned.state.rate, before.state.rate);
      assert.equal(returned.state.playing, false);
      // A completed retry is historical; it cannot navigate away after Back or replay old sources.
      assert.deepEqual(
        (await call('story_create', request)).structuredContent,
        repeated.structuredContent,
      );
      assert.equal((await inspect(originalId)).status, 'connected');
      const resumed = await call('story_create', failedRequest);
      assert.equal(resumed.structuredContent.sessionId, failedId);
      assert.equal(resumed.structuredContent.project.id, failed.structuredContent.project.id);
      await waitConnected(failedId);
      assert.equal((await call('story_create', failedRequest)).structuredContent.delivery, 'shown');
      assert.equal((await call('story_inspect')).structuredContent.sessions.length, 3);
      const registry = JSON.parse(await readFile(join(dataDirectory, 'projects.json'), 'utf8'));
      assert.equal(registry.length, 3);
      assert.equal(
        registry.find((p) => p.id === failed.structuredContent.project.id).creation.input.sessionId,
        originalId,
      );
      for (const example of [undefined, 'gpt-model']) {
        const invalid = await host.client.callTool({
          name: 'story_create',
          arguments: {
            title: 'Unsupported',
            path: join(temporary, 'unsupported'),
            requestId: randomUUID(),
            sessionId: failedId,
            ...(example && { example }),
          },
        });
        assert.equal(invalid.isError, true);
      }
      assert.equal((await readdir(temporary)).includes('unsupported'), false);
      // A redundant unbound resource gets no partial scene and cannot attach the destination.
      const duplicate = await browser.newPage();
      await duplicate.goto(host.url);
      const duplicateApp = duplicate.frameLocator('iframe[title="MCP App"]');
      await duplicateApp.locator('#catalog:not([hidden])').waitFor();
      await duplicate.evaluate(() => {
        window.hotTeardownRequested = false;
        addEventListener('message', (event) => {
          if (event.data?.method === 'ui/notifications/request-teardown')
            window.hotTeardownRequested = true;
        });
      });
      await duplicate.evaluate((args) => window.pluginTest.partial(args), failedRequest);
      assert.equal(await duplicateApp.locator('#scene[data-provisional]').count(), 0);
      // Streaming may deliver a complete model before the optional target field.
      await duplicate.evaluate(
        (explanation) => window.pluginTest.partial({ explanation }),
        failedRequest.explanation,
      );
      await duplicateApp.locator('#scene[data-provisional="true"]').waitFor();
      await duplicate.evaluate((args) => window.pluginTest.partial(args), failedRequest);
      await duplicateApp.locator('#scene[data-provisional]').waitFor({ state: 'detached' });
      assert.equal(await duplicateApp.locator('#scene').getAttribute('srcdoc'), '');
      // The result must independently clear a preview, even if no later partial arrives.
      await duplicate.evaluate(
        (explanation) => window.pluginTest.partial({ explanation }),
        failedRequest.explanation,
      );
      await duplicateApp.locator('#scene[data-provisional="true"]').waitFor();
      await duplicate.evaluate((result) => window.pluginTest.result(result), resumed);
      await duplicate.waitForFunction(() => window.hotTeardownRequested);
      assert.equal(await duplicateApp.locator('#scene[data-provisional]').count(), 0);
      assert.equal(await duplicateApp.locator('#scene').getAttribute('srcdoc'), '');
      assert.equal(await duplicateApp.locator('#scene').isVisible(), false);
      assert.equal((await inspect(failedId)).generation, 1);
      await duplicate.close();
    } finally {
      await browser.close();
      await host.close();
      await rm(temporary, { recursive: true, force: true });
    }
  },
);

test(
  'prepared creation follows its remounted destination and rejects former renderer reports',
  { timeout: 45000 },
  async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'story-hot-remount-'));
    const dataDirectory = join(temporary, 'data');
    const root = fileURLToPath(new URL('../', import.meta.url));
    const host = await pluginHost({
      dataDirectory,
      initialTarget: {},
      serverEntry: join(root, '.plugin-release/plugin/dist/server.mjs'),
    });
    const browser = await chromium.launch(chromiumLaunchOptions({ headless: true }));
    const call = async (name, args = {}) => {
      const result = await host.client.callTool({ name, arguments: args });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      return result.structuredContent;
    };
    const session = async (id) =>
      (await call('story_inspect')).sessions.find((item) => item.sessionId === id);
    const waitConnected = (id) => until(async () => (await session(id))?.status === 'connected');
    try {
      const page = await browser.newPage();
      await page.addInitScript(() => {
        if (location.href !== 'about:srcdoc') return;
        const requestFrame = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = (callback) =>
          window.allowSceneFrames ? requestFrame(callback) : 0;
      });
      await page.goto(host.url);
      const app = page.frameLocator('iframe[title="MCP App"]');
      await app.locator('#catalog:not([hidden])').waitFor();
      const originalResult = await host.client.callTool({
        name: 'story_create',
        arguments: {
          title: 'Prepared original',
          path: join(temporary, 'original'),
          requestId: randomUUID(),
          explanation: { model: { kind: 'division', count: 13, divisor: 3 } },
        },
      });
      assert.equal(originalResult.isError, undefined);
      const originalId = originalResult.structuredContent.sessionId;
      await page.evaluate((result) => window.pluginTest.result(result), originalResult);
      await waitConnected(originalId);
      const request = {
        title: 'Prepared destination',
        path: join(temporary, 'destination'),
        requestId: randomUUID(),
        sessionId: originalId,
        explanation: { model: { kind: 'division', count: 17, divisor: 3 } },
      };
      const nextResult = await host.client.callTool({ name: 'story_create', arguments: request });
      assert.equal(nextResult.isError, undefined);
      const nextId = nextResult.structuredContent.sessionId;
      // Retain the destination ID in the SDK host for its resource remount.
      await page.evaluate((result) => window.pluginTest.result(result), nextResult);
      await waitConnected(nextId);
      const first = await session(nextId);
      assert.equal(first.renderStatus, 'prepared');
      assert.equal((await call('story_create', request)).delivery, 'prepared');
      await page.evaluate(() => window.pluginTest.remount());
      await waitConnected(nextId);
      const remounted = await session(nextId);
      const renderer = remounted.presentationMetrics.current.renderer;
      const oldRenderer = first.presentationMetrics.current.renderer;
      assert.notEqual(renderer, oldRenderer);
      assert.ok(remounted.generation > first.generation);
      assert.equal(remounted.renderStatus, 'prepared');
      assert.equal((await call('story_create', request)).delivery, 'prepared');
      const delivery = async () =>
        JSON.parse(await readFile(join(dataDirectory, 'projects.json'), 'utf8')).find(
          (project) => project.id === nextResult.structuredContent.project.id,
        ).creation.delivery;
      const rebound = await delivery();
      assert.equal(rebound.renderer, renderer);
      assert.equal(rebound.generation, remounted.generation);
      for (const owner of [
        { renderer: oldRenderer, generation: first.generation },
        { renderer, generation: first.generation },
      ]) {
        const stale = await host.client.callTool({
          name: 'story_view',
          arguments: {
            action: 'exchange',
            sessionId: nextId,
            ...owner,
            wait: false,
            report: {
              stateRevision: remounted.stateRevision + 1,
              state: {},
              checkpoint: { time: 0, progress: 0, mode: 'story', values: {} },
              renderStatus: 'rendered',
            },
          },
        });
        assert.equal(stale.isError, true);
        assert.equal(stale.structuredContent.error.code, 'view_replaced');
        assert.deepEqual(await delivery(), rebound);
      }
      await app
        .frameLocator('#scene')
        .locator('body')
        .evaluate(() => {
          window.allowSceneFrames = true;
        });
      assert.equal((await call('story_inspect', { sessionId: nextId })).renderStatus, 'rendered');
      await until(async () => (await delivery()).result.delivery === 'shown');
      const completed = await call('story_create', request);
      assert.equal(completed.delivery, 'shown');
      assert.equal(completed.shown[0].generation, remounted.generation);
      await call('story_navigate', { sessionId: nextId, back: true });
      await waitConnected(originalId);
      assert.deepEqual(await call('story_create', request), completed);
      assert.equal((await session(originalId)).status, 'connected');
      assert.equal((await session(nextId)).status, 'closed');
    } finally {
      await browser.close();
      await host.close();
      await rm(temporary, { recursive: true, force: true });
    }
  },
);

async function until(predicate) {
  const deadline = performance.now() + 12000;
  while (!(await predicate())) {
    assert.ok(performance.now() < deadline, 'The ready frame was not observed.');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
