import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workflows } from '../plugin/workflows.mjs';
import { projectFiles } from '../tools/project-files.mjs';
import { buildNarration, checkNarration, prepareNarration } from '../tools/narration.mjs';
import { narrationSource } from '../tools/story-document.mjs';
import { createScene } from '../tools/create-scene.mjs';

test(
  'static and silent canonical documents skip voice preparation even with an enabled saved voice',
  { timeout: 90000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'static-document-voice-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const projectPath = join(directory, 'division');
    const data = join(directory, 'data');
    const document = {
      version: 1,
      models: [{ id: 'division', kind: 'division', inputs: { count: 23, divisor: 3 } }],
      views: [{ id: 'groups', kind: 'groups', model: 'division' }],
      chapters: [],
    };
    await createScene(projectPath, {
      document,
      root: fileURLToPath(new URL('../.plugin-release/', import.meta.url)),
    });
    const voice = JSON.stringify({ enabled: true, provider: 'higgs', language: 'ru-RU' });
    await writeFile(join(projectPath, 'voice.json'), voice);
    const stages = [];
    const previousFetch = globalThis.fetch;
    let downloads = 0;
    globalThis.fetch = async () => {
      downloads++;
      throw new Error('A silent canonical document must not prepare a voice environment');
    };
    try {
      for (const chapters of [
        [],
        [
          {
            id: 'look',
            title: 'Рассмотрите группы',
            beats: [{ id: 'hold', say: '', seconds: 2, hold: 'Рассмотрите остаток' }],
          },
        ],
      ]) {
        const authored = JSON.stringify({ ...document, chapters });
        await writeFile(join(projectPath, 'story.json'), authored);
        const result = await workflows.build(
          {
            data,
            projectPath,
            projectId: randomUUID(),
            sourceRevision: (await projectFiles(projectPath)).revision,
          },
          {
            jobId: randomUUID(),
            signal: new AbortController().signal,
            progress: (stage) => stages.push(stage),
          },
        );
        assert.ok(result.buildRevision);
        assert.equal(await readFile(join(projectPath, 'story.json'), 'utf8'), authored);
        assert.equal(await readFile(join(projectPath, 'voice.json'), 'utf8'), voice);
        assert.equal(await narrationSource(projectPath), undefined);
        await assert.rejects(readFile(join(result.snapshot, 'audio.wav')), { code: 'ENOENT' });
      }
      assert.equal(downloads, 0);
      assert.ok(stages.every((stage) => !/Higgs|кодировщик|нейросетевую озвучку/.test(stage)));
      await assert.rejects(readdir(join(data, 'environment')), { code: 'ENOENT' });
    } finally {
      globalThis.fetch = previousFetch;
    }
  },
);

