import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScene } from '../tools/build-pages.mjs';
import { packDirectory } from '../tools/standalone.mjs';
import { setNarrationMode } from '../tools/narration.mjs';
import { voiceDigest } from '../tools/voice/macos.mjs';
import { renderer } from '../tools/render.mjs';
import { documentNarration } from '../dist/story/document.js';

const repository = fileURLToPath(new URL('../', import.meta.url));
const evidence = join(repository, 'artifacts/coherent-authoring/document-delivery');

test(
  'the three quiet documents pack and reopen without a narration resource',
  { timeout: 120000 },
  async (t) => {
    const temporary = await mkdtemp(join(tmpdir(), 'quiet-document-'));
    t.after(() => rm(temporary, { recursive: true, force: true }));
    await mkdir(evidence, { recursive: true });
    for (const name of ['tesla-circuit', 'thermostat-story', 'area-lesson']) {
      const built = join(temporary, name + '-build');
      await buildScene(join(repository, 'examples', name), built, {
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
            id: name === 'area-lesson' ? 'prediction' : 'workshop.explain',
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
      title: 'Площадь',
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
    const timing = {
      duration: 6,
      segments: [
        { id: 'area', start: 0, end: 6, text: 'Сначала считаем клетки. Два ряда по три клетки.' },
      ],
      cues: { 'area.count': { start: 0, end: 3 }, 'area.result': { start: 3, end: 6 } },
    };
    const explicit = {
      duration: 6,
      segments: timing.segments,
      cues: { 'area.count': { start: 0, end: 1 }, 'area.result': { start: 1, end: 6 } },
    };
    const settings = { enabled: true, provider: 'macos', voice: 'test-fixture' };
    await writeFile(join(source, 'story.json'), JSON.stringify(document));
    await writeFile(join(source, 'voice.json'), JSON.stringify(settings));
    await writeFile(
      join(source, 'timeline.json'),
      JSON.stringify({
        ...timing,
        audio: 'audio.wav',
        digest_format: 'canonical-json-v1',
        source_sha256: voiceDigest(documentNarration(document)),
        voice_settings: settings,
        synthesis: { provider: 'macos', reference_path: '/private/source-only.wav' },
      }),
    );
    // A real, decodable WAV exercises media duration and absolute seek without a model download.
    const rate = 8000,
      wav = Buffer.alloc(44 + 6 * rate * 2);
    wav.write('RIFF');
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(rate, 24);
    wav.writeUInt32LE(rate * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(wav.length - 44, 40);
    await writeFile(join(source, 'audio.wav'), wav);
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
    assert.ok(!packed.includes('/private/source-only.wav'));
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
      ['index.html', 3, true],
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
        assert.equal(media.duration, 6);
        assert.equal(media.time, 4);
        assert.match(media.source, /^data:audio\//);
        assert.match(media.timing, /^data:application\/json/);
        if (entry === 'index.html')
          assert.deepEqual(
            JSON.parse(Buffer.from(media.timing.split(',')[1], 'base64').toString()),
            timing,
          );
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
