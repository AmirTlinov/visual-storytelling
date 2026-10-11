import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { JobRunner } from '../plugin/jobs.mjs';
import {
  adapterVoiceStatus,
  buildAdapterNarration,
  checkAdapterNarration,
  validateAdapterSettings,
} from '../tools/voice/adapter.mjs';
import { voiceDigest } from '../tools/voice/receipt.mjs';

// Protocol/ownership fixture: tone intervals have measured phrase timestamps.
// It is deliberately not a TTS model or a listening-quality acceptance test.
const adapter = `import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
let input = ''; for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input), mode = request.model;
await appendFile(join(process.cwd(), '.voice-calls'), JSON.stringify({provider:request.provider,text:request.text,model:mode,voice:request.voice})+'\\n');
if (mode === 'secret') { console.error('SECRET-api-token'); console.log('SECRET-api-token'); process.exit(17); }
if (mode === 'bad-json') { console.log('SECRET-api-token'); process.exit(0); }
if (mode === 'overflow') { console.log('SECRET-api-token'.repeat(80000)); process.exit(0); }
if (['child', 'exit-child', 'exit-success-child'].includes(mode)) {
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},100)"], {stdio:'inherit'});
  await writeFile(join(process.cwd(), '.voice-child'), String(child.pid));
  if (mode === 'exit-child') process.exit(1);
  if (mode === 'exit-success-child') process.exit(0);
  await new Promise(resolve=>setTimeout(resolve,30000));
}
if (mode === 'wait') {
  await writeFile(join(process.cwd(), '.voice-started'), 'yes');
  await new Promise(resolve=>setTimeout(resolve,400));
}
if (mode === 'changed-adapter') await appendFile(new URL(import.meta.url), '\\n// changed during synthesis\\n');
const rate=8000, frames=16000, pcm=Buffer.alloc(frames*2), header=Buffer.alloc(44);
for(let i=800;i<15200;i++) pcm.writeInt16LE(Math.round(Math.sin(i/9)*2000),i*2);
header.write('RIFF');header.writeUInt32LE(pcm.length+36,4);header.write('WAVEfmt ',8);
header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(mode==='stereo'?2:1,22);
header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*2,28);header.writeUInt16LE(2,32);
header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);
let audio=Buffer.concat([header,pcm]); if(mode==='truncated') audio=audio.subarray(0,-1);
await writeFile(join(request.outputDirectory,'take.wav'),audio);
let words=[{text:request.text,start:.1,end:1.9}];
if(mode==='missing') words=[{text:'Один',start:.1,end:1.9}];
if(mode==='overlap') words=[{text:'Один',start:.1,end:1.3},{text:'шаг вправо.',start:1.2,end:1.9}];
if(mode==='outside') words=[{text:request.text,start:.1,end:2.1}];
if(mode==='nonfinite') words=[{text:request.text,start:NaN,end:1.9}];
console.log(JSON.stringify({words,alignment:{method:'fixture-phrase-tones'}}));
`;

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
          { id: 'move', quote: 'шаг вправо', action: 'Сдвинуть точку.', timing: { duration: 1.1 } },
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
        assert.equal(runner.get(job.id).status, mode === 'exit-child' ? 'failed' : 'cancelled');
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
