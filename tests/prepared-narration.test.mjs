import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { createScene } from '../tools/create-scene.mjs';
import { assertPreparedDocument } from '../tools/runtime-package.mjs';
import { buildNarration, playbackTimeline, setNarrationMode } from '../tools/narration.mjs';
import { projectFiles } from '../tools/project-files.mjs';
import { environmentProfile } from '../tools/environment/resources.mjs';
import { captureWorkingInput } from '../plugin/revision-input.mjs';
import { pluginHost } from './plugin/host.mjs';
import { finishFixtureJob } from './plugin/authoring-fixture.mjs';
import { prepareLiveProject } from '../plugin/live-project.mjs';
import { buildScene } from '../tools/build-pages.mjs';
import { packDirectory } from '../tools/standalone.mjs';

const release = fileURLToPath(new URL('../.plugin-release/', import.meta.url));
const document = {
  version: 2,
  models: [{ id: 'division', module: 'division', inputs: { count: 11, divisor: 3 } }],
  views: [
    { id: 'objects', kind: 'groups', model: 'division' },
    { id: 'identity', kind: 'equation', model: 'division' },
  ],
  chapters: [
    {
      id: 'experience',
      title: 'Группы и остаток',
      beats: [
        {
          id: 'gather',
          say: 'Соберём предметы.',
          operation: { model: 'division', name: 'gather' },
        },
        {
          id: 'group',
          say: 'Разложим их по группам.',
          operation: { model: 'division', name: 'group' },
        },
        {
          id: 'remainder',
          say: 'Посмотрим на остаток.',
          operation: { model: 'division', name: 'remainder' },
        },
      ],
    },
  ],
};

test('a speechless revision ignores obsolete generated hooks and missing media without changing voice settings', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'prepared-quiet-media-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const chapters of [[], document.chapters.map(chapter => ({
    ...chapter, beats: chapter.beats.map(beat => ({ ...beat, say: '' })),
  }))]) {
    const path = join(directory, chapters.length ? 'quiet-story' : 'static');
    await createScene(path, { document: { ...document, chapters }, root: release });
    const voice = JSON.stringify({ enabled: true, provider: 'api', adapter: 'missing.mjs' });
    await writeFile(join(path, 'voice.json'), voice);
    const index = setNarrationMode(await readFile(join(path, 'index.html'), 'utf8'), false);
    await writeFile(join(path, 'index.html'), index);
    const project = {
      id: randomUUID(), title: 'Quiet', path, sourceRevision: (await projectFiles(path)).revision,
    };
    const prepared = await prepareLiveProject(join(directory, 'data'), project);
    assert.doesNotMatch(prepared.html, /<audio\b/);
    const output = join(path, 'dist');
    await buildScene(path, output);
    assert.doesNotMatch(await packDirectory(output), /<audio\b/);
    assert.equal(await readFile(join(path, 'voice.json'), 'utf8'), voice);
    assert.equal(await readFile(join(path, 'index.html'), 'utf8'), index);
  }
});

test('prepared source permits its generated narration hook and rejects custom HTML or code', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'prepared-narration-guard-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const project = join(directory, 'project');
  await createScene(project, { document, root: release });
  const page = join(project, 'index.html');
  const original = await readFile(page, 'utf8');
  const audible = setNarrationMode(original, false);
  for (const html of [
    original,
    audible,
    setNarrationMode(audible, true),
    setNarrationMode(setNarrationMode(audible, true), false),
  ]) {
    await writeFile(page, html);
    assert.ok((await assertPreparedDocument(project)).build);
  }
  for (const html of [
    audible.replace('src="audio.wav"', 'src="other.wav"'),
    audible.replace('preload="auto"', 'preload="none"'),
    audible.replace('<audio ', '<audio onplay="custom()" '),
    audible.replace('<audio ', '<audio style="display:block" '),
    audible.replace('</audio>', '<source src="other.wav"></audio>'),
    audible.replace('</audio>', '<script>custom()</script></audio>'),
    audible.replace('</audio>', '</audio><audio></audio>'),
    audible.replace('</body>', '<aside>Custom content</aside></body>'),
    audible.replace('class="ve-standalone"', 'class="custom"'),
  ]) {
    await writeFile(page, html);
    await assert.rejects(assertPreparedDocument(project), { code: 'custom_scene_entry' });
  }
  await writeFile(page, audible);
  await writeFile(join(project, 'scene.js'), 'console.log("Custom scene")');
  await assert.rejects(assertPreparedDocument(project), { code: 'custom_scene_entry' });
});

