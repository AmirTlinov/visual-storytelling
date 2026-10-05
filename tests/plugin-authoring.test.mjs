import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { pluginHost } from './plugin/host.mjs';

test(
  'installed release creates, revises, undoes and exports one editable project while its scene stays open',
  { timeout: 180000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'story-authoring-'));
    const host = await pluginHost({
      dataDirectory: join(directory, 'data'),
      serverCommand: resolve('.plugin-release/runtime/node'),
      serverEntry: resolve('.plugin-release/plugin/dist/server.mjs'),
    });
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const call = async (name, args) => {
      const result = await host.client.callTool({ name, arguments: args });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      return result;
    };
    const finish = async (id) => {
      const deadline = Date.now() + 90000;
      while (Date.now() < deadline) {
        const { structuredContent: job } = await call('story_inspect', { jobId: id });
        if (['failed', 'cancelled', 'interrupted'].includes(job.status))
          throw new Error(JSON.stringify(job));
        if (job.status === 'succeeded') return job;
        await delay(250);
      }
      throw new Error('Authoring job deadline');
    };
    try {
      await page.goto(host.url);
      const app = page.frameLocator('iframe[title="MCP App"]');
      await app.locator('#connection').filter({ hasText: 'Готово' }).waitFor();
      const created = await call('story_create', {
        title: 'Перемещения',
        path: join(directory, 'lesson'),
        requestId: randomUUID(),
        example: 'explorer-svg',
      });
      await page.evaluate((result) => window.pluginTest.openResult(result), created);
      await finish(created.structuredContent.job.id);
      await app.locator('#connection').filter({ hasText: 'Готово' }).waitFor();
      const { project, sessionId } = created.structuredContent;
      const { structuredContent: before } = await call('story_inspect', { projectId: project.id });
      const { structuredContent: file } = await call('story_inspect', {
        projectId: project.id,
        file: 'scene.js',
      });
      const edited = await call('story_edit', {
        projectId: project.id,
        sourceRevision: before.sourceRevision,
        requestId: randomUUID(),
        changes: [
          {
            path: 'scene.js',
            content: file.content.replace('Одна клетка — один шаг', 'Проверенная авторская правка'),
          },
        ],
      });
      await finish(edited.structuredContent.job.id);
      await app
        .frameLocator('#scene')
        .getByText('Проверенная авторская правка', { exact: true })
        .waitFor();
      const shown = await call('story_inspect', { sessionId });
      assert.equal(
        shown.structuredContent.sourceRevision,
        edited.structuredContent.project.sourceRevision,
      );
      const conflict = await host.client.callTool({
        name: 'story_edit',
        arguments: {
          projectId: project.id,
          sourceRevision: before.sourceRevision,
          requestId: randomUUID(),
          changes: [{ path: 'scene.js', content: file.content }],
        },
      });
      assert.equal(conflict.isError, true);
      const undone = await call('story_edit', {
        projectId: project.id,
        sourceRevision: edited.structuredContent.project.sourceRevision,
        requestId: randomUUID(),
        undo: true,
      });
      await finish(undone.structuredContent.job.id);
      await app
        .frameLocator('#scene')
        .getByText('Одна клетка — один шаг', { exact: true })
        .waitFor();
      const produced = await call('story_produce', {
        projectId: project.id,
        sourceRevision: undone.structuredContent.project.sourceRevision,
        requestId: randomUUID(),
        options: { formats: ['html', 'source', 'mp4'], width: 640, fps: 12 },
      });
      const job = await finish(produced.structuredContent.id);
      assert.equal(job.result.files.length, 3);
      const video = job.result.files.find((p) => p.endsWith('.mp4'));
      const { stdout } = await promisify(execFile)('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_type,width:format=duration',
        '-of',
        'json',
        video,
      ]);
      const media = JSON.parse(stdout);
      assert.equal(media.streams.find((s) => s.codec_type === 'video').width, 640);
      assert.ok(Number(media.format.duration) > 1, 'the published video contains the story');
      const delivery = await browser.newPage();
      await delivery.context().setOffline(true);
      await delivery.goto(pathToFileURL(job.result.files.find((p) => p.endsWith('.html'))).href);
      await delivery.getByText('Одна клетка — один шаг', { exact: true }).waitFor();
      assert.equal(
        await delivery.getByText('Проверенная авторская правка', { exact: true }).count(),
        0,
      );
      await delivery.close();
      assert.equal(
        (await call('story_inspect', { sessionId })).structuredContent.sessionId,
        sessionId,
      );
    } finally {
      await browser.close();
      await host.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
