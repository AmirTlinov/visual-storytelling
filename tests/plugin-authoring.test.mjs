import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, mkdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { pluginHost } from './plugin/host.mjs';

test(
  'installed release completes silent authoring, local narration, cancel/retry, file reopening and portable delivery',
  { timeout: 300000 },
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
      const deadline = Date.now() + 150000;
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
      await app.locator('#settings').click();
      await app.locator('input[name="cacheLimitMB"]').fill('1024');
      await app.locator('#preferences button[type="submit"]').click();
      await app.locator('#preferences').waitFor({ state: 'hidden' });
      assert.equal((await call('story_preferences', {})).structuredContent.cacheLimitMB, 1024);
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
      const help = await call('story_help', { projectId: project.id, query: 'SceneHandle' });
      assert.match(JSON.stringify(help.structuredContent), /SceneHandle/);
      const voiceList = (await call('story_voice', { projectId: project.id })).structuredContent;
      assert.equal(voiceList.ready, true);
      assert.ok(voiceList.voices.length);
      const narrated = await call('story_voice', {
        projectId: project.id,
        sourceRevision: undone.structuredContent.project.sourceRevision,
        requestId: randomUUID(),
        enabled: true,
        voice: voiceList.voices[0].id,
      });
      await finish(narrated.structuredContent.job.id);
      await app.frameLocator('#scene').locator('audio:not([muted])').waitFor({ state: 'attached' });
      const narration = (
        await call('story_inspect', { projectId: project.id, file: 'narration.json' })
      ).structuredContent;
      const script = JSON.parse(narration.content);
      script.segments.at(-1).text += ' Теперь проверьте свой вариант.';
      const spokenEdit = await call('story_edit', {
        projectId: project.id,
        sourceRevision: narrated.structuredContent.project.sourceRevision,
        requestId: randomUUID(),
        changes: [{ path: 'narration.json', content: JSON.stringify(script, null, 2) }],
      });
      await finish(spokenEdit.structuredContent.job.id);
      assert.equal(
        (await readdir(join(directory, 'data/speech'))).length,
        script.segments.length + 1,
        'only the changed phrase adds a synthesized take',
      );
      const produced = await call('story_produce', {
        projectId: project.id,
        sourceRevision: spokenEdit.structuredContent.project.sourceRevision,
        requestId: randomUUID(),
        options: { formats: ['html', 'source', 'mp4', 'srt'], width: 640, fps: 12 },
      });
      await call('story_cancel', { jobId: produced.structuredContent.id });
      let stopped;
      do {
        await delay(100);
        stopped = (await call('story_inspect', { jobId: produced.structuredContent.id }))
          .structuredContent;
      } while (stopped.status === 'cancelling');
      assert.equal(stopped.status, 'cancelled');
      const resumed = await call('story_retry', { jobId: stopped.id, requestId: randomUUID() });
      const job = await finish(resumed.structuredContent.id);
      assert.equal(job.result.files.length, 4);
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
      assert.ok(
        media.streams.some((s) => s.codec_type === 'audio'),
        'export includes actual narration',
      );
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
      const source = join(directory, 'restored');
      await mkdir(source);
      await promisify(execFile)('tar', [
        '-xzf',
        job.result.files.find((p) => p.endsWith('.tar.gz')),
        '-C',
        source,
      ]);
      const manifest = await readFile(join(source, 'source/story.vstory'), 'utf8');
      await page.context().setOffline(false);
      await page.evaluate(({ uri, text }) => window.pluginTest.openFile(uri, text), {
        uri: pathToFileURL(join(source, 'source/story.vstory')).href,
        text: manifest,
      });
      await app.locator('#connection').filter({ hasText: 'Готово' }).waitFor();
      await app
        .frameLocator('#scene')
        .getByText('Одна клетка — один шаг', { exact: true })
        .waitFor();
      let copied;
      for (let attempt = 0; attempt < 80 && !copied; attempt++) {
        copied = (await call('story_help', {})).structuredContent.projects.find((p) =>
          p.path.endsWith('/restored/source'),
        );
        if (!copied) await delay(100);
      }
      assert.ok(copied, 'the restored archive is an independent editable project');
      assert.notEqual(copied.id, project.id);
      assert.equal(
        (await call('story_inspect', {})).structuredContent.sessions.find(
          (s) => s.sessionId === sessionId,
        ).sessionId,
        sessionId,
      );
    } finally {
      await browser.close();
      await host.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
