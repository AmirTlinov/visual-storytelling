import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID, createHash } from 'node:crypto';
import { JobRunner } from '../plugin/jobs.mjs';
import {
  buildAdapterNarration,
  checkAdapterNarration,
  bindAdapterRecording,
} from '../tools/voice/adapter.mjs';
import { bindAcceptedSpeech } from '../tools/migrate-speech.mjs';
import { adapterVoiceStatus, validateAdapterSettings } from '../tools/voice/adapter-input.mjs';
import { voiceDigest } from '../tools/voice/receipt.mjs';
import { masteringProfileHash } from '../tools/voice/mastering.mjs';
import { documentNarration } from '../dist/story/document.js';

import { voiceAdapter as adapter } from './support/voice-adapter.mjs';

async function fixture(t, { two = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'story-voice-adapter-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'voice'));
  const entry = join(directory, 'voice/adapter.mjs');
  await writeFile(entry, adapter);
  const source = join(directory, 'narration.json'),
    cache = join(directory, '.speech-cache');
  const spec = {
    version: 3,
    intro: 0.2,
    outro: 0.3,
    music: null,
    segments: [
      {
        id: 'step',
        title: 'Шаг',
        text: 'Один шаг вправо.',
        pause_after: 0.2,
        cues: [
          {
            id: 'move',
            quote: 'Один шаг вправо.',
            action: 'Сдвинуть точку.',
            timing: { duration: 1.1 },
          },
        ],
      },
    ],
  };
  if (two) spec.segments.push({ id: 'return', text: 'Теперь вернёмся.', pause_after: 0.1 });
  const settings = {
    provider: 'local',
    adapter: 'voice/adapter.mjs',
    model: 'fixture',
    voice: 'chosen',
    language: 'ru-RU',
    enabled: true,
  };
  const save = async () => {
    await writeFile(source, JSON.stringify(spec));
    await writeFile(join(directory, 'voice.json'), JSON.stringify(settings));
  };
  await save();
  return {
    directory,
    entry,
    source,
    cache,
    spec,
    settings,
    save,
    build: (options = {}) =>
      buildAdapterNarration(directory, source, settings, { cache, ...options }),
    receipt: () => readFile(join(directory, 'timeline.json'), 'utf8').then(JSON.parse),
    calls: () =>
      readFile(join(directory, '.voice-calls'), 'utf8').then(
        (text) => text.trim().split('\n').map(JSON.parse),
        (error) => {
          if (error.code !== 'ENOENT') throw error;
          return [];
        },
      ),
    pair: async () =>
      Promise.all(['audio.wav', 'timeline.json'].map((name) => readFile(join(directory, name)))),
  };
}

async function until(check) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(20);
  }
  throw new Error('Fixture did not reach its expected state.');
}
const exists = (path) =>
  readFile(path).then(
    () => true,
    (error) => {
      if (error.code !== 'ENOENT') throw error;
      return false;
    },
  );

test('document occurrences bind repeated Unicode and numeric speech to distinct measured words', async (t) => {
  const f = await fixture(t);
  const sayings = [
    'First step.',
    'STEP!',
    'Step.',
    'Шаг 1.',
    'Шаг 2.',
    'Шаг 1!',
    'Élan 2.',
    'ÉLAN 2!',
  ];
  f.spec = documentNarration({
    version: 2,
    title: 'Repeated speech',
    models: [],
    views: [],
    chapters: [
      {
        id: 'lesson',
        title: 'Words',
        beats: sayings.map((say, i) => ({
          id: `word${i}`,
          say,
          speech: { id: 'lesson', when: { basis: 'authored', models: [] } },
        })),
      },
    ],
  });
  assert.deepEqual(
    f.spec.segments[0].cues.map((cue) => cue.occurrence),
    [1, 2, 3, 1, 1, 2, 1, 2],
  );
  // Each fixture word has an actual separate interval in the generated two-second waveform.
  await writeFile(
    f.entry,
    adapter.replace(
      'let words=[{text:request.text,start:.1,end:1.9}];',
      'let words=request.text.match(/[\\p{L}\\p{N}]+/gu).map((text,i)=>({text,start:.1+i*.1,end:.19+i*.1}));',
    ),
  );
  f.settings.language = 'en-US';
  // The fixture's save/build closures keep their original spec reference.
  await writeFile(f.source, JSON.stringify(f.spec));
  await writeFile(join(f.directory, 'voice.json'), JSON.stringify(f.settings));
  await f.build();
  const receipt = await f.receipt();
  await checkAdapterNarration(f.directory, f.source, receipt, f.settings);
  const starts = f.spec.segments[0].cues.map((cue) => receipt.cues[cue.id].start);
  assert.equal(
    new Set(starts).size,
    sayings.length,
    'repeated cues must not collapse to the first phrase',
  );
  assert.ok(starts.every((start, i) => !i || start > starts[i - 1]));
});