test(
  'accepted narration stays live through an ordinary build and a semantic edit in the same card',
  { timeout: 120000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'prepared-narration-live-'));
    const projectPath = join(directory, 'project');
    const data = join(directory, 'data');
    let host, browser;
    t.after(async () => {
      await browser?.close();
      await host?.close();
      await rm(directory, { recursive: true, force: true });
    });
    await createScene(projectPath, { document, root: release });
    await mkdir(join(projectPath, 'voice'));
    const calls = join(directory, 'adapter-calls');
    const adapter = await readFile(
      new URL('./fixtures/voice-adapter.mjs', import.meta.url),
      'utf8',
    );
    await writeFile(
      join(projectPath, 'voice/adapter.mjs'),
      `import {appendFile} from 'node:fs/promises';\nawait appendFile(${JSON.stringify(calls)}, 'call\\n');\n` +
        adapter,
    );
    await writeFile(
      join(projectPath, 'voice.json'),
      JSON.stringify({
        enabled: true,
        provider: 'local',
        model: 'fixture',
        adapter: 'voice/adapter.mjs',
        language: 'ru-RU',
      }),
    );
    const cache = join(directory, 'initial-takes');
    await buildNarration(projectPath, { cache });
    const accepted = await readFile(join(projectPath, 'audio.wav'));
    const timeline = await readFile(join(projectPath, 'timeline.json'), 'utf8');
    const receipt = JSON.parse(timeline);
    assert.equal(await readFile(calls, 'utf8'), 'call\n');
    await rm(cache, { recursive: true, force: true });

    // A current accepted recording needs neither an encoder run nor a provider take.
    // The managed environment fixture deliberately fails if preparation tries to use it.
    const resource = environmentProfile().resources.ffmpeg;
    const encoderDirectory = join(data, 'environment', 'ffmpeg-' + resource.version);
    const binary = join(encoderDirectory, resource.binary);
    const bytes = Buffer.from('#!/bin/sh\necho "Unexpected accepted-audio encoding" >&2\nexit 1\n');
    await mkdir(dirname(binary), { recursive: true });
    await writeFile(binary, bytes, { mode: 0o755 });
    await writeFile(
      join(encoderDirectory, 'receipt.json'),
      JSON.stringify({
        digest: resource.digest,
        binary: createHash('sha256').update(bytes).digest('hex'),
      }),
    );
    host = await pluginHost({
      dataDirectory: data,
      initialTarget: { path: projectPath },
      serverEntry: join(release, 'plugin/dist/server.mjs'),
    });
    const call = async (name, arguments_) => {
      const result = await host.client.callTool({ name, arguments: arguments_ });
      if (result.isError)
        t.diagnostic(
          await readFile(join(data, 'runtime.log'), 'utf8').catch(() => 'No runtime log'),
        );
      assert.equal(result.isError, undefined, JSON.stringify(result));
      return result.structuredContent;
    };
    const opened = await call('story_open', { path: projectPath });
    const job = opened.jobs.find(({ kind }) => kind === 'build');
    assert.ok(job);
    const built = await finishFixtureJob(host.client, job.id);
    const prepared = JSON.parse(
      await readFile(join(data, 'builds', built.result.buildRevision + '.json'), 'utf8'),
    );
    assert.ok(prepared.live, 'the ordinary narrated build retains semantic live authoring');
    assert.deepEqual(await readFile(join(prepared.snapshot, 'audio.wav')), accepted);
    assert.equal(await readFile(join(prepared.snapshot, 'timeline.json'), 'utf8'), timeline);
    browser = await chromium.launch(chromiumLaunchOptions({ headless: true }));
    const page = await browser.newPage({ viewport: { width: 820, height: 850 } });
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(host.url);
    const app = page.frameLocator('iframe[title="MCP App"]');
    await app.locator('html[data-connection="connected"]').waitFor();
    await app.frameLocator('#scene').locator('audio').waitFor({ state: 'attached' });
    const scene = page.frames().find((frame) => frame.url() === 'about:srcdoc');
    await scene.waitForFunction(
      () =>
        document.querySelector('main')?.scene?.authoring &&
        document.querySelector('audio')?.readyState >= 1,
    );
    const before = await scene.evaluate(() => {
      window.acceptedScene = document.querySelector('main').scene;
      const audio = document.querySelector('audio');
      return {
        audio: audio.src,
        timing: audio.dataset.storyTimeline,
        hasAudio: window.acceptedScene
          .inspect({ presentation: false })
          .capabilities.includes('mute'),
        cues: window.acceptedScene.review().cues.map(({ referenced, targets, ...cue }) => cue),
      };
    });
    assert.equal(before.hasAudio, true);
    assert.ok(
      before.cues.some(
        ({ id, start }) =>
          id === 'experience.group' && start === receipt.cues['experience.group'].start,
      ),
    );
    const project = await call('story_inspect', { projectId: opened.project.id });
    const edited = await call('story_edit', {
      projectId: project.id,
      sourceRevision: project.sourceRevision,
      requestId: randomUUID(),
      operations: [{ op: 'set-inputs', modelId: 'division', values: { count: 14 } }],
    });
    assert.equal(edited.delivery, 'shown', JSON.stringify(edited));
    assert.equal(edited.shown[0].acknowledgement, 'rendered');
    assert.ok(page.frames().includes(scene));
    assert.deepEqual(
      await scene.evaluate(() => {
        const audio = document.querySelector('audio');
        return {
          sameScene: window.acceptedScene === document.querySelector('main').scene,
          count: window.acceptedScene.snapshot().count,
          audio: audio.src,
          timing: audio.dataset.storyTimeline,
          hasAudio: window.acceptedScene
            .inspect({ presentation: false })
            .capabilities.includes('mute'),
          cues: window.acceptedScene.review().cues.map(({ referenced, targets, ...cue }) => cue),
        };
      }),
      { sameScene: true, count: 14, ...before },
    );
    assert.deepEqual(await readFile(join(projectPath, 'audio.wav')), accepted);
    assert.equal(await readFile(join(projectPath, 'timeline.json'), 'utf8'), timeline);
    assert.equal(await readFile(calls, 'utf8'), 'call\n');
    await page.evaluate(() => window.pluginTest.remount());
    await app.locator('html[data-connection="connected"]').waitFor();
    await app.frameLocator('#scene').locator('svg').first().waitFor();
    const reopened = page.frames().find((frame) => frame.url() === 'about:srcdoc');
    await reopened.waitForFunction(() => Boolean(document.querySelector('main')?.scene?.authoring));
    assert.equal(
      await reopened.locator('audio[data-story-audio]').count(),
      1,
      'reopening the semantic revision retains its accepted narration',
    );
    assert.deepEqual(
      await reopened.evaluate(() => ({
        count: document.querySelector('main').scene.snapshot().count,
        hasAudio: document
          .querySelector('main')
          .scene.inspect({ presentation: false })
          .capabilities.includes('mute'),
        cues: document
          .querySelector('main')
          .scene.review()
          .cues.map(({ referenced, targets, ...cue }) => cue),
      })),
      { count: 14, hasAudio: true, cues: before.cues },
    );
    assert.equal(await readFile(calls, 'utf8'), 'call\n');
    let count = 14;
    for (const name of ['audio.wav', 'timeline.json']) {
      const current = await call('story_inspect', { projectId: project.id });
      const candidate = join(directory, 'candidate-' + name);
      await cp(projectPath, candidate, { recursive: true });
      const nextDocument = JSON.parse(await readFile(join(candidate, 'story.json'), 'utf8'));
      nextDocument.models[0].inputs.count = count + 1;
      await writeFile(join(candidate, 'story.json'), JSON.stringify(nextDocument, null, 2) + '\n');
      const nextRevision = (await projectFiles(candidate)).revision;
      const captured = await captureWorkingInput(
        data,
        { ...current, path: candidate },
        nextRevision,
      );
      const missing = join(data, 'snapshots', captured.inputSnapshot, name);
      const original = await readFile(missing);
      await rm(missing);
      const request = {
        projectId: project.id,
        sourceRevision: current.sourceRevision,
        requestId: randomUUID(),
        operations: [{ op: 'set-inputs', modelId: 'division', values: { count: count + 1 } }],
      };
      const refused = await call('story_edit', request);
      assert.equal(refused.delivery, 'failed', JSON.stringify(refused));
      assert.equal(refused.error.code, 'snapshot_changed');
      assert.equal(
        (await call('story_inspect', { projectId: project.id })).buildRevision,
        current.buildRevision,
      );
      assert.equal(
        await reopened.evaluate(() => document.querySelector('main').scene.snapshot().count),
        count,
      );
      assert.equal(
        await reopened.locator('audio[data-story-audio]').getAttribute('src'),
        before.audio,
      );
      await writeFile(missing, original);
      const retried = await call('story_edit', request);
      assert.equal(retried.delivery, 'shown', JSON.stringify(retried));
      count++;
      assert.equal(
        await reopened.evaluate(() => document.querySelector('main').scene.snapshot().count),
        count,
      );
      assert.equal(await readFile(calls, 'utf8'), 'call\n');
    }
    const current = await call('story_inspect', { projectId: project.id });
    const produced = await call('story_produce', {
      target: { kind: 'build', projectId: project.id, buildRevision: current.buildRevision },
      requestId: randomUUID(),
      options: { formats: ['html'] },
    });
    const delivered = await finishFixtureJob(host.client, produced.id);
    const portable = await readFile(
      delivered.result.files.find((name) => name.endsWith('story.html')),
      'utf8',
    );
    const audioURL = /<audio\b[^>]*\bsrc="([^"]+)"/.exec(portable)?.[1];
    const timelineURL = /data-story-timeline="([^"]+)"/.exec(portable)?.[1];
    assert.ok(audioURL?.startsWith('data:audio/'));
    assert.deepEqual(Buffer.from(audioURL.split(',')[1], 'base64'), accepted);
    assert.deepEqual(
      JSON.parse(Buffer.from(timelineURL.split(',')[1], 'base64')),
      playbackTimeline(receipt),
    );
    assert.equal(await readFile(calls, 'utf8'), 'call\n');
    assert.deepEqual(errors, []);
  },
);
