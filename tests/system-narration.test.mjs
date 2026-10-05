import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { macosVoice, systemNarration } from '../tools/voice/macos.mjs';
import { checkNarration, prepareNarration } from '../tools/narration.mjs';
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
        outro: 12,
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
      const options = {
        cache: join(directory, '.cache', 'speech'),
        signal: new AbortController().signal,
      };
      const first = await systemNarration(directory, file, settings, options);
      assert.equal(first.cached, 0);
      const original = JSON.parse(await readFile(join(directory, 'timeline.json'), 'utf8'));
      await checkNarration('<audio src="audio.wav"></audio>', directory);
      const originalAudio = await readFile(join(directory, 'audio.wav'));
      spec.segments[0].cues[0].timing = { until: 'up', delay: 0.1 };
      spec.segments[1].cues[0].timing = { duration: 9 };
      await writeFile(file, JSON.stringify(spec));
      await assert.rejects(
        checkNarration('<audio src="audio.wav"></audio>', directory),
        /Narration or voice changed/,
      );
      const retime = await systemNarration(directory, file, settings, options);
      assert.equal(retime.cached, 2, 'editing action timing reuses both accepted speech takes');
      const retimed = JSON.parse(await readFile(join(directory, 'timeline.json'), 'utf8'));
      assert.deepEqual(retimed.segments, original.segments);
      assert.deepEqual(retimed.cues.right, {
        ...original.cues.right,
        timing: { until: 'up', delay: 0.1 },
      });
      assert.deepEqual(retimed.cues.up, { ...original.cues.up, timing: { duration: 9 } });
      assert.deepEqual(await readFile(join(directory, 'audio.wav')), originalAudio);
      await checkNarration('<audio src="audio.wav"></audio>', directory);

      // Older native builds hashed authored timing but dropped it from the aligned cues.
      const obsolete = structuredClone(retimed);
      delete obsolete.cues.up.timing;
      await writeFile(join(directory, 'timeline.json'), JSON.stringify(obsolete));
      await assert.rejects(
        checkNarration('<audio src="audio.wav"></audio>', directory),
        /action timing is stale for up/,
      );
      await writeFile(join(directory, 'index.html'), '<audio src="audio.wav"></audio>');
      const takeTimes = () =>
        readdir(options.cache).then((names) =>
          Promise.all(
            names
              .sort()
              .map((name) => stat(join(options.cache, name, 'audio.raw')).then((s) => s.mtimeMs)),
          ),
        );
      const cachedTimes = await takeTimes();
      const dataDirectory = process.env.VISUAL_STORY_DATA_DIR;
      process.env.VISUAL_STORY_DATA_DIR = join(directory, '.cache');
      try {
        await prepareNarration(directory);
      } finally {
        if (dataDirectory === undefined) delete process.env.VISUAL_STORY_DATA_DIR;
        else process.env.VISUAL_STORY_DATA_DIR = dataDirectory;
      }
      assert.deepEqual(await takeTimes(), cachedTimes, 'prepare reuses the accepted speech takes');
      assert.deepEqual(
        JSON.parse(await readFile(join(directory, 'timeline.json'), 'utf8')),
        retimed,
      );
      assert.deepEqual(await readFile(join(directory, 'audio.wav')), originalAudio);

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
      assert.deepEqual(changed.cues.right, retimed.cues.right);
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
