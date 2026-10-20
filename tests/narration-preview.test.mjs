import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { narrationPreview } from '../tools/voice/preview.mjs';
import { buildNarration, requireNarration, checkNarration } from '../tools/narration.mjs';
import { validateStoryDocument } from '../dist/story/document.js';
import { captionTrack } from '../dist/story/captions.js';
import { playbackTimeline } from '../tools/narration.mjs';
import { voiceAdapter } from './support/voice-adapter.mjs';

const document = () =>
  validateStoryDocument({
    version: 2,
    title: 'Наблюдение и число',
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
            speech: { id: 'voice.look', when: { basis: 'presented', models: [] } },
          },
          {
            id: 'number',
            say: 'Здесь семнадцать предметов.',
            speech: {
              id: 'voice.number',
              when: { basis: 'presented', models: [{ model: 'division', inputs: { count: 17 } }] },
            },
          },
        ],
      },
    ],
    narration: { intro: 0.2, outro: 0.3, pause: 0.2 },
  });

test(
  'read-only preview retains accepted whole takes and never repairs stale speech by synthesis',
  { timeout: 60000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'narration-preview-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const accepted = join(root, 'accepted'),
      current = join(root, 'current'),
      cache = join(root, 'cache');
    await mkdir(join(accepted, 'voice'), { recursive: true });
    const put = (directory, name, value) =>
      writeFile(join(directory, name), typeof value === 'string' ? value : JSON.stringify(value));
    const source = document();
    const settings = {
      provider: 'local',
      enabled: true,
      model: 'fixture',
      adapter: 'voice/adapter.mjs',
      voice: 'chosen',
      language: 'ru-RU',
    };
    await put(accepted, 'story.json', source);
    await put(accepted, 'voice.json', settings);
    await put(accepted, 'story-project.json', { version: 1, modules: [], resources: [] });
    await put(accepted, 'voice/adapter.mjs', voiceAdapter);
    await buildNarration(accepted, { cache });
    assert.deepEqual((await narrationPreview(accepted)).status.pending, []);
    await cp(accepted, current, { recursive: true });
    await rm(join(current, '.voice-calls'));
    const changed = structuredClone(source);
    changed.chapters[0].beats[0].say = 'Посмотрим на эти рисунки.';
    await put(current, 'story.json', changed);
    const before = await readFile(join(current, 'audio.wav'));
    const preview = await narrationPreview(current, { acceptedDirectory: accepted });
    assert.equal(preview.playable, true);
    assert.equal(preview.partial, true);
    assert.deepEqual(preview.status.ready, ['voice.number']);
    assert.deepEqual(preview.status.pending, ['voice.look']);
    assert.equal(preview.status.preparation.units, 1);
    assert.equal(preview.status.preparation.characters, changed.chapters[0].beats[0].say.length);
    assert.deepEqual(preview.displayText, { 'voice.look': 'Посмотрим на эти рисунки.' });
    await assert.rejects(requireNarration(current), /changed/i);
    await assert.rejects(readFile(join(current, '.voice-calls')), { code: 'ENOENT' });
    assert.deepEqual(await readFile(join(current, 'audio.wav')), before);
    await put(current, 'voice.json', { ...settings, voice: 'different' });
    assert.equal(
      (await narrationPreview(current, { acceptedDirectory: accepted })).playable,
      false,
    );
    await put(current, 'voice.json', settings);
    await writeFile(join(current, 'audio.wav'), Buffer.alloc(before.length));
    assert.equal(
      (await narrationPreview(current, { acceptedDirectory: accepted })).playable,
      false,
    );
    await writeFile(join(current, 'audio.wav'), before);
    await rm(cache, { recursive: true, force: true });
    await buildNarration(current, { cache });
    assert.deepEqual(
      (await readFile(join(current, '.voice-calls'), 'utf8'))
        .trim()
        .split('\n')
        .map(JSON.parse)
        .map((call) => call.text),
      ['Посмотрим на эти рисунки.'],
    );
    assert.deepEqual((await narrationPreview(current)).status.pending, []);
    await requireNarration(current);
    const receipt = JSON.parse(await readFile(join(current, 'timeline.json'), 'utf8'));
    receipt.segments[0].displayText = 'Это не принятая речь.';
    await put(current, 'timeline.json', receipt);
    await assert.rejects(
      checkNarration('<audio src="audio.wav"></audio>', current),
      /derived pending caption/,
    );
    await put(current, 'voice.json', { ...settings, enabled: false });
    assert.deepEqual(await requireNarration(current), { silent: true });
  },
);

test('pending captions are scoped to their take and never replace matching phrases in ready speech', () => {
  const timeline = {
    duration: 4,
    cues: {},
    segments: [
      {
        id: 'pending',
        start: 0,
        end: 1,
        text: 'Да.',
        displayText: 'Нет.',
        words: [{ text: 'Да.', start: 0, end: 1 }],
      },
      {
        id: 'ready',
        start: 2,
        end: 4,
        text: 'Да. Это работает.',
        words: [
          { text: 'Да.', start: 2, end: 2.4 },
          { text: 'Это работает.', start: 2.5, end: 4 },
        ],
      },
    ],
  };
  const script = playbackTimeline(timeline),
    track = captionTrack(script);
  assert.equal(script.segments[0].text, 'Да.');
  assert.equal(track.at(0.5), 'Нет.');
  assert.equal(track.at(3), 'Да. Это работает.');
});
