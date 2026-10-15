import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  publishNarration,
  recoverNarration,
  assertNarrationPublished,
} from '../tools/voice/publication.mjs';
import { voiceAdapter } from './support/voice-adapter.mjs';
import { buildNarration, checkNarration } from '../tools/narration.mjs';
import { narrationSource } from '../tools/story-document.mjs';
const moduleURL = pathToFileURL(resolve('tools/voice/publication.mjs')).href;
const narrationURL = pathToFileURL(resolve('tools/narration.mjs')).href;
const document = {
  version: 2,
  models: [],
  views: [],
  chapters: [
    {
      id: 'lesson',
      title: 'Шаг',
      beats: [
        {
          id: 'look',
          say: 'Посмотрим на предметы.',
          speech: { id: 'voice.lesson.look', when: { basis: 'presented', models: [] } },
        },
      ],
    },
  ],
  narration: { intro: 0.2, outro: 0.3, pause: 0.2, music: null },
};
async function fixture(t) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'narration-publication-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return fs.realpath(directory);
}
const child = (source, args = []) =>
  spawnSync(process.execPath, ['--input-type=module', '-e', source, ...args], {
    encoding: 'utf8',
    timeout: 60000,
  });
const fault = `import fs from 'node:fs/promises';import {basename,dirname} from 'node:path';
const original = fs.rename;let installed=0;
fs.rename=async(from,to)=>{if(to.endsWith('/.vstory-voice-publication')&&process.argv[3]==='activation')process.kill(process.pid,'SIGKILL');const result=await original(from,to);if(dirname(to)===process.argv[1]&&['audio.wav','voice.wav','timeline.json','CREDITS.txt'].includes(basename(to))&&++installed===Number(process.argv[3]))process.kill(process.pid,'SIGKILL');return result;};`;

test('SIGKILL after each paired output recovers prepared bytes; readers remain read-only', async (t) => {
  for (const point of ['activation', 1, 2, 3, 4]) {
    const directory = await fixture(t),
      output = join(directory, 'out'),
      staging = join(directory, 'stage');
    await fs.mkdir(output);
    await fs.mkdir(staging);
    const names = ['audio.wav', 'voice.wav', 'CREDITS.txt', 'timeline.json', 'music.wav'];
    for (const name of names) {
      await fs.writeFile(join(output, name), 'old ' + name);
      if (name !== 'music.wav') await fs.writeFile(join(staging, name), 'new ' + name);
    }
    const crashed = child(
      fault +
        `const {publishNarration}=await import(${JSON.stringify(moduleURL)});await publishNarration(process.argv[1],process.argv[2],${JSON.stringify(names)});`,
      [output, staging, String(point)],
    );
    assert.equal(crashed.signal, 'SIGKILL', crashed.stderr);
    await assert.rejects(assertNarrationPublished(output), /interrupted/);
    await fs.rm(staging, { recursive: true }); // Recovery does not depend on caller scratch or take cache.
    assert.equal(await recoverNarration(output), true);
    for (const name of names)
      if (name === 'music.wav')
        await assert.rejects(fs.readFile(join(output, name)), { code: 'ENOENT' });
      else assert.equal(await fs.readFile(join(output, name), 'utf8'), 'new ' + name);
    assert.equal(await recoverNarration(output), false);
  }
});

test('cancellation restores the accepted pair and external mutations block recovery', async (t) => {
  const directory = await fixture(t),
    output = join(directory, 'out'),
    stage = join(directory, 'stage');
  await fs.mkdir(output);
  await fs.mkdir(stage);
  for (const name of ['audio.wav', 'timeline.json']) {
    await fs.writeFile(join(output, name), 'old ' + name);
    await fs.writeFile(join(stage, name), 'new ' + name);
  }
  const controller = new AbortController(),
    rename = fs.rename;
  fs.rename = async (from, to) => {
    const result = await rename(from, to);
    if (to === join(output, 'audio.wav')) controller.abort(Error('cancel voice'));
    return result;
  };
  try {
    await assert.rejects(
      publishNarration(output, stage, ['audio.wav', 'timeline.json'], {
        signal: controller.signal,
      }),
      /cancel voice/,
    );
  } finally {
    fs.rename = rename;
  }
  for (const name of ['audio.wav', 'timeline.json'])
    assert.equal(await fs.readFile(join(output, name), 'utf8'), 'old ' + name);
  await assertNarrationPublished(output);
  const crashed = child(
    fault +
      `const {publishNarration}=await import(${JSON.stringify(moduleURL)});await publishNarration(process.argv[1],process.argv[2],['audio.wav','timeline.json']);`,
    [output, stage, '1'],
  );
  assert.equal(crashed.signal, 'SIGKILL');
  await fs.writeFile(join(output, 'timeline.json'), 'external change');
  await assert.rejects(recoverNarration(output), /outside its publication/);
  assert.equal(await fs.readFile(join(output, 'timeline.json'), 'utf8'), 'external change');
  assert.equal(
    await fs.readFile(join(output, '.vstory-voice-publication/previous/timeline.json'), 'utf8'),
    'old timeline.json',
  );
});

