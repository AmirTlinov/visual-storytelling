import { chromiumLaunchOptions } from '../tools/chromium.mjs';
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
import { createProjectFixture } from './plugin/authoring-fixture.mjs';

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
    const browser = await chromium.launch(chromiumLaunchOptions({ headless: true }));
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
    let primaryError;
    try {
      await page.goto(host.url);
      const app = page.frameLocator('iframe[title="MCP App"]');
      await app.locator('html[data-connection="connected"]').waitFor();
      const connectHelp = await call('story_help', { query: 'connect' });
      assert.match(connectHelp.structuredContent.text, /function connect/);
      const preferences = await call('story_preferences', {});
      await page.evaluate((result) => window.pluginTest.openResult(result), preferences);
      await app.locator('input[name="cacheLimitMB"]').fill('1024');
      await app.locator('#preferences button[type="submit"]').click();
      await app.locator('#preferences').waitFor({ state: 'hidden' });
      assert.equal((await call('story_preferences', {})).structuredContent.cacheLimitMB, 1024);
      const created = await createProjectFixture(host.client, {
        title: 'Перемещения',
        path: join(directory, 'lesson'),
      });
      await finish(created.job.id);
      const opened = await call('story_open', { projectId: created.project.id });
      await page.evaluate((result) => window.pluginTest.openResult(result), opened);
      await app.locator('html[data-connection="connected"]').waitFor();
      const project = created.project,
        { sessionId } = opened.structuredContent;
      const { structuredContent: before } = await call('story_inspect', { projectId: project.id });
      const { structuredContent: file } = await call('story_inspect', {
        projectId: project.id,
        file: 'scene.js',
      });
      const initial = (await call('story_inspect', { sessionId })).structuredContent;
      await call('story_control', {
        context: initial.context,
        requestId: randomUUID(),
        commands: [{ type: 'rate', value: 0.25 }, { type: 'play' }],
      });
      const edited = await call('story_edit', {
        context: before.context,
        requestId: randomUUID(),
        changes: [
          {
            path: 'scene.js',
            content: file.content.replace('Одна клетка — один шаг', 'Проверенная авторская правка'),
          },
        ],
      });
      const editedProject = (await finish(edited.structuredContent.job.id)).result.project;
      await app.locator('#update').waitFor();
      const shownSource = (await call('story_inspect', { sessionId, file: 'scene.js' }))
        .structuredContent;
      assert.equal(
        shownSource.content,
        file.content,
        'the shown source stays bound to the playing build',
      );
      assert.equal(shownSource.shownSourceRevision, before.sourceRevision);
      assert.equal(shownSource.workingSourceRevision, editedProject.sourceRevision);
      await app.locator('#update').click();
      await app
        .frameLocator('#scene')
        .getByText('Проверенная авторская правка', { exact: true })
        .waitFor();
      const shown = await call('story_inspect', { sessionId });
      assert.equal(shown.structuredContent.sourceRevision, editedProject.sourceRevision);
      const conflict = await host.client.callTool({
        name: 'story_edit',
        arguments: {
          context: before.context,
          requestId: randomUUID(),
          changes: [{ path: 'scene.js', content: file.content }],
        },
      });
      assert.equal(conflict.isError, true);
      const undone = await call('story_edit', {
        context: editedProject.context,
        requestId: randomUUID(),
        undo: true,
      });
      const undoneProject = (await finish(undone.structuredContent.job.id)).result.project;
      await app
        .frameLocator('#scene')
        .getByText('Одна клетка — один шаг', { exact: true })
        .waitFor();
      const help = await call('story_help', { projectId: project.id, query: 'SceneHandle' });
      assert.match(JSON.stringify(help.structuredContent), /SceneHandle/);
      const voiceList = (await call('story_voice', { context: undoneProject.context }))
        .structuredContent;
      assert.equal(voiceList.provider, 'higgs');
      assert.equal(voiceList.settings.provider, 'higgs');
      assert.deepEqual(
        voiceList.providers.map(({ provider }) => provider),
        ['higgs', 'local', 'api'],
      );
      assert.equal(voiceList.voices[0].kind, 'local');
      assert.ok(voiceList.voices.length);
      assert.ok(voiceList.voices.every((voice) => voice.provider !== 'macos'));
      assert.equal(await app.locator('#voice, #voice-options').count(), 0);
      assert.equal(Boolean(voiceList.settings?.enabled), false);
      const voiceTool = (await host.client.listTools()).tools.find(
        ({ name }) => name === 'story_voice',
      );
      assert.deepEqual(voiceTool.inputSchema.properties.provider.enum, ['higgs', 'local', 'api']);
      assert.equal(voiceTool.inputSchema.properties.model.type, 'string');
      assert.equal(voiceTool.inputSchema.properties.adapter.type, 'string');
      const jobsBeforeUnsupportedVoice = await readdir(join(directory, 'data/jobs'));
      const unsupportedVoice = await host.client.callTool({
        name: 'story_voice',
        arguments: {
          context: undoneProject.context,
          requestId: randomUUID(),
          enabled: true,
          provider: 'macos',
        },
      });
      assert.equal(unsupportedVoice.isError, true);
      assert.equal(
        (await call('story_inspect', { projectId: project.id })).structuredContent.sourceRevision,
        undoneProject.sourceRevision,
        'an unsupported provider does not edit the project',
      );
      assert.deepEqual(await readdir(join(directory, 'data/jobs')), jobsBeforeUnsupportedVoice);
      const adapterAdded = await call('story_edit', {
        context: undoneProject.context,
        requestId: randomUUID(),
        changes: [
          {
            path: 'voice/adapter.mjs',
            content: await readFile(
              new URL('./fixtures/voice-adapter.mjs', import.meta.url),
              'utf8',
            ),
          },
        ],
      });
      const adapterAddedProject = (await finish(adapterAdded.structuredContent.job.id)).result
        .project;
      const voiceDisabled = await call('story_voice', {
        context: adapterAddedProject.context,
        requestId: randomUUID(),
        enabled: false,
        provider: 'local',
        model: 'fixture',
        adapter: 'voice/adapter.mjs',
        voice: 'fixture',
        language: 'ru',
      });
      const voiceDisabledProject = (await finish(voiceDisabled.structuredContent.job.id)).result
        .project;
      await call('story_preferences', { patch: { language: 'en' } });
      const narrated = await call('story_voice', {
        context: voiceDisabledProject.context,
        requestId: randomUUID(),
        enabled: true,
      });
      const narratedProject = (await finish(narrated.structuredContent.job.id)).result.project;
      const voiceSettings = (await call('story_voice', { context: narratedProject.context }))
        .structuredContent.settings;
      assert.equal(voiceSettings.voice, 'fixture');
      assert.equal(voiceSettings.provider, 'local');
      assert.equal(voiceSettings.model, 'fixture');
      assert.equal(voiceSettings.adapter, 'voice/adapter.mjs');
      assert.equal(
        voiceSettings.language,
        'ru',
        'enabling narration keeps the project voice and language',
      );
      await app.frameLocator('#scene').locator('audio:not([muted])').waitFor({ state: 'attached' });
      assert.equal(
        await app
          .frameLocator('#scene')
          .locator('audio')
          .evaluate((audio) => audio.muted),
        false,
        'enabling narration does not restore the absent sound of a silent clock as mute',
      );
      const narration = (
        await call('story_inspect', { projectId: project.id, file: 'narration.json' })
      ).structuredContent;
      const script = JSON.parse(narration.content);
      script.segments.at(-1).text += ' Теперь проверьте свой вариант.';
      const spokenEdit = await call('story_edit', {
        context: narratedProject.context,
        requestId: randomUUID(),
        changes: [{ path: 'narration.json', content: JSON.stringify(script, null, 2) }],
      });
      const spokenEditProject = (await finish(spokenEdit.structuredContent.job.id)).result.project;
      assert.equal(
        (await readdir(join(directory, 'data/speech'))).length,
        script.segments.length + 1,
        'only the changed phrase adds an adapter take',
      );
      const produced = await call('story_produce', {
        target: {
          kind: 'working',
          context: spokenEditProject.context,
        },
        requestId: randomUUID(),
        options: {
          formats: ['html', 'source', 'mp4', 'srt'],
          video: { kind: 'story' },
          width: 640,
          fps: 12,
        },
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
        'export includes the decodable adapter-produced audio',
      );
      assert.ok(Number(media.format.duration) > 1, 'the published video contains the story');
      const captions = await readFile(
        job.result.files.find((p) => p.endsWith('.srt')),
        'utf8',
      );
      assert.match(captions, /Три шага вправо/);
      assert.match(captions, /Теперь проверьте свой вариант/);
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
      let copied;
      for (let attempt = 0; attempt < 80 && !copied; attempt++) {
        copied = (await call('story_help', {})).structuredContent.projects.find((p) =>
          p.path.endsWith('/restored/source'),
        );
        if (!copied) await delay(100);
      }
      assert.ok(copied, 'the restored archive is an independent editable project');
      assert.notEqual(copied.id, project.id);
      // A file-open notification returns before preparation. The old card has
      // the same text; wait for the new project's displayed context first.
      await page.waitForFunction(
        (projectId) =>
          window.pluginTest.context?.structuredContent?.visualStory?.projectId === projectId,
        copied.id,
        { timeout: 60000 },
      );
      await app.locator('html[data-connection="connected"]').waitFor();
      await app
        .frameLocator('#scene')
        .getByText('Одна клетка — один шаг', { exact: true })
        .waitFor();
      assert.equal(
        (await call('story_inspect', {})).structuredContent.sessions.find(
          (s) => s.sessionId === sessionId,
        ).sessionId,
        sessionId,
      );
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      const failures = [];
      const cleanup = async (action) => {
        try {
          await action();
        } catch (error) {
          failures.push(error);
        }
      };
      await cleanup(() => browser.close());
      await cleanup(async () => {
        const jobs = join(directory, 'data/jobs');
        for (const name of await readdir(jobs)) {
          if (!name.endsWith('.json')) continue;
          const job = JSON.parse(await readFile(join(jobs, name), 'utf8'));
          if (!['queued', 'running', 'cancelling'].includes(job.status)) continue;
          await call('story_cancel', { jobId: job.id });
          const stopped = (await call('story_inspect', { jobId: job.id, waitMs: 15000 }))
            .structuredContent;
          assert.ok(['cancelled', 'failed', 'succeeded', 'interrupted'].includes(stopped.status));
        }
      });
      await cleanup(() => host.close());
      await cleanup(() => rm(directory, { recursive: true, force: true, maxRetries: 5 }));
      if (failures.length)
        throw new AggregateError(
          [...(primaryError ? [primaryError] : []), ...failures],
          'Authoring test cleanup failed',
          { cause: primaryError ?? failures[0] },
        );
    }
  },
);
