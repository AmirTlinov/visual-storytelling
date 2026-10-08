import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, cp, symlink, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkNarration } from '../tools/narration.mjs';

test(
  'packaged CLI defaults to external Higgs, checks with that installation, and never falls back to system speech',
  { skip: process.platform !== 'darwin', timeout: 60000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'story-provider-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const library = fileURLToPath(new URL('../', import.meta.url)),
      packaged = join(directory, 'package'),
      scene = join(directory, 'scene');
    await mkdir(scene);
    await cp(join(library, 'tools'), join(packaged, 'tools'), {
      recursive: true,
      filter: (file) => {
        const name = relative(join(library, 'tools'), file);
        return (
          name !== 'audio' &&
          name !== 'sketch-audio' &&
          !name.split('/').some((part) => part.startsWith('.') || part === 'node_modules')
        );
      },
    });
    await cp(join(library, 'dist'), join(packaged, 'dist'), { recursive: true });
    await symlink(join(library, 'node_modules'), join(packaged, 'node_modules'), 'dir');
    const pkg = JSON.parse(await readFile(join(library, 'package.json'), 'utf8'));
    delete pkg.bin['sketch-audio'];
    await writeFile(join(packaged, 'package.json'), JSON.stringify(pkg));
    await writeFile(
      join(scene, 'narration.json'),
      JSON.stringify({
        music: null,
        segments: [
          {
            id: 'start',
            text: 'Один шаг вправо.',
            cues: [{ id: 'step', quote: 'шаг вправо', action: 'Стрелка показывает шаг.' }],
          },
        ],
      }),
    );
    await writeFile(
      join(scene, 'index.html'),
      '<audio src="audio.wav" data-silent="true"></audio>',
    );
    const backend = join(directory, 'sketch-audio');
    const calls = join(directory, 'calls.jsonl');
    // This protocol double verifies routing. Real synthesis is exercised in the release smoke pass.
    await writeFile(
      backend,
      `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n');
if (args[0] === 'doctor') console.log(JSON.stringify({speech_ready:true,reference_ready:true,aligner:true,ffmpeg:'/ffmpeg'}));
else if (args[0] === 'build') {
  if (process.env.FAIL_HIGGS) process.exit(1);
  const out = args[args.indexOf('--out') + 1];
  fs.writeFileSync(path.join(out,'audio.wav'), 'external-higgs-audio');
  fs.writeFileSync(path.join(out,'timeline.json'), JSON.stringify({audio:'audio.wav',source_sha256:'higgs-receipt',synthesis:{provider:'higgs'}}));
} else if (args[0] !== 'check') process.exit(2);
`,
      { mode: 0o755 },
    );
    const audio = (env = {}) =>
      promisify(execFile)(process.execPath, [join(packaged, 'tools/scene.mjs'), 'audio', scene], {
        env: {
          ...process.env,
          VISUAL_STORY_DATA_DIR: join(directory, 'cache'),
          SKETCH_AUDIO_BIN: backend,
          ...env,
        },
        timeout: 30000,
      });
    await assert.rejects(audio({ SKETCH_AUDIO_BIN: join(directory, 'missing-higgs') }), (error) =>
      /Higgs недоступна/.test(error.stderr),
    );
    await assert.rejects(readFile(join(scene, 'voice.json')), { code: 'ENOENT' });
    await assert.rejects(readFile(join(scene, 'audio.wav')), { code: 'ENOENT' });
    await audio();
    const settings = JSON.parse(await readFile(join(scene, 'voice.json'), 'utf8'));
    assert.equal(settings.provider, 'higgs');
    assert.equal(settings.enabled, true);
    const waveform = await readFile(join(scene, 'audio.wav'));
    assert.equal(waveform.toString(), 'external-higgs-audio');
    await promisify(execFile)(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import {readFile} from 'node:fs/promises';
      import {checkNarration} from ${JSON.stringify(pathToFileURL(join(packaged, 'tools/narration.mjs')).href)};
      await checkNarration(await readFile(process.argv[1]+'/index.html','utf8'),process.argv[1]);
    `,
        scene,
      ],
      { env: { ...process.env, SKETCH_AUDIO_BIN: backend } },
    );
    const commands = (await readFile(calls, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(
      commands.map((args) => args[0]),
      ['doctor', 'build', 'check'],
    );
    assert.equal(commands[2][1], join(scene, 'narration.json'));
    assert.equal(commands[2].at(-1), join(scene, 'timeline.json'));
    await audio();
    assert.deepEqual(JSON.parse(await readFile(join(scene, 'voice.json'), 'utf8')), settings);
    assert.deepEqual(await readFile(join(scene, 'audio.wav')), waveform);
    for (const env of [{ SKETCH_AUDIO_BIN: join(directory, 'missing-higgs') }, { FAIL_HIGGS: '1' }])
      await assert.rejects(audio(env), (error) => /Higgs/.test(error.stderr));
    assert.equal(JSON.parse(await readFile(join(scene, 'voice.json'), 'utf8')).provider, 'higgs');
    assert.deepEqual(await readFile(join(scene, 'audio.wav')), waveform);
    await writeFile(
      join(scene, 'voice.json'),
      JSON.stringify({ provider: 'macos', language: 'ru-RU', enabled: true }),
    );
    await assert.rejects(
      checkNarration(await readFile(join(scene, 'index.html'), 'utf8'), scene),
      /provider changed/,
    );
    await audio({ SKETCH_AUDIO_BIN: join(directory, 'missing-higgs') });
    const system = JSON.parse(await readFile(join(scene, 'voice.json'), 'utf8'));
    assert.equal(system.provider, 'macos');
    assert.ok(system.voice);
    const systemWaveform = await readFile(join(scene, 'audio.wav'));
    assert.equal(systemWaveform.toString('ascii', 0, 4), 'RIFF');
    await checkNarration(await readFile(join(scene, 'index.html'), 'utf8'), scene);
    await writeFile(
      join(scene, 'voice.json'),
      JSON.stringify({ ...system, voice: 'missing-voice' }),
    );
    await assert.rejects(audio(), (error) => /Выбранный голос отсутствует/.test(error.stderr));
    assert.deepEqual(await readFile(join(scene, 'audio.wav')), systemWaveform);
  },
);