test(
  'a deferred voiced template stays quiet through source edits until voice is explicitly enabled',
  { timeout: 90000, skip: process.platform !== 'darwin' || process.arch !== 'arm64' },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'story-deferred-voice-'));
    const data = join(directory, 'data'),
      projectPath = join(directory, 'memory'),
      input = { data, projectPath, projectId: randomUUID(), title: 'Quiet register' };
    const environment = { ...process.env },
      fetch = globalThis.fetch;
    const stages = [];
    const task = () => ({
      jobId: randomUUID(),
      signal: new AbortController().signal,
      progress: (stage) => stages.push(stage),
    });
    const read = async (name) => JSON.parse(await readFile(join(projectPath, name), 'utf8'));
    try {
      for (const key of Object.keys(process.env))
        if (/^(?:VISUAL_STORY_|SKETCH_AUDIO_|UV_)/.test(key)) delete process.env[key];
      process.env.VISUAL_STORY_DATA_DIR = data;
      process.env.SKETCH_AUDIO_BIN = join(directory, 'absent-voice');
      let downloads = 0;
      globalThis.fetch = async (_url, { signal } = {}) => {
        signal?.throwIfAborted();
        downloads++;
        throw new Error('Quiet authoring must not download a voice environment');
      };
      await workflows.create(input, task());
      await cp(new URL('./fixtures/scene-shell/', import.meta.url), projectPath, {
        recursive: true,
      });
      await workflows.build(
        { ...input, sourceRevision: (await projectFiles(projectPath)).revision },
        task(),
      );
      const voice = await read('voice.json');
      assert.deepEqual(voice, { provider: 'higgs', enabled: false, language: 'ru-RU' });
      const timeline = await readFile(join(projectPath, 'timeline.json'), 'utf8');
      const authored = await read('narration.json');
      assert.deepEqual(
        authored,
        JSON.parse(
          await readFile(new URL('./fixtures/scene-shell/narration.json', import.meta.url)),
        ),
        'deferring speech preserves the editable script',
      );
      authored.segments.at(-1).text += ' Теперь исследуйте свой вариант.';
      await writeFile(join(projectPath, 'narration.json'), JSON.stringify(authored));
      const built = await workflows.build(
        { ...input, sourceRevision: (await projectFiles(projectPath)).revision },
        task(),
      );
      assert.match(
        await readFile(join(built.snapshot, 'dist/index.html'), 'utf8'),
        /data-silent="true"/,
      );
      // Ordinary delivery asks to prepare audible output; saved project intent remains authoritative.
      await prepareNarration(projectPath, { audible: true });
      assert.deepEqual(await read('voice.json'), voice);
      assert.deepEqual(await read('narration.json'), authored);
      assert.equal(await readFile(join(projectPath, 'timeline.json'), 'utf8'), timeline);
      assert.equal(downloads, 0);
      await assert.rejects(readdir(join(data, 'environment')), { code: 'ENOENT' });

      // story_voice writes this same project-owned setting. Stop its real preparation before download.
      await writeFile(join(projectPath, 'voice.json'), JSON.stringify({ ...voice, enabled: true }));
      const controller = new AbortController();
      let preparationRequested = false;
      await assert.rejects(
        workflows.build(
          { ...input, sourceRevision: (await projectFiles(projectPath)).revision },
          {
            ...task(),
            signal: controller.signal,
            progress(stage) {
              stages.push(stage);
              if (stage.includes('кодировщик')) {
                preparationRequested = true;
                controller.abort(new Error('Explicit voice preparation observed'));
              }
            },
          },
        ),
        /Explicit voice preparation observed/,
      );
      assert.equal(preparationRequested, true);
      assert.equal(downloads, 0);
      assert.equal((await read('voice.json')).enabled, true);
      assert.deepEqual(await read('narration.json'), authored);
      assert.deepEqual(await readdir(join(data, 'environment')), []);
    } finally {
      globalThis.fetch = fetch;
      for (const key of Object.keys(process.env))
        if (!Object.hasOwn(environment, key)) delete process.env[key];
      Object.assign(process.env, environment);
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  'quiet story documents retain a speech projection and explicit audio activates the same script',
  { timeout: 90000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'quiet-document-voice-'));
    const projections = [];
    try {
      for (const example of ['chapters']) {
        const project = join(directory, example);
        await mkdir(project);
        for (const name of ['story.json', 'voice.json', 'index.html'])
          await cp(new URL(`./fixtures/${example}/${name}`, import.meta.url), join(project, name));
        const authored = await readFile(join(project, 'story.json'), 'utf8');
        await prepareNarration(project, { audible: true });
        assert.equal(JSON.parse(await readFile(join(project, 'voice.json'))).enabled, false);
        assert.equal(await readFile(join(project, 'story.json'), 'utf8'), authored);
        const projection = await narrationSource(project);
        assert.ok(projection, `${example} keeps speech available while its voice is disabled`);
        projections.push(dirname(projection.file));
        const speech = JSON.parse(await readFile(projection.file));
        assert.deepEqual(
          speech.segments.flatMap((segment) => segment.cues.map((cue) => cue.id)),
          JSON.parse(authored).chapters.flatMap((chapter) =>
            chapter.beats.map((beat) => `${chapter.id}.${beat.id}`),
          ),
        );
      }
      const project = join(directory, 'chapters');
      await mkdir(join(project, 'voice'));
      await cp(
        new URL('./fixtures/voice-adapter.mjs', import.meta.url),
        join(project, 'voice/adapter.mjs'),
      );
      await writeFile(
        join(project, 'voice.json'),
        JSON.stringify({
          enabled: false,
          provider: 'api',
          model: 'fixture',
          adapter: 'voice/adapter.mjs',
          language: 'ru-RU',
        }),
      );
      const result = await buildNarration(project, {
        cache: join(directory, 'speech'),
        signal: new AbortController().signal,
      });
      assert.ok(result.duration > 0);
      assert.equal(JSON.parse(await readFile(join(project, 'voice.json'))).enabled, true);
      assert.ok((await readFile(join(project, 'audio.wav'))).length > 44);
      const html = await readFile(join(project, 'index.html'), 'utf8');
      assert.match(html, /data-story-audio/);
      assert.doesNotMatch(html, /data-silent="true"/);
      await checkNarration(html, project);
    } finally {
      await rm(directory, { recursive: true, force: true });
      for (const projection of projections) await rm(projection, { recursive: true, force: true });
    }
  },
);