test(
  'real adapter publication crash retries with no provider call even after take cache deletion',
  { timeout: 90000 },
  async (t) => {
    for (const point of ['activation', 1]) {
      const directory = await fixture(t),
        project = join(directory, 'project'),
        cache = join(directory, 'takes');
      await fs.mkdir(project);
      await fs.writeFile(join(project, 'story.json'), JSON.stringify(document));
      await fs.writeFile(
        join(project, 'voice.json'),
        JSON.stringify({
          enabled: true,
          provider: 'local',
          model: 'fixture',
          voice: 'chosen',
          adapter: 'adapter.mjs',
        }),
      );
      await fs.writeFile(join(project, 'adapter.mjs'), voiceAdapter);
      const crashed = child(
        fault +
          `const {buildNarration}=await import(${JSON.stringify(narrationURL)});await buildNarration(process.argv[1],{cache:process.argv[2]});`,
        [project, cache, String(point)],
      );
      assert.equal(crashed.signal, 'SIGKILL', crashed.stderr);
      await assert.rejects(
        checkNarration('<audio src="audio.wav"></audio>', project),
        /interrupted/,
      );
      const calls = await fs.readFile(join(project, '.voice-calls'), 'utf8');
      await fs.rm(cache, { recursive: true, force: true });
      await buildNarration(project, { cache });
      await checkNarration('<audio src="audio.wav"></audio>', project);
      assert.equal(await fs.readFile(join(project, '.voice-calls'), 'utf8'), calls);
      assert.equal((await narrationSource(project)).spec.segments.length, 1);
    }
  },
);

test(
  'explicit plugin retry recovers its frozen voice job before copying; changed authored inputs reject',
  { timeout: 180000 },
  async (t) => {
    const { createScene } = await import('../tools/create-scene.mjs');
    const { workflows } = await import('../plugin/workflows.mjs');
    const { projectFiles } = await import('../tools/project-files.mjs');
    const { randomUUID } = await import('node:crypto');
    const directory = await fixture(t),
      projectPath = join(directory, 'project'),
      data = join(directory, 'data');
    await createScene(projectPath, {
      document: {
        ...document,
        models: [{ id: 'division', module: 'division', inputs: { count: 17, divisor: 4 } }],
        views: [{ id: 'groups', kind: 'groups', model: 'division' }],
      },
      title: 'Проверим шаг',
    });
    await fs.writeFile(
      join(projectPath, 'voice.json'),
      JSON.stringify({
        enabled: true,
        provider: 'api',
        model: 'fixture',
        voice: 'chosen',
        adapter: 'adapter.mjs',
      }),
    );
    await fs.writeFile(join(projectPath, 'adapter.mjs'), voiceAdapter);
    const input = {
      data,
      projectPath,
      projectId: randomUUID(),
      title: 'Проверим шаг',
      prepareVoice: true,
      sourceRevision: (await projectFiles(projectPath)).revision,
    };
    const id = randomUUID(),
      snapshot = join(data, 'snapshots', id);
    const crashed = child(
      `import fs from 'node:fs/promises';import {join}from'node:path';const input=JSON.parse(process.argv[1]),jobId=process.argv[2];const target=join(input.data,'snapshots',jobId,'audio.wav'),rename=fs.rename;fs.rename=async(from,to)=>{const result=await rename(from,to);if(to===target)process.kill(process.pid,'SIGKILL');return result;};const {workflows}=await import(${JSON.stringify(pathToFileURL(resolve('plugin/workflows.mjs')).href)});await workflows.build(input,{jobId,signal:new AbortController().signal,progress(){}});`,
      [JSON.stringify(input), id],
    );
    assert.equal(crashed.signal, 'SIGKILL', crashed.stderr);
    assert(JSON.parse(await fs.readFile(join(snapshot, '.vstory-input.json'))).voicePreparation);
    const calls = await fs.readFile(join(snapshot, '.voice-calls'), 'utf8');
    await fs.rm(join(data, 'speech'), { recursive: true, force: true });
    // The working source is allowed to advance. Retry must still use its own captured source.
    await fs.writeFile(join(projectPath, 'unrelated.txt'), 'new working revision');
    const task = () => ({
      jobId: randomUUID(),
      signal: new AbortController().signal,
      progress() {},
    });
    const result = await workflows.build({ ...input, resumeFrom: id }, task());
    assert.equal(result.sourceRevision, input.sourceRevision);
    await checkNarration('<audio src="audio.wav"></audio>', result.snapshot);
    await assert.rejects(fs.readFile(join(result.snapshot, '.voice-calls')), { code: 'ENOENT' });
    assert.equal(await fs.readFile(join(snapshot, '.voice-calls'), 'utf8'), calls);
    await fs.writeFile(join(snapshot, 'adapter.mjs'), 'throw Error("changed")');
    await assert.rejects(
      workflows.build({ ...input, resumeFrom: id }, task()),
      /authored inputs changed/,
    );
  },
);