test('local and API selection share verified assembly, precise phrase anchors and reusable takes', async (t) => {
  const f = await fixture(t, { two: true });
  assert.equal((await adapterVoiceStatus(f.directory, f.settings)).ready, true);
  assert.equal((await adapterVoiceStatus(f.directory, { provider: 'api' })).ready, false);
  assert.equal((await f.calls()).length, 0, 'discovery must not invoke a model or API');
  for (const provider of ['local', 'api']) {
    f.settings.provider = provider;
    await f.save();
    const first = await f.build();
    assert.equal(first.cached, 0);
    const receipt = await f.receipt();
    assert.equal(receipt.digest_format, 'voice-adapter-v1');
    assert.equal(receipt.synthesis.provider, provider);
    assert.equal(
      receipt.segments[0].words.length,
      1,
      'phrase precision must not be fabricated into separate words',
    );
    assert.equal(receipt.cues.move.start, 0.2 + 0.1);
    assert.deepEqual(receipt.cues.move.timing, { duration: 1.1 });
    assert.equal(receipt.segments[1].audio_start, 2.4);
    await checkAdapterNarration(f.directory, f.source, receipt, f.settings);
    const original = await f.pair();
    assert.equal((await f.build()).cached, 2);
    assert.deepEqual(
      await f.pair(),
      original,
      'cache reuse preserves the accepted recording and receipt',
    );
  }
  assert.equal((await f.calls()).length, 4);
  f.spec.segments[0].pause_after = 0.8;
  f.spec.segments[0].cues[0].timing = { duration: 1.3 };
  await f.save();
  assert.equal((await f.build()).cached, 2, 'authored pauses/actions do not resynthesize speech');
  f.spec.segments[1].text = 'А теперь обратно.';
  await f.save();
  assert.equal((await f.build()).cached, 1);
  assert.equal((await f.calls()).length, 5);
  const previous = await f.receipt();
  f.settings.voice = 'another';
  await f.save();
  await assert.rejects(
    checkAdapterNarration(f.directory, f.source, previous, f.settings),
    /changed/,
  );
  assert.equal((await f.build()).cached, 0);
  assert.equal((await f.calls()).length, 7);
});

test('a phrase-level recording rejects interior cues and preserves the accepted pair until measured word endpoints exist', async (t) => {
  const f = await fixture(t);
  await f.build();
  const original = await f.pair();
  f.spec.segments[0].cues[0].quote = 'шаг вправо';
  await f.save();
  await assert.rejects(f.build(), /needs measured word or phrase endpoints/);
  assert.deepEqual(await f.pair(), original);
  assert.equal((await f.calls()).length, 1, 'changing actions reuses the whole take');
  f.settings.model = 'word-precision';
  await f.save();
  await f.build();
  const receipt = await f.receipt();
  assert.equal(receipt.segments[0].words.length, 3);
  assert.equal(receipt.cues.move.start, receipt.segments[0].words[1].start);
  assert.equal(receipt.cues.move.end, receipt.segments[0].words[2].end);
});

