import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { pluginHost } from './plugin/host.mjs';
import { deliver } from '../tools/deliver.mjs';

test(
  'release uses the shown revision, current frame and explicit working choice through real jobs',
  { timeout: 180000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'story-release-'));
    const data = join(directory, 'data');
    const host = await pluginHost({ dataDirectory: data });
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 820, height: 900 } });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const call = async (name, args) => {
      const result = await host.client.callTool({ name, arguments: args });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      return result;
    };
    const finish = async (id) => {
      const until = Date.now() + 60000;
      while (Date.now() < until) {
        const { structuredContent: job } = await call('story_inspect', { jobId: id });
        if (!['running', 'queued', 'cancelling'].includes(job.status)) {
          assert.equal(job.status, 'succeeded', JSON.stringify(job));
          return job.result;
        }
        await delay(100);
      }
      throw new Error('Release job deadline');
    };
    const original = host.client.callTool.bind(host.client);
    let release;
    host.client.callTool = async (request, ...options) => {
      const result = await original(request, ...options);
      if (request.name === 'story_produce') release = { request: request.arguments, result };
      return result;
    };
    try {
      await page.goto(host.url);
      const app = page.frameLocator('iframe[title="MCP App"]');
      await app.locator('#connection').filter({ hasText: 'Готово' }).waitFor();
      const created = await call('story_create', {
        title: 'Выбранная редакция',
        example: 'explorer-svg',
        path: join(directory, 'project'),
        requestId: randomUUID(),
      });
      await page.evaluate((result) => window.pluginTest.openResult(result), created);
      await finish(created.structuredContent.job.id);
      await app.locator('#connection').filter({ hasText: 'Готово' }).waitFor();
      const { project, sessionId } = created.structuredContent;
      await app.locator('#voice').click();
      await app.locator('#voice-choice').selectOption('higgs:higgs');
      assert.equal(
        await app.locator('#voice-choice option[value="higgs:higgs"]').isDisabled(),
        false,
      );
      assert.match(
        await app.locator('#voice-status').innerText(),
        /12 ГБ загрузки.*18 ГБ на диске/,
      );
      await app.locator('#voice-close').click();
      const inspect = async () => (await call('story_inspect', { sessionId })).structuredContent;
      const before = await inspect();
      await call('story_control', {
        sessionId,
        buildRevision: before.buildRevision,
        stateRevision: before.stateRevision,
        requestId: randomUUID(),
        commands: [
          { type: 'mode', value: 'explore' },
          { type: 'parameters', values: { x: -2, y: 1 } },
        ],
      });
      const scene = page.frames().find((frame) => frame.url() === 'about:srcdoc');
      const selected = await scene.evaluate(() => ({
        checkpoint: document.querySelector('.ve-scene').scene.capture(),
        width: innerWidth,
        height: innerHeight,
      }));
      const area = await scene.locator('.ve-stage').boundingBox();
      const screenshots = await page.context().newCDPSession(page);
      const displayed = Buffer.from(
        (
          await screenshots.send('Page.captureScreenshot', {
            format: 'png',
            fromSurface: true,
            captureBeyondViewport: false,
            optimizeForSpeed: true,
            clip: { ...area, scale: 1 },
          })
        ).data,
        'base64',
      );
      const produce = async () => {
        release = undefined;
        await app.locator('[data-format="html"]').click();
        await app.locator('#release-options').waitFor({ state: 'hidden' });
        assert.equal(release.result.isError, undefined, JSON.stringify(release));
        return finish(release.result.structuredContent.id);
      };
      await app.locator('#release').click();
      await app.locator('#release-current').check();
      const captured = await produce();
      assert.equal(release.request.target.buildRevision, before.buildRevision);
      const receipt = JSON.parse(await readFile(join(captured.directory, 'delivery.json'), 'utf8'));
      assert.deepEqual(receipt.checkpoint, JSON.parse(JSON.stringify(selected.checkpoint)));
      const standalone = await browser.newPage({
        viewport: { width: selected.width, height: selected.height },
      });
      await standalone.goto(
        pathToFileURL(captured.files.find((file) => file.endsWith('.html'))).href,
      );
      await standalone.evaluate(() => window.galleryReady);
      assert.deepEqual(
        await standalone.evaluate(() => document.querySelector('.ve-scene').scene.capture().values),
        selected.checkpoint.values,
      );
      await standalone.close();

      // The image path delegates to the existing renderer with exactly the captured conditions.
      const built = JSON.parse(
        await readFile(join(data, 'builds', before.buildRevision + '.json'), 'utf8'),
      );
      const images = await deliver(built.snapshot, {
        out: join(directory, 'images'),
        formats: ['png', 'svg'],
        prepared: { ...built, directory: join(built.snapshot, 'dist') },
        checkpoint: selected.checkpoint,
        width: selected.width,
        height: selected.height,
        silent: true,
      });
      const svg = await readFile(join(images.directory, 'story.svg'), 'utf8');
      assert.match(svg, /\(-2; 1\)/);
      const actual = await sharp(join(images.directory, 'story.png'))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const expected = await sharp(displayed)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      assert.deepEqual(actual.info, expected.info, 'PNG keeps the displayed frame dimensions');
      const difference =
        actual.data.reduce((sum, value, index) => sum + Math.abs(value - expected.data[index]), 0) /
        actual.data.length;
      assert.ok(
        difference < 1,
        `PNG matches the displayed selected frame (mean channel difference ${difference})`,
      );

      const current = await inspect();
      await call('story_control', {
        sessionId,
        buildRevision: current.buildRevision,
        stateRevision: current.stateRevision,
        requestId: randomUUID(),
        commands: [{ type: 'rate', value: 0.25 }, { type: 'play' }],
      });
      const file = (await call('story_inspect', { projectId: project.id, file: 'scene.js' }))
        .structuredContent;
      const edited = await call('story_edit', {
        projectId: project.id,
        sourceRevision: before.sourceRevision,
        requestId: randomUUID(),
        changes: [
          {
            path: 'scene.js',
            content: file.content.replace('Одна клетка — один шаг', 'Latest working revision'),
          },
        ],
      });
      await finish(edited.structuredContent.job.id);
      await app.locator('#update').waitFor();
      assert.equal((await inspect()).buildRevision, before.buildRevision);
      await app.locator('#release').click();
      await app.locator('#release-current').uncheck();
      const shown = await produce();
      assert.equal(shown.sourceRevision, before.sourceRevision);
      assert.equal(
        (await readFile(shown.files[0], 'utf8')).includes('Latest working revision'),
        false,
      );
      const archiveJob = await call('story_produce', {
        target: { kind: 'build', projectId: project.id, buildRevision: before.buildRevision },
        requestId: randomUUID(),
        options: { formats: ['source'] },
      });
      const archived = await finish(archiveJob.structuredContent.id);
      const { stdout: archivedScene } = await promisify(execFile)('tar', [
        '-xOf',
        archived.files.find((file) => file.endsWith('.tar.gz')),
        'source/scene.js',
      ]);
      assert.equal(archived.sourceRevision, before.sourceRevision);
      assert.equal(archivedScene.includes('Latest working revision'), false);
      await app.locator('#release').click();
      await app.locator('#release-version').selectOption('working');
      assert.equal(await app.locator('#release-current').isDisabled(), true);
      const working = await produce();
      assert.equal(working.sourceRevision, edited.structuredContent.project.sourceRevision);
      assert.equal(
        (await readFile(working.files[0], 'utf8')).includes('Latest working revision'),
        true,
      );
      await page.setViewportSize({ width: 360, height: 780 });
      await app.locator('#release').click();
      await app.locator('#release-version').focus();
      await app.locator('#release-version').press('ArrowUp');
      assert.equal(
        await app.locator('html').evaluate((element) => element.scrollWidth <= innerWidth),
        true,
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await host.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
