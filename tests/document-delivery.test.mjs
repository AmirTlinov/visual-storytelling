import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScene } from '../tools/build-pages.mjs';
import { packDirectory } from '../tools/standalone.mjs';
import { playbackTimeline, setNarrationMode } from '../tools/narration.mjs';
import { buildAdapterNarration } from '../tools/voice/adapter.mjs';
import { narrationSource } from '../tools/story-document.mjs';
import { renderer } from '../tools/render.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const evidence = join(repository, 'artifacts/coherent-authoring/document-delivery');

test(
  'a quiet mixed document packs and reopens without a narration resource',
  { timeout: 120000 },
  async (t) => {
    const temporary = await mkdtemp(join(tmpdir(), 'quiet-document-'));
    t.after(() => rm(temporary, { recursive: true, force: true }));
    await mkdir(evidence, { recursive: true });
    for (const name of ['chapters']) {
      const built = join(temporary, name + '-build');
      await buildScene(join(repository, 'tests/fixtures', name), built, {
        sourcePackage: true,
        silent: true,
      });
      const packed = await packDirectory(built, 'index.html', { audio: 'original' });
      await rm(built, { recursive: true });
      const portable = join(temporary, name);
      await mkdir(portable);
      await writeFile(join(portable, 'index.html'), packed);
      const render = await renderer({
        directory: portable,
        width: 800,
        theme: 'light',
        controls: true,
      });
      try {
        assert.equal(await render.page.locator('audio').count(), 0, name);
        await render.control([
          {
            type: 'cue',
            id: 'workshop.explain',
            progress: 0.7,
          },
        ]);
        const snapshot = await render.capture.evaluate((scene) => scene.snapshot());
        const checkpoint = await render.page.evaluate(() =>
          document.querySelector('.ve-scene').scene.capture(),
        );
        await writeFile(join(evidence, name + '.png'), await render.png());
        await render.seek(0);
        await render.page.evaluate(
          (checkpoint) => document.querySelector('.ve-scene').scene.restore(checkpoint),
          checkpoint,
        );
        assert.deepEqual(await render.capture.evaluate((scene) => scene.snapshot()), snapshot);
        assert.deepEqual(
          render.messages.filter(({ type }) => type === 'error'),
          [],
          name,
        );
      } finally {
        await render.close();
      }
    }
  },
);