test('accepted adapter audio remasters locally, preserves alignment and then skips FFmpeg and the provider', async (t) => {
  const f = await fixture(t, { two: true });
  f.settings.provider = 'api';
  await f.save();
  await f.build();
  const before = await f.receipt();
  delete before.mix;
  await writeFile(join(f.directory, 'timeline.json'), JSON.stringify(before));
  await assert.rejects(
    checkAdapterNarration(f.directory, f.source, before, f.settings),
    /mastering changed/,
  );
  const calls = await f.calls();
  await rm(f.cache, { recursive: true }); // Remix must not require cached takes or call a model.
  const result = await f.build();
  assert.equal(result.cached, 2);
  assert.deepEqual(await f.calls(), calls);
  const after = await f.receipt();
  assert.equal(after.mix.mastering.profile_sha256, masteringProfileHash);
  assert.deepEqual(after.segments, before.segments);
  assert.deepEqual(after.cues, before.cues);
  assert.equal(after.duration, before.duration);
  assert.equal(after.sample_rate, before.sample_rate);
  assert(Math.abs(after.mix.mastering.integrated_lufs + 16) < 0.2);
  assert(after.mix.mastering.true_peak_dbtp <= -1.5);
  const pair = await f.pair(),
    path = process.env.PATH;
  try {
    process.env.PATH = '/nonexistent-no-ffmpeg-or-node';
    await f.build();
    await checkAdapterNarration(f.directory, f.source, after, f.settings);
  } finally {
    process.env.PATH = path;
  }
  assert.deepEqual(await f.pair(), pair);
  assert.deepEqual(await f.calls(), calls);
});

test('unavailable mastering and damaged accepted audio cannot trigger another provider request or replace files', async (t) => {
  const f = await fixture(t);
  await f.build();
  const old = await f.receipt();
  delete old.mix;
  await writeFile(join(f.directory, 'timeline.json'), JSON.stringify(old));
  const pair = await f.pair(),
    calls = await f.calls(),
    path = process.env.PATH;
  try {
    process.env.PATH = '/nonexistent-no-ffmpeg-or-node';
    await assert.rejects(f.build(), /ffmpeg/);
  } finally {
    process.env.PATH = path;
  }
  assert.deepEqual(await f.pair(), pair);
  const silent = Buffer.from(pair[0]);
  silent.fill(0, 44);
  await writeFile(join(f.directory, 'audio.wav'), silent);
  old.audio_sha256 = createHash('sha256').update(silent).digest('hex');
  await writeFile(join(f.directory, 'timeline.json'), JSON.stringify(old));
  const damaged = await f.pair();
  await assert.rejects(f.build(), /silent/);
  assert.deepEqual(await f.pair(), damaged);
  assert.deepEqual(await f.calls(), calls);
});

test('malformed audio, incomplete markers and provider output cannot replace a good recording or leak secrets', async (t) => {
  const f = await fixture(t);
  await f.build();
  const original = await f.pair();
  for (const mode of [
    'truncated',
    'stereo',
    'missing',
    'overlap',
    'outside',
    'nonfinite',
    'secret',
    'bad-json',
    'overflow',
  ]) {
    f.settings.model = mode;
    await f.save();
    await assert.rejects(
      f.build(),
      (error) => {
        assert.doesNotMatch(error.message, /SECRET|api-token/);
        return /adapter|Voice/i.test(error.message);
      },
      mode,
    );
    assert.deepEqual(await f.pair(), original, `${mode} changed accepted audio`);
  }
});

