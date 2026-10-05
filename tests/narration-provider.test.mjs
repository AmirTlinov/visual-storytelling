import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, cp, symlink, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkNarration } from '../tools/narration.mjs';

test(
  'public CLI chooses and persists native speech without silently replacing an explicit provider',
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
    const audio = () =>
      promisify(execFile)(process.execPath, [join(packaged, 'tools/scene.mjs'), 'audio', scene], {
        env: { ...process.env, VISUAL_STORY_DATA_DIR: join(directory, 'cache') },
        timeout: 30000,
      });
    await audio();
    const settings = JSON.parse(await readFile(join(scene, 'voice.json'), 'utf8'));
    assert.equal(settings.provider, 'macos');
    assert.equal(settings.enabled, true);
    assert.ok(settings.voice);
    assert.equal(settings.language, 'ru-RU');
    const timeline = JSON.parse(await readFile(join(scene, 'timeline.json'), 'utf8'));
    assert.deepEqual(timeline.voice_settings, settings);
    const waveform = await readFile(join(scene, 'audio.wav'));
    assert.equal(waveform.toString('ascii', 0, 4), 'RIFF');
    await checkNarration(await readFile(join(scene, 'index.html'), 'utf8'), scene);
    await audio();
    assert.deepEqual(JSON.parse(await readFile(join(scene, 'voice.json'), 'utf8')), settings);
    assert.deepEqual(await readFile(join(scene, 'audio.wav')), waveform);
    await writeFile(join(scene, 'voice.json'), JSON.stringify({ ...settings, provider: 'higgs' }));
    await assert.rejects(audio(), (error) => /does not include Higgs/.test(error.stderr));
    assert.equal(JSON.parse(await readFile(join(scene, 'voice.json'), 'utf8')).provider, 'higgs');
    assert.deepEqual(await readFile(join(scene, 'audio.wav')), waveform);
    await writeFile(
      join(scene, 'voice.json'),
      JSON.stringify({ ...settings, voice: 'missing-voice' }),
    );
    await assert.rejects(audio(), (error) => /Выбранный голос отсутствует/.test(error.stderr));
    assert.deepEqual(await readFile(join(scene, 'audio.wav')), waveform);
  },
);
