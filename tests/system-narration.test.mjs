import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { macosVoice, systemNarration } from '../tools/voice/macos.mjs';
import { checkNarration } from '../tools/narration.mjs';
import { captionTrack } from '../dist/story/captions.js';

test(
  'local voice keeps cue identities, reuses unchanged phrases and detects edited speech without Python',
  { skip: process.platform !== 'darwin', timeout: 60000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'story-voice-'));
    try {
      const status = await macosVoice.doctor();
      assert.equal(status.ready, true, status.reason);
      const voice = status.voices.find((v) => v.language === 'ru-RU');
      assert.ok(voice);
      const spec = {
        segments: [
          {
            id: 'first',
            text: 'Начнём в отмеченной точке. Три шага вправо.',
            cues: [{ id: 'right', quote: 'Три шага', action: 'Растёт стрелка.' }],
          },
          {
            id: 'second',
            text: 'Затем два шага вверх.',
            cues: [{ id: 'up', quote: 'два шага вверх', action: 'Стрелка поворачивает.' }],
          },
        ],
      };
      const settings = { enabled: true, provider: 'macos', voice: voice.id };
      const file = join(directory, 'narration.json');
      await writeFile(file, JSON.stringify(spec));
      await writeFile(join(directory, 'voice.json'), JSON.stringify(settings));
      const options = { cache: join(directory, '.cache'), signal: new AbortController().signal };
      const first = await systemNarration(directory, file, settings, options);
      assert.equal(first.cached, 0);
      const original = JSON.parse(await readFile(join(directory, 'timeline.json'), 'utf8'));
      await checkNarration('<audio src="audio.wav"></audio>', directory);
      spec.segments[1].text = 'Затем два шага вверх. Посмотрите на конец стрелки.';
      await writeFile(file, JSON.stringify(spec));
      await assert.rejects(
        checkNarration('<audio src="audio.wav"></audio>', directory),
        /Narration or voice changed/,
      );
      const second = await systemNarration(directory, file, settings, options);
      assert.equal(second.cached, 1);
      const changed = JSON.parse(await readFile(join(directory, 'timeline.json'), 'utf8'));
      assert.deepEqual(Object.keys(changed.cues), Object.keys(original.cues));
      assert.deepEqual(changed.cues.right, original.cues.right);
      assert.ok(changed.duration > original.duration);
      assert.match(captionTrack(changed).serialize('srt'), /отмеченной точке/);
      const audio = await readFile(join(directory, 'audio.wav'));
      assert.equal(audio.readUInt32LE(40), audio.length - 44);
      await checkNarration('<audio src="audio.wav"></audio>', directory);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  },
);