test('unsupported music/controls and invalid cue quotes fail before a paid API call', async (t) => {
  const f = await fixture(t);
  f.settings.provider = 'api';
  const original = structuredClone(f.spec);
  const cases = [
    () => {
      f.spec.music = { track: 'inspired' };
    },
    () => {
      f.spec.voice = { delivery: '<|emotion:enthusiasm|>' };
    },
    () => {
      f.spec.voice = { reference_audio: 'voice.wav', reference_text: 'sample' };
    },
    () => {
      f.spec.segments[0].text = '<|prosody:speed_fast|>Один шаг вправо.';
    },
    () => {
      f.spec.segments[0].cues[0].quote = 'отсутствующие слова';
    },
    () => {
      f.spec.segments[0].cues[0].timing = { until: 'missing' };
    },
  ];
  for (const change of cases) {
    for (const key of Object.keys(f.spec)) delete f.spec[key];
    Object.assign(f.spec, structuredClone(original));
    change();
    await f.save();
    await assert.rejects(f.build());
  }
  assert.equal((await f.calls()).length, 0);
  assert.throws(
    () => validateAdapterSettings({ ...f.settings, apiKey: 'SECRET-api-token' }),
    /credentials/,
  );
});

test('receipts bind source, selected model, adapter dependencies, exact audio and action timing without another invocation', async (t) => {
  const f = await fixture(t);
  await f.build();
  const receipt = await f.receipt(),
    original = await f.pair();
  await checkAdapterNarration(
    f.directory,
    { file: f.source, directory: f.directory },
    receipt,
    f.settings,
  );
  const changed = structuredClone(receipt);
  changed.cues.move.timing.duration = 1.2;
  await assert.rejects(checkAdapterNarration(f.directory, f.source, changed, f.settings), /cues/);
  const bytes = Buffer.from(original[0]);
  bytes[1000] ^= 1;
  await writeFile(join(f.directory, 'audio.wav'), bytes);
  await assert.rejects(
    checkAdapterNarration(f.directory, f.source, receipt, f.settings),
    /verified receipt/,
  );
  await writeFile(join(f.directory, 'audio.wav'), original[0]);
  await writeFile(join(f.directory, 'voice/helper.json'), '{"revision":2}');
  await assert.rejects(
    checkAdapterNarration(f.directory, f.source, receipt, f.settings),
    /changed/,
  );
  await rm(join(f.directory, 'voice/helper.json'));
  f.spec.segments[0].text = 'Другой шаг вправо.';
  f.spec.segments[0].cues[0].quote = 'Другой шаг вправо.';
  await f.save();
  await assert.rejects(
    checkAdapterNarration(f.directory, f.source, receipt, f.settings),
    /changed/,
  );
  assert.equal((await f.calls()).length, 1);
  assert.equal(voiceDigest({ b: 2, a: { d: 4, c: 3 } }), voiceDigest({ a: { c: 3, d: 4 }, b: 2 }));
});

test('changing adapter code during synthesis cannot poison the old implementation cache', async (t) => {
  const f = await fixture(t);
  await f.build();
  const original = await f.pair(),
    cache = (await readdir(f.cache)).sort();
  f.settings.model = 'changed-adapter';
  await f.save();
  for (let attempt = 0; attempt < 2; attempt++) {
    await writeFile(f.entry, adapter);
    await assert.rejects(f.build(), /changed during synthesis/);
    assert.deepEqual(await f.pair(), original);
    assert.deepEqual((await readdir(f.cache)).sort(), cache);
  }
  assert.equal((await f.calls()).length, 3);
});

test('source changes during synthesis preserve the accepted pair, including projected story input', async (t) => {
  const f = await fixture(t);
  await f.build();
  const original = await f.pair();
  // sourceFile can be an immutable speech projection while its authored story changes.
  await writeFile(join(f.directory, 'story.json'), '{"version":1,"title":"before"}');
  f.settings.model = 'wait';
  await f.save();
  const building = f.build();
  await until(() => exists(join(f.directory, '.voice-started')));
  await writeFile(join(f.directory, 'story.json'), '{"version":1,"title":"after"}');
  await assert.rejects(building, /changed during synthesis/);
  assert.deepEqual(await f.pair(), original);
});