test('a later output mutation during publish is preserved and prevents further replacement', async (t) => {
  const directory = await fixture(t),
    output = join(directory, 'out'),
    stage = join(directory, 'stage');
  await fs.mkdir(output);
  await fs.mkdir(stage);
  for (const name of ['audio.wav', 'timeline.json']) {
    await fs.writeFile(join(output, name), 'old ' + name);
    await fs.writeFile(join(stage, name), 'new ' + name);
  }
  const rename = fs.rename;
  let changed = false;
  fs.rename = async (from, to) => {
    const result = await rename(from, to);
    if (!changed && to === join(output, 'audio.wav')) {
      changed = true;
      await fs.writeFile(join(output, 'timeline.json'), 'external edit');
    }
    return result;
  };
  try {
    await assert.rejects(
      publishNarration(output, stage, ['audio.wav', 'timeline.json']),
      /explicit recovery/,
    );
  } finally {
    fs.rename = rename;
  }
  assert.equal(await fs.readFile(join(output, 'timeline.json'), 'utf8'), 'external edit');
  await fs.writeFile(join(output, 'timeline.json'), 'old timeline.json');
  await recoverNarration(output);
  assert.equal(await fs.readFile(join(output, 'audio.wav'), 'utf8'), 'old audio.wav');
});

test('frozen authored input mutation during recovery is rejected after publication completes', async (t) => {
  const { projectFiles } = await import('../tools/project-files.mjs');
  const { recoverVoicePreparation } = await import('../plugin/voice-preparation.mjs');
  const directory = await fixture(t),
    output = join(directory, 'out'),
    stage = join(directory, 'stage');
  await fs.mkdir(output);
  await fs.mkdir(stage);
  await fs.writeFile(join(output, 'scene.js'), 'original source');
  await fs.writeFile(join(output, 'CREDITS.txt'), 'old credit');
  await fs.writeFile(join(stage, 'CREDITS.txt'), 'new credit');
  const receipt = { preparation: { voice: true }, voicePreparation: await projectFiles(output) };
  const crashed = child(
    fault +
      `const {publishNarration}=await import(${JSON.stringify(moduleURL)});await publishNarration(process.argv[1],process.argv[2],['CREDITS.txt']);`,
    [output, stage, 'activation'],
  );
  assert.equal(crashed.signal, 'SIGKILL', crashed.stderr);
  const rename = fs.rename;
  fs.rename = async (from, to) => {
    const result = await rename(from, to);
    if (to === join(output, 'CREDITS.txt'))
      await fs.writeFile(join(output, 'scene.js'), 'changed during recovery');
    return result;
  };
  try {
    await assert.rejects(
      recoverVoicePreparation(output, receipt, { signal: new AbortController().signal }),
      /authored inputs changed/,
    );
  } finally {
    fs.rename = rename;
  }
  assert.equal(await fs.readFile(join(output, 'scene.js'), 'utf8'), 'changed during recovery');
});
