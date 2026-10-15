import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  rm,
  readdir,
  chmod,
  mkdir,
  writeFile,
  copyFile,
} from 'node:fs/promises';
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
  'installed voice previews never synthesize; explicit preparation retakes one thought and final rejects pending speech',
  { timeout: 240000 },
  async (t) => {
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
      const shown = async (revision, buildRevision) => {
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
                inspected.structuredContent.renderStatus === 'rendered' &&
                (!buildRevision || inspected.structuredContent.buildRevision === buildRevision)
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
      let changed = await finish(
        await call('story_edit', {
          context: voiced.project.context,
          requestId: randomUUID(),
          operations: [{ op: 'set-chapters', chapters }],
        }),
      );
      await shown(changed.project.sourceRevision, changed.buildRevision);
      await expect.poll(audio).toMatchObject({ hasAudio: true });
      await assert.rejects(readFile(join(changed.snapshot, '.voice-calls')), { code: 'ENOENT' });
      const pending = await call('story_inspect', { sessionId: opened.sessionId });
      assert.deepEqual(pending.narration.ready, ['voice.lesson.number']);
      assert.deepEqual(pending.narration.pending, ['voice.lesson.look']);
      assert.equal(pending.narration.preparation.units, 1);
      const scene = app.frameLocator('#scene').locator('main');
      const pendingClock = await scene.evaluate((root) => root.scene.review());
      let observed = await call('story_control', {
        context: pending.context,
        requestId: randomUUID(),
        commands: [{ type: 'cue', id: 'lesson.look', progress: 0.5 }],
      });
      assert.equal(observed.state.speech.applicable, false);
      const pendingCaption = await app
        .frameLocator('#scene')
        .locator('[data-caption]')
        .textContent();
      assert.match(pendingCaption, /Посмотрим на эти рисунки/);
      observed = await call('story_control', {
        context: observed.context,
        requestId: randomUUID(),
        commands: [{ type: 'cue', id: 'lesson.number', progress: 0.5 }],
      });
      assert.equal(observed.state.speech.applicable, true);
      const pendingSilent = await call('story_produce', {
        target: { kind: 'working', context: changed.project.context },
        requestId: randomUUID(),
        options: {
          formats: ['html', 'mp4'],
          silent: true,
          width: 960,
          fps: 4,
          video: { kind: 'story' },
        },
      });
      const pendingOutput = await finishFixtureJob(host.client, pendingSilent.id);
      assert.equal(pendingOutput.result.video.duration, pending.state.duration);
      const quietPage = await browser.newPage();
      await quietPage.goto(
        'file://' + pendingOutput.result.files.find((file) => file.endsWith('.html')),
      );
      await quietPage.waitForFunction(
        () => document.querySelector('main')?.scene?.duration !== undefined,
      );
      const quietClock = await quietPage
        .locator('main')
        .evaluate((root) => ({ duration: root.scene.duration, review: root.scene.review() }));
      assert.equal(quietClock.duration, pending.state.duration);
      const spans = (review) => review.cues.map(({ id, start, end }) => ({ id, start, end }));
      assert.deepEqual(spans(quietClock.review), spans(pendingClock));
      if (process.env.VISUAL_STORY_ACCEPTANCE_DIR) {
        const evidence = process.env.VISUAL_STORY_ACCEPTANCE_DIR;
        await mkdir(evidence, { recursive: true });
        await page.screenshot({ path: join(evidence, 'pending-card.png') });
        await quietPage.screenshot({ path: join(evidence, 'silent-html.png') });
        for (const file of pendingOutput.result.files)
          await copyFile(file, join(evidence, file.split('/').at(-1)));
        await writeFile(
          join(evidence, 'clock.json'),
          JSON.stringify(
            {
              pendingClock,
              quietClock,
              video: pendingOutput.result.video,
              pendingCaption,
              narration: pending.narration,
            },
            null,
            2,
          ),
        );
      }
      await quietPage.close();
      const rejectedFinal = await call('story_produce', {
        target: { kind: 'build', context: pending.context },
        requestId: randomUUID(),
        options: { formats: ['html'] },
      });
      let rejected;
      for (let attempt = 0; attempt < 12; attempt++) {
        rejected = await call('story_inspect', { jobId: rejectedFinal.id, waitMs: 15000 });
        if (!['queued', 'running', 'cancelling'].includes(rejected.status)) break;
      }
      assert.equal(rejected.status, 'failed');
      assert.match(rejected.error, /changed|current narration|source/i);
      await assert.rejects(
        readFile(join(directory, 'data/snapshots', rejected.id, '.voice-calls')),
        {
          code: 'ENOENT',
        },
      );
      changed = await finish(
        await call('story_voice', {
          context: changed.project.context,
          requestId: randomUUID(),
          enabled: true,
        }),
      );
      await shown(changed.project.sourceRevision, changed.buildRevision);
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
      const receipt = {
        plugin: JSON.parse(await readFile(join(installed.release, 'plugin.json'), 'utf8')).version,
        releaseDigest: installed.digest,
        core: JSON.parse(await readFile(join(installed.release, 'dist/build-info.json'), 'utf8')),
        pending: pending.narration,
        preparedCalls: calls,
        finalRejected: rejected.error,
        errors,
        voice: 'protocol tones only; no listening-quality claim',
      };
      t.diagnostic(JSON.stringify(receipt));
      if (process.env.VISUAL_STORY_ACCEPTANCE_DIR)
        await writeFile(
          join(process.env.VISUAL_STORY_ACCEPTANCE_DIR, 'acceptance.json'),
          JSON.stringify(receipt, null, 2),
        );
    } finally {
      await browser.close();
      await host.close();
      await unlockDirectories(directory);
      await rm(directory, { recursive: true, force: true });
    }
  },
);