test(
  'standalone cancellation stops the local adapter and its model child and keeps accepted media',
  { skip: process.platform === 'win32' },
  async (t) => {
    const f = await fixture(t);
    await f.build();
    const original = await f.pair();
    f.settings.model = 'child';
    await f.save();
    const controller = new AbortController();
    const building = f.build({ signal: controller.signal });
    await until(() => exists(join(f.directory, '.voice-child')));
    const pid = Number(await readFile(join(f.directory, '.voice-child'), 'utf8'));
    t.after(() => {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    });
    controller.abort(new Error('Voice preparation cancelled.'));
    await assert.rejects(building, /cancelled/);
    await until(() => {
      try {
        process.kill(pid, 0);
        return false;
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
        return true;
      }
    });
    assert.deepEqual(await f.pair(), original);
  },
);

test('symlink dependencies and escaping entrypoints are rejected before execution', async (t) => {
  const f = await fixture(t);
  assert.throws(
    () => validateAdapterSettings({ ...f.settings, adapter: '../adapter.mjs' }),
    /project-relative/,
  );
  await symlink(f.source, join(f.directory, 'voice/linked-source.json'));
  assert.equal((await adapterVoiceStatus(f.directory, f.settings)).ready, false);
  await assert.rejects(f.build(), /symbolic links/);
  assert.equal((await f.calls()).length, 0);
});

test(
  'JobRunner retains model process ownership when an adapter is cancelled or exits with inherited pipes open',
  { skip: process.platform === 'win32', timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    await f.build();
    const original = await f.pair();
    const entry = join(f.directory, 'worker.mjs'),
      toolchainRoot = join(f.directory, '.release');
    await mkdir(toolchainRoot);
    await writeFile(
      entry,
      `import {buildAdapterNarration} from ${JSON.stringify(new URL('../tools/voice/adapter.mjs', import.meta.url).href)};
const controller=new AbortController();
process.on('message',async message=>{
  if(message.type==='cancel'){controller.abort(new Error('Preparation cancelled.'));return;}
  let terminal;
  try {
    const {directory,source,settings,cache}=message.input;
    const result=await buildAdapterNarration(directory,source,settings,{cache,signal:controller.signal,managedProcessGroup:true});
    terminal={type:'result',result};
  } catch(error) {terminal={type:'error',error:error.message,cancelled:controller.signal.aborted};}
  process.send(terminal,()=>process.disconnect());
});`,
    );
    const runner = new JobRunner(join(f.directory, '.jobs'), entry, undefined, { toolchainRoot });
    await runner.start();
    try {
      for (const mode of ['child', 'exit-child', 'exit-success-child']) {
        f.settings.model = mode;
        await f.save();
        await rm(join(f.directory, '.voice-child'), { force: true });
        const job = await runner.enqueue(
          'build',
          {
            projectId: 'voice',
            directory: f.directory,
            source: f.source,
            settings: f.settings,
            cache: f.cache,
          },
          randomUUID(),
        );
        await until(() => exists(join(f.directory, '.voice-child')));
        const pid = Number(await readFile(join(f.directory, '.voice-child'), 'utf8'));
        t.after(() => {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {}
        });
        if (mode !== 'exit-child') {
          if (mode === 'exit-success-child') await delay(100);
          await runner.cancel(job.id);
        }
        await until(() => !['queued', 'running', 'cancelling'].includes(runner.get(job.id).status));
        assert.equal(
          runner.get(job.id).status,
          mode === 'exit-child' ? 'failed' : 'cancelled',
          JSON.stringify({ mode, error: runner.get(job.id).error }),
        );
        if (mode === 'exit-child') assert.match(runner.get(job.id).error, /exit 1/);
        await until(() => {
          try {
            process.kill(pid, 0);
            return false;
          } catch (error) {
            if (error.code !== 'ESRCH') throw error;
            return true;
          }
        });
        assert.deepEqual(await f.pair(), original);
      }
    } finally {
      await runner.close();
    }
  },
);