test(
  'a document transfers active audio with its declared timing and honors explicit script',
  { timeout: 120000 },
  async (t) => {
    const temporary = await mkdtemp(join(tmpdir(), 'voiced-document-'));
    t.after(() => rm(temporary, { recursive: true, force: true }));
    const source = join(temporary, 'source'),
      built = join(temporary, 'built'),
      portable = join(temporary, 'portable');
    await Promise.all(
      [source, portable, evidence].map((directory) => mkdir(directory, { recursive: true })),
    );
    const document = {
      version: 1,
      title: 'Площадь',
      models: [],
      views: [],
      chapters: [
        {
          id: 'area',
          title: 'Считаем',
          beats: [
            { id: 'count', text: 'Сначала считаем клетки.' },
            { id: 'result', text: 'Два ряда по три клетки.' },
          ],
        },
      ],
    };
    const settings = {
      enabled: true,
      provider: 'local',
      model: 'fixture',
      adapter: 'voice/adapter.mjs',
      voice: 'fixture',
      language: 'ru-RU',
    };
    await writeFile(join(source, 'story.json'), JSON.stringify(document));
    await writeFile(join(source, 'voice.json'), JSON.stringify(settings));
    await mkdir(join(source, 'voice'));
    await writeFile(
      join(source, settings.adapter),
      await readFile(new URL('./fixtures/voice-adapter.mjs', import.meta.url)),
    );
    const speech = await narrationSource(source);
    await buildAdapterNarration(source, speech.file, settings, {
      cache: join(temporary, 'speech'),
    });
    const receipt = JSON.parse(await readFile(join(source, 'timeline.json'), 'utf8'));
    const timing = playbackTimeline(receipt);
    assert.equal(receipt.synthesis.provider, 'local');
    assert.equal(
      timing.cues['area.result'].start,
      2.2,
      'the second phrase starts at its generated tone',
    );
    const explicit = {
      duration: timing.duration,
      segments: timing.segments,
      cues: {
        'area.count': { start: timing.cues['area.count'].start, end: 1 },
        'area.result': { start: 1, end: timing.duration },
      },
    };
    const html =
      '<!doctype html><html><head></head><body><main class="ve-scene" id="story"></main><audio data-silent="true" src="audio.wav"></audio><script type="module" src="scene.js"></script></body></html>';
    await writeFile(join(source, 'index.html'), setNarrationMode(html, false));
    await writeFile(
      join(source, 'scene.js'),
      `
    import { IllustratedStory, inkChapter } from '@visual-storytelling/core/story';
    import { areaDiagram } from '@visual-storytelling/core/recipes';
    import authored from './story.json';
    import '@visual-storytelling/core/style.css';
    window.galleryReady = IllustratedStory.mount(document.querySelector('main'), {
      document: authored, audio: document.querySelector('audio'),
      script: document.body.hasAttribute('data-explicit') ? ${JSON.stringify(explicit)} : undefined,
      chapters: { area: chapter => inkChapter({ ...chapter, create: areaDiagram,
        valuesAt: () => ({ width: 3, height: 2 }) }) },
    });
  `,
    );
    await buildScene(source, built, { sourcePackage: true });
    const packed = await packDirectory(built, 'index.html', { audio: 'original' });
    await writeFile(join(portable, 'index.html'), packed);
    await writeFile(
      join(built, 'index.html'),
      setNarrationMode(await readFile(join(built, 'index.html'), 'utf8'), true),
    );
    await writeFile(
      join(portable, 'silent.html'),
      await packDirectory(built, 'index.html', { audio: 'original' }),
    );
    await writeFile(
      join(portable, 'explicit.html'),
      packed
        .replace('<body>', '<body data-explicit>')
        .replace(
          /data-story-timeline="[^"]*"/,
          'data-story-timeline="data:application/json;base64,e30="',
        ),
    );
    await rm(source, { recursive: true });
    await rm(built, { recursive: true });
    for (const [entry, start, audible] of [
      ['index.html', timing.cues['area.result'].start, true],
      ['explicit.html', 1, true],
      ['silent.html', 2.5, false],
    ]) {
      const render = await renderer({
        directory: portable,
        entry,
        width: 800,
        theme: 'light',
        controls: true,
      });
      try {
        const cue = await render.capture.evaluate((scene) =>
          scene.review().cues.find((cue) => cue.id === 'area.result'),
        );
        assert.equal(cue.start, start);
        if (!audible) {
          assert.equal(await render.page.locator('audio').getAttribute('src'), null);
          assert.equal(
            await render.page.locator('audio').getAttribute('data-story-timeline'),
            null,
          );
          assert.deepEqual(
            render.messages.filter(({ type }) => type === 'error'),
            [],
          );
          continue;
        }
        await render.page.waitForFunction(() => document.querySelector('audio').readyState >= 1);
        await render.seek(4);
        const media = await render.page.locator('audio').evaluate((audio) => ({
          duration: audio.duration,
          time: audio.currentTime,
          source: audio.getAttribute('src'),
          timing: audio.dataset.storyTimeline,
        }));
        assert.equal(media.duration, timing.duration);
        assert.equal(media.time, 4);
        assert.match(media.source, /^data:audio\//);
        assert.match(media.timing, /^data:application\/json/);
        if (entry === 'index.html') {
          const embedded = JSON.parse(Buffer.from(media.timing.split(',')[1], 'base64').toString());
          assert.deepEqual(embedded, timing);
          for (const name of [
            'source_sha256',
            'authored_source_sha256',
            'audio_sha256',
            'digest_format',
            'voice_settings',
            'synthesis',
            'alignment',
            'sample_rate',
          ])
            assert.equal(Object.hasOwn(embedded, name), false, `playback excludes ${name}`);
        }
        await render.seek(0.5);
        assert.equal(
          await render.page.locator('audio').evaluate((audio) => audio.currentTime),
          0.5,
        );
        assert.deepEqual(
          render.messages.filter(({ type }) => type === 'error'),
          [],
        );
        if (entry === 'index.html')
          await writeFile(join(evidence, 'voiced.png'), await render.png());
      } finally {
        await render.close();
      }
    }
  },
);
