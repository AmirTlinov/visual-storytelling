import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { pluginHost } from './plugin/host.mjs';
import { finishFixtureJob } from './plugin/authoring-fixture.mjs';
import { installRelease } from '../plugin/install.mjs';
import { voiceAdapter } from './support/voice-adapter.mjs';
async function unlockDirectories(directory) {
  await chmod(directory, 0o700);
  for (const entry of await readdir(directory, { withFileTypes: true }))
    if (entry.isDirectory()) await unlockDirectories(join(directory, entry.name));
}
test(
  'installed document speech authoring keeps voice optional and retakes only one changed thought through the existing job owner',
  { timeout: 180000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'story-installed-speech-'));
    const installed = await installRelease(resolve('.plugin-release'), {
      directory: join(directory, 'installation'),
      register: false,
    });
    const target = {};
    const host = await pluginHost({
      dataDirectory: join(directory, 'data'),
      initialTarget: target,
      serverCommand: join(installed.release, 'runtime/node'),
      serverEntry: join(installed.release, 'plugin/dist/server.mjs'),
    });
    const call = async (name, args) => {
      const result = await host.client.callTool({ name, arguments: args });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      return result.structuredContent;
    };
    const browser = await chromium.launch(chromiumLaunchOptions());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const finish = async (result) =>
      result.job ? (await finishFixtureJob(host.client, result.job.id)).result : result;
    const generic = { basis: 'presented', models: [] };
    const document = {
      version: 2,
      title: 'Проверим предметы',
      models: [{ id: 'division', module: 'division', inputs: { count: 17, divisor: 4 } }],
      views: [{ id: 'groups', kind: 'groups', model: 'division' }],
      chapters: [
        {
          id: 'lesson',
          title: 'Предметы',
          beats: [
            {
              id: 'look',
              say: 'Посмотрим на предметы.',
              action: 'Наблюдение',
              speech: { id: 'voice.lesson.look', when: generic },
            },
            {
              id: 'number',
              say: 'Здесь семнадцать предметов.',
              operation: { model: 'division', name: 'group' },
              speech: {
                id: 'voice.lesson.number',
                when: {
                  basis: 'presented',
                  models: [{ model: 'division', inputs: { count: 17 } }],
                },
              },
            },
          ],
        },
      ],
      narration: { intro: 0.2, outro: 0.3, pause: 0.2 },
    };
    try {
      const created = await call('story_create', {
        title: document.title,
        document,
        path: join(directory, 'project'),
        requestId: randomUUID(),
      });
      const opened = await call('story_open', { projectId: created.project.id });
      target.sessionId = opened.sessionId;
      await page.goto(host.url);
      const app = page.frameLocator('iframe[title="MCP App"]');
      await app.locator('html[data-connection="connected"]').waitFor();
      const shown = async (revision) => {
        await expect
          .poll(
            async () => {
              const inspected = await host.client.callTool({
                name: 'story_inspect',
                arguments: { sessionId: opened.sessionId },
              });
              if (
                inspected.isError &&
                inspected.structuredContent?.error?.message ===
                  'The scene is moving to another view. Inspect after it opens.'
              )
                return false;
              assert.equal(inspected.isError, undefined, JSON.stringify(inspected));
              return (
                inspected.structuredContent.shownSourceRevision === revision &&
                inspected.structuredContent.renderStatus === 'rendered'
              );
            },
            { timeout: 20000, intervals: [100, 200] },
          )
          .toBe(true);
      };
      const configured = await finish(
        await call('story_edit', {
          context: created.project.context,
          requestId: randomUUID(),
          changes: [{ path: 'voice/adapter.mjs', content: voiceAdapter }],
        }),
      );
      await shown(configured.project.sourceRevision);
      const voiced = await finish(
        await call('story_voice', {
          context: configured.project.context,
          requestId: randomUUID(),
          enabled: true,
          provider: 'local',
          adapter: 'voice/adapter.mjs',
          model: 'fixture',
          voice: 'chosen',
          language: 'ru-RU',
        }),
      );
      await shown(voiced.project.sourceRevision);
      const source = JSON.parse(await readFile(join(voiced.project.path, 'story.json'), 'utf8'));
      assert.deepEqual(
        source.chapters[0].beats.map((beat) => beat.speech.id),
        ['voice.lesson.look', 'voice.lesson.number'],
      );
      const audio = async () => {
        return app
          .frameLocator('#scene')
          .locator('main')
          .evaluate((root) => ({
            speech: root.scene.speech,
            hasAudio: !!root.scene.mute,
          }));
      };
      await expect.poll(audio).toMatchObject({ hasAudio: true });
      await rm(join(directory, 'data/speech'), { recursive: true, force: true });
      const chapters = structuredClone(source.chapters);
      chapters[0].beats[0].say = 'Посмотрим на эти рисунки.';
      const changed = await finish(
        await call('story_edit', {
          context: voiced.project.context,
          requestId: randomUUID(),
          operations: [{ op: 'set-chapters', chapters }],
        }),
      );
      await shown(changed.project.sourceRevision);
      await expect.poll(audio).toMatchObject({ hasAudio: true });
      const calls = await readFile(join(changed.snapshot, '.voice-calls'), 'utf8').then((s) =>
        s.trim().split('\n').map(JSON.parse),
      );
      assert.deepEqual(
        calls.map((call) => call.text),
        ['Посмотрим на эти рисунки.'],
      );
      const before = await call('story_inspect', { sessionId: opened.sessionId });
      const explored = await call('story_control', {
        context: before.context,
        requestId: randomUUID(),
        commands: [
          { type: 'cue', id: 'lesson.number', progress: 0.5 },
          { type: 'parameters', values: { count: 18 } },
        ],
      });
      assert.equal(explored.state.speech.applicable, false);
      assert.equal(explored.state.muted, false);
      const frozenJob = await call('story_produce', {
        target: { kind: 'build', context: explored.context },
        requestId: randomUUID(),
        options: {
          formats: ['mp4'],
          conditions: 'current',
          width: 960,
          fps: 4,
          video: { kind: 'story' },
        },
      });
      const frozenOutput = await finishFixtureJob(host.client, frozenJob.id);
      assert.equal(frozenOutput.status, 'succeeded');
      assert.deepEqual(
        [frozenOutput.result.video.width, frozenOutput.result.video.height],
        [960, 540],
      );
      assert.equal(frozenOutput.result.video.duration, explored.state.duration);
      const silentJob = await call('story_produce', {
        target: { kind: 'build', context: explored.context },
        requestId: randomUUID(),
        options: { formats: ['mp4'], silent: true, width: 960, fps: 4, video: { kind: 'story' } },
      });
      const silentOutput = await finishFixtureJob(host.client, silentJob.id);
      assert.equal(silentOutput.result.video.duration, explored.state.duration);
      const quiet = await finish(
        await call('story_voice', {
          context: changed.project.context,
          requestId: randomUUID(),
          enabled: false,
        }),
      );
      await shown(quiet.project.sourceRevision);
      await expect.poll(audio).toMatchObject({ hasAudio: false });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await host.close();
      await unlockDirectories(directory);
      await rm(directory, { recursive: true, force: true });
    }
  },
);