test('explicit whole-take migration preserves audio and measured bounds without provider calls', async (t) => {
  const f = await fixture(t);
  f.settings.model = 'word-precision';
  await f.save();
  const source = {
    version: 2,
    title: 'Проверим шаг',
    models: [],
    views: [],
    chapters: [
      {
        id: 'lesson',
        title: 'Шаг',
        beats: [
          { id: 'first', say: 'Один шаг вправо.', action: 'Движение', seconds: 1 },
          { id: 'return', say: 'Теперь вернёмся.', action: 'Обратно', seconds: 1 },
        ],
      },
    ],
    narration: { intro: 0.2, outro: 0.3, pause: 0.2 },
  };
  f.spec.segments = [
    {
      id: 'lesson',
      title: 'Шаг',
      text: 'Один шаг вправо. Теперь вернёмся.',
      pause_after: 0.2,
      cues: [
        { id: 'lesson.first', quote: 'Один шаг вправо.', occurrence: 1, action: 'Движение' },
        { id: 'lesson.return', quote: 'Теперь вернёмся.', occurrence: 1, action: 'Обратно' },
      ],
    },
  ];
  // This test replaces the fixture's source explicitly; its build closure owns the file.
  await writeFile(f.source, JSON.stringify(f.spec));
  await f.build();
  const before = await f.receipt(),
    bytes = await readFile(join(f.directory, 'audio.wav'));
  const bound = bindAcceptedSpeech(source, before);
  assert.deepEqual(
    bound.chapters[0].beats.map((beat) => beat.speech.id),
    ['lesson', 'lesson'],
  );
  await writeFile(join(f.directory, 'story.json'), JSON.stringify(bound));
  await writeFile(f.source, JSON.stringify(documentNarration(bound)));
  const next = await bindAdapterRecording(f.directory, f.source, f.settings);
  assert.equal((await f.calls()).length, 1);
  assert.deepEqual(await readFile(join(f.directory, 'audio.wav')), bytes);
  for (const key of ['words', 'audio_start', 'audio_end', 'start', 'end'])
    assert.deepEqual(next.segments[0][key], before.segments[0][key]);
  await checkAdapterNarration(f.directory, f.source, next, f.settings);
  assert.equal((await f.build()).cached, 1);
  assert.equal((await f.calls()).length, 1);
  const changed = structuredClone(source);
  changed.chapters[0].beats[0].say = 'Два шага вправо.';
  assert.throws(() => bindAcceptedSpeech(changed, before), /change accepted whole take/);
});

test('document thought IDs give local synthesis while camera, colour and dependencies reuse the accepted takes', async (t) => {
  const f = await fixture(t);
  const document = {
    version: 2,
    models: [{ id: 'division', module: 'division', inputs: { count: 17, divisor: 4 } }],
    views: [{ id: 'groups', kind: 'groups', model: 'division' }],
    chapters: [
      {
        id: 'lesson',
        title: 'Шаг',
        beats: [
          { id: 'step', say: 'Один шаг вправо.', action: 'Движение' },
          { id: 'return', say: 'Теперь вернёмся.', action: 'Обратно' },
        ],
      },
    ],
    narration: { intro: 0.2, outro: 0.3, pause: 0.1 },
  };
  const save = async () => {
    const spec = documentNarration(document);
    await writeFile(f.source, JSON.stringify(spec));
    await writeFile(join(f.directory, 'story.json'), JSON.stringify(document));
    return spec;
  };
  const initial = await save();
  assert.deepEqual(
    initial.segments.map((unit) => unit.id),
    ['voice.lesson.step', 'voice.lesson.return'],
  );
  await f.build();
  const before = await f.receipt();
  document.chapters[0].beats[0].focus = ['division:remainder'];
  document.title = 'Меняем цвет рисунка';
  await save();
  assert.equal((await f.build()).cached, 2);
  assert.equal((await f.calls()).length, 2);
  document.chapters[0].beats[0].say = 'Два шага вправо.';
  await save();
  const changed = await f.build();
  assert.equal(changed.cached, 1);
  assert.equal((await f.calls()).length, 3);
  const after = await f.receipt();
  assert.deepEqual(after.segments[1].words, before.segments[1].words);
  assert.deepEqual(after.alignment.segments[1], before.alignment.segments[1]);
});

test('root adapter owns explicit code dependencies and migrates accepted cache identity without another provider request', async (t) => {
  const { rename, cp } = await import('node:fs/promises');
  const { adapterInput, historicalRootAdapterInput, adapterSelection } = await import(
    '../tools/voice/adapter-input.mjs'
  );
  const { acceptedAdapterForMigration } = await import('../tools/migrate-speech.mjs');
  const f = await fixture(t, { two: true });
  await rename(f.entry, join(f.directory, 'adapter.mjs'));
  f.settings.adapter = 'adapter.mjs';
  await f.save();
  await writeFile(join(f.directory, 'scene.js'), '// author camera 1');
  await writeFile(join(f.directory, 'story.json'), JSON.stringify({ version: 2, chapters: [] }));
  const current = (await adapterInput(f.directory, f.settings)).identity;
  await f.build();
  const previous = await f.receipt(),
    bytes = await readFile(join(f.directory, 'audio.wav'));
  const legacy = (await historicalRootAdapterInput(f.directory, f.settings)).identity;
  assert.notEqual(current, legacy);
  const key = (identity, text) =>
    voiceDigest({ version: 1, adapter: identity, settings: adapterSelection(f.settings), text });
  for (const unit of f.spec.segments) {
    const original = join(f.cache, 'adapter-' + key(current, unit.text));
    const historical = join(f.cache, 'adapter-' + key(legacy, unit.text));
    await cp(original, historical, { recursive: true });
    const record = JSON.parse(await readFile(join(historical, 'take.json'), 'utf8'));
    record.key = key(legacy, unit.text);
    await writeFile(join(historical, 'take.json'), JSON.stringify(record));
    await rm(original, { recursive: true });
  }
  previous.synthesis.adapter_sha256 = legacy;
  await writeFile(join(f.directory, 'timeline.json'), JSON.stringify(previous));
  const accepted = await acceptedAdapterForMigration(f.directory);
  assert.deepEqual(accepted, { current, accepted: legacy });
  await writeFile(
    join(f.directory, 'story.json'),
    JSON.stringify({ version: 2, chapters: [], speech: 'new binding' }),
  );
  await writeFile(join(f.directory, 'scene.js'), '// author camera 2');
  for (const unit of f.spec.segments) unit.conditions = { basis: 'presented', models: [] };
  await f.save();
  assert.equal((await adapterInput(f.directory, f.settings)).identity, current);
  await bindAdapterRecording(f.directory, f.source, f.settings, {
    cache: f.cache,
    previousAdapter: accepted,
  });
  assert.deepEqual(await readFile(join(f.directory, 'audio.wav')), bytes);
  assert.equal((await f.calls()).length, 2);
  assert.equal((await f.build()).cached, 2);
  f.spec.segments[0].text = 'Два шага вправо.';
  f.spec.segments[0].cues[0].quote = 'Два шага вправо.';
  await f.save();
  assert.equal((await f.build()).cached, 1);
  assert.equal((await f.calls()).length, 3);
});

test('root adapter fingerprints literal resources and rejects computed resource URLs before reuse', async (t) => {
  const { rename } = await import('node:fs/promises');
  const { adapterInput } = await import('../tools/voice/adapter-input.mjs');
  const f = await fixture(t);
  const entry = join(f.directory, 'adapter.mjs');
  await rename(f.entry, entry);
  f.settings.adapter = 'adapter.mjs';
  const source = await readFile(entry, 'utf8');
  await writeFile(join(f.directory, 'voice.bin'), 'voice A');
  await writeFile(entry, source + '\nnew URL("voice.bin", import.meta.url);');
  const before = (await adapterInput(f.directory, f.settings)).identity;
  await writeFile(join(f.directory, 'voice.bin'), 'voice B');
  assert.notEqual((await adapterInput(f.directory, f.settings)).identity, before);
  await writeFile(entry, source + '\nconst name="voice.bin"; new URL(name, import.meta.url);');
  await assert.rejects(adapterInput(f.directory, f.settings), /literal resource URLs/);
});

test('whole-take recovery tolerates PCM quantization at full-scale peaks and rejects larger overflows', async (t) => {
  const f = await fixture(t);
  const { take, wav, readWav } = await import('../tools/voice/adapter-take.mjs');
  const { adapterInput } = await import('../tools/voice/adapter-input.mjs');
  const backend = await adapterInput(f.directory, f.settings);
  const gainDB = -2.998;
  const pcm = Buffer.alloc(24000 * 2);
  const samples = [32767, -32768];
  for (let i = 0; i < 24000; i++)
    pcm.writeInt16LE(Math.round(samples[i % 2] * 10 ** (gainDB / 20)), i * 2);
  const recovery = {
    wave: readWav(wav([pcm], 24000)),
    gainDB,
    recordingSHA: 'accepted-recording',
    alignment: { method: 'provided' },
    unit: {
      id: 'step',
      audio_start: 0,
      audio_end: 1,
      words: [{ text: 'Один шаг вправо.', start: 0.1, end: 0.9 }],
    },
  };
  const recovered = await take(
    f.directory,
    backend,
    f.settings,
    f.spec.segments[0].text,
    f.cache,
    undefined,
    false,
    true,
    recovery,
  );
  assert.equal(recovered.pcm.readInt16LE(0), 32767);
  assert.equal(recovered.pcm.readInt16LE(2), -32768);
  assert.equal((await f.calls()).length, 0);
  await rm(f.cache, { recursive: true, force: true });
  recovery.wave.pcm.writeInt16LE(24000, 0);
  await assert.rejects(
    take(
      f.directory,
      backend,
      f.settings,
      f.spec.segments[0].text,
      f.cache,
      undefined,
      false,
      true,
      recovery,
    ),
    /cannot be inverted/,
  );
});

test('collected speech cache recovers complete accepted performances without resynthesizing unchanged thoughts', async (t) => {
  const f = await fixture(t, { two: true });
  await f.build();
  const before = await f.receipt();
  const audio = await readFile(join(f.directory, 'audio.wav'));
  await rm(f.cache, { recursive: true, force: true });
  f.spec.segments[0].text = 'Два шага вправо.';
  f.spec.segments[0].cues[0].quote = 'Два шага вправо.';
  await f.save();
  const result = await f.build();
  assert.equal(result.cached, 1);
  assert.equal((await f.calls()).length, 3);
  const after = await f.receipt();
  assert.deepEqual(after.segments[1].words, before.segments[1].words);
  assert.deepEqual(after.alignment.segments[1], before.alignment.segments[1]);
  const gainBefore = 10 ** (before.mix.mastering.gain_db / 20),
    gainAfter = 10 ** (after.mix.mastering.gain_db / 20);
  const { readWav } = await import('../tools/voice/adapter-take.mjs');
  const old = readWav(audio),
    current = readWav(await readFile(join(f.directory, 'audio.wav')));
  const start = Math.round(before.segments[1].audio_start * old.sampleRate),
    end = Math.round(before.segments[1].audio_end * old.sampleRate);
  let error = 0;
  for (let i = start; i < end; i++)
    error = Math.max(
      error,
      Math.abs(
        old.pcm.readInt16LE(i * 2) / gainBefore - current.pcm.readInt16LE(i * 2) / gainAfter,
      ),
    );
  assert(
    error < 2,
    'whole accepted waveform and gain-only mastering must preserve the performance within PCM rounding',
  );
  await checkAdapterNarration(f.directory, f.source, after, f.settings);
});
