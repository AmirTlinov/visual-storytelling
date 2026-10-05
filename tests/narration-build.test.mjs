import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScene } from '../tools/build-pages.mjs';
import { checkNarration, prepareNarration } from '../tools/narration.mjs';
import { narrationSource } from '../tools/story-document.mjs';

const run = promisify(execFile);
test('silent creation preserves narrative timing and authored assets without Python', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'story-silent-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const write = (name, value) =>
    writeFile(join(directory, name), typeof value === 'string' ? value : JSON.stringify(value));
  const script = {
    version: 1,
    duration: 4,
    segments: [{ id: 'start', text: 'Move', start: 0, end: 4 }],
    cues: {
      move: { start: 1, end: 3, action: 'Move one unit', timing: { duration: 2 } },
    },
    captionAliases: { move: 'start' },
  };
  await write('timeline.json', {
    ...script,
    audio: 'audio.wav',
    source_sha256: 'old',
    mix: { music: 'old' },
    segments: [{ ...script.segments[0], audio_start: 0, audio_end: 4, seed: 42, delivery: {} }],
  });
  await write('story.json', { title: 'Story', narration: { enabled: true, voice: { seed: 42 } } });
  await write('voice.json', { provider: 'macos', enabled: true, language: 'ru-RU' });
  const authored = 'Product logo and fonts\nLegacy narrator attribution\n';
  await write(
    'CREDITS.txt',
    authored +
      '\n=== visual-story:audio ===\nGenerated narration and music\n=== /visual-story:audio ===\n',
  );
  for (const name of [
    'narration.json',
    'narration.txt',
    'voice-preview.html',
    'audio.wav',
    'voice.wav',
    'music.wav',
    'scene.js',
    'logo.svg',
  ])
    await write(name, 'source');
  const html =
    '<main><!-- <audio src="example.wav"> --><audio src="audio.wav"></audio><p>Story</p></main>';
  await write('index.html', html);
  const silence = () =>
    run(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { silenceSceneCopy } from ${JSON.stringify(new URL('../tools/narration.mjs', import.meta.url).href)}; await silenceSceneCopy(process.argv[1]);`,
        directory,
      ],
      { env: { ...process.env, PATH: join(directory, 'no-programs') } },
    );
  await silence();
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'timeline.json'), 'utf8')), script);
  assert.equal(await readFile(join(directory, 'CREDITS.txt'), 'utf8'), authored);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'story.json'), 'utf8')).narration, {
    enabled: false,
    voice: { seed: 42 },
  });
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'voice.json'), 'utf8')), {
    provider: 'macos',
    enabled: false,
    language: 'ru-RU',
  });
  assert.equal(
    await readFile(join(directory, 'index.html'), 'utf8'),
    html.replace('<audio src="audio.wav"></audio>', ''),
  );
  assert.deepEqual((await readdir(directory)).sort(), [
    'CREDITS.txt',
    'index.html',
    'logo.svg',
    'scene.js',
    'story.json',
    'timeline.json',
    'voice.json',
  ]);
  await silence();
  assert.equal(await readFile(join(directory, 'CREDITS.txt'), 'utf8'), authored);
  assert.equal(await readFile(join(directory, 'scene.js'), 'utf8'), 'source');
});

test('scene builds reject stale generated narration while silent and independent scenes still build', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-narration-'));
  const source = join(directory, 'source'),
    output = join(directory, 'dist');
  const audioTools = fileURLToPath(new URL('../tools/audio', import.meta.url));
  const html = '<html><head></head><body><audio data-audio src="audio.wav"></audio></body></html>';
  // Python's canonical source hash retains float syntax (1.0 and exponent notation).
  const narration =
    '{"version":3,"intro":1.0,"outro":1e-7,"segments":[{"id":"line","text":"Два входа."}]}';
  const put = (name, value) => writeFile(join(source, name), value);
  const pcm = Buffer.alloc(44 + 2 * 48000 * 2);
  pcm.write('RIFF');
  pcm.writeUInt32LE(pcm.length - 8, 4);
  pcm.write('WAVEfmt ', 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(48000, 24);
  pcm.writeUInt32LE(96000, 28);
  pcm.writeUInt16LE(2, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write('data', 36);
  pcm.writeUInt32LE(pcm.length - 44, 40);
  try {
    await mkdir(source);
    await put('index.html', html);
    await put('narration.json', narration);
    await put('audio.wav', pcm);
    const { stdout } = await run(
      'python3',
      [
        '-c',
        'import json,sys;sys.path.insert(0,sys.argv[1]);from resources import digest,file_digest,REFERENCE_AUDIO;print(json.dumps({"source":digest(json.loads(sys.argv[2])),"reference":file_digest(REFERENCE_AUDIO)}))',
        audioTools,
        narration,
      ],
      { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } },
    );
    const aligned = {
      audio: 'audio.wav',
      source_sha256: JSON.parse(stdout).source,
      synthesis: { reference_sha256: JSON.parse(stdout).reference },
      sample_rate: 48000,
      duration: 2,
      segments: [
        {
          id: 'line',
          text: 'Два входа.',
          start: 1,
          end: 1.5,
          words: [
            { text: 'Два', start: 1, end: 1.2, score: 0.9 },
            { text: 'входа', start: 1.2, end: 1.5, score: 0.9 },
          ],
        },
      ],
      cues: { line: { text: 'Два входа.', start: 1, end: 1.5 } },
      build: { seconds: 12.4, segments: [] },
    };
    const receipt = JSON.stringify(aligned);
    await put('timeline.json', receipt);
    await buildScene(source, output);
    const before = await readFile(join(output, 'index.html'), 'utf8');
    await prepareNarration(source, { audible: true });
    assert.equal(await readFile(join(source, 'timeline.json'), 'utf8'), receipt);
    for (const invalid of [
      { ...aligned, segments: [] },
      { ...aligned, segments: [{ ...aligned.segments[0], words: [{ text: 'Два' }] }] },
      {
        ...aligned,
        segments: [
          {
            ...aligned.segments[0],
            words: aligned.segments[0].words.map((w) => ({ ...w, score: 0.01 })),
          },
        ],
      },
    ]) {
      await put('timeline.json', JSON.stringify(invalid));
      await assert.rejects(
        checkNarration(html, source),
        /incomplete aligned|invalid alignment scores|confidence/,
      );
    }
    await put('timeline.json', receipt);
    await rm(join(source, 'audio.wav'));
    await assert.rejects(checkNarration(html, source), /audio is missing or invalid/);
    await put('audio.wav', pcm.subarray(0, 48));
    await assert.rejects(checkNarration(html, source), /audio does not match/);
    await put('audio.wav', pcm);

    await mkdir(join(source, 'audio'));
    await put('audio/audio.wav', pcm);
    await put('audio/timeline.json', receipt);
    await put(
      'timeline.json',
      JSON.stringify({ audio: 'audio.wav', source_sha256: 'old-template' }),
    );
    await put('index.html', html.replace('src="audio.wav"', 'data-src="audio/audio.wav"'));
    await buildScene(source, output); // The unused template at root cannot reject current nested audio.
    await rm(join(source, 'audio/timeline.json'));
    await put('timeline.json', JSON.stringify({ ...aligned, audio: 'audio/audio.wav' }));
    await buildScene(source, output); // A root receipt may describe a nested WAV.
    await put('timeline.json', receipt);
    await assert.rejects(buildScene(source, output), /no matching timeline/);
    await put(
      'audio/timeline.json',
      JSON.stringify({ audio: 'audio.wav', source_sha256: 'stale-nested' }),
    );
    await put('timeline.json', receipt);
    await assert.rejects(buildScene(source, output), /audio\/timeline.json.*Narration changed/);
    await put('index.html', html);
    await buildScene(source, output);

    await put('narration.json', narration.replace('Два входа.', 'Три входа.'));
    await put('index.html', html.replace('</body>', '<p>New content</p></body>'));
    await assert.rejects(buildScene(source, output), /Narration changed.*visual-story audio/);
    assert.equal(await readFile(join(output, 'index.html'), 'utf8'), before);

    for (const silent of [
      html.replace('<audio ', '<audio data-silent=true '),
      '<html><body><!-- <audio src="audio.wav"> --><p>Silent</p></body></html>',
    ]) {
      await put('index.html', silent);
      await buildScene(source, output);
      assert.equal(await readFile(join(output, 'index.html'), 'utf8'), silent);
    }

    await put('index.html', html);
    await rm(join(source, 'narration.json'));
    await buildScene(source, output); // External audio with no authored narration.
    await put('narration.json', narration);
    await put('timeline.json', '{"duration":1,"cues":{}}');
    await assert.rejects(buildScene(source, output), /no matching timeline/);
    await rm(join(source, 'timeline.json'));
    await assert.rejects(buildScene(source, output), /no matching timeline/);

    await put('timeline.json', receipt);
    await assert.rejects(
      run(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import {buildScene} from ${JSON.stringify(new URL('../tools/build-pages.mjs', import.meta.url).href)};await buildScene(process.argv[1],process.argv[2]);`,
          source,
          output,
        ],
        { env: { ...process.env, PATH: join(directory, 'no-python') } },
      ),
      /requires python3 \(standard library only\)/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('copied story speech retains its receipt and notices changed voice or music bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'story-speech-inputs-'));
  const source = join(root, 'author'),
    copy = join(root, 'recipient');
  const html = '<audio src="audio.wav"></audio>';
  const audioTools = fileURLToPath(new URL('../tools/audio', import.meta.url));
  try {
    await mkdir(source);
    await writeFile(join(source, 'index.html'), html);
    await writeFile(join(source, 'reference.wav'), 'selected voice');
    await writeFile(join(source, 'bed.wav'), 'selected music');
    await writeFile(
      join(source, 'story.json'),
      JSON.stringify({
        title: 'Цепь',
        narration: {
          voice: { reference_audio: 'reference.wav', reference_text: 'Два входа.' },
          music: {
            path: 'bed.wav',
            credit: { title: 'Bed', artist: 'Author', source: 'Local', license: '0BSD' },
          },
        },
        chapters: [
          {
            id: 'circuit',
            title: 'Цепь',
            beats: [{ id: 'close', say: 'Два входа.', text: 'Замкнуто.' }],
          },
        ],
      }),
    );
    const projection = await narrationSource(source);
    const text = await readFile(projection.file, 'utf8');
    await run(
      'python3',
      [
        '-c',
        `
import json,sys,wave
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from script import read_script,timed_cues,dependency_digests
from resources import digest
path,root=Path(sys.argv[2]),Path(sys.argv[3])
spec=read_script(path,source_directory=root)
segment=spec['segments'][0]
words=[{'text':'Два','start':1,'end':1.2,'score':.9},{'text':'входа','start':1.2,'end':1.5,'score':.9}]
inputs=dependency_digests(spec)
with wave.open(str(root/'audio.wav'),'wb') as wav:
 wav.setparams((1,2,48000,96000,'NONE','none'));wav.writeframes(bytes(192000))
(root/'timeline.json').write_text(json.dumps({'audio':'audio.wav','source_sha256':digest(json.loads(path.read_text())),
 'sample_rate':48000,'duration':2,'synthesis':{'reference_sha256':inputs['reference_audio']},'mix':{'music':{'source_sha256':inputs['music']}},
 'segments':[{'id':segment['id'],'title':segment.get('title'),'text':segment['spoken'],'start':1,'end':1.5,'words':words}],
 'cues':timed_cues(segment,words)}))
`,
        audioTools,
        projection.file,
        source,
      ],
      { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } },
    );
    const receipt = await readFile(join(source, 'timeline.json'), 'utf8');
    await cp(source, copy, { recursive: true });
    await rm(source, { recursive: true });
    assert.equal(await readFile((await narrationSource(copy)).file, 'utf8'), text);
    await prepareNarration(copy, { audible: true });
    assert.equal(await readFile(join(copy, 'timeline.json'), 'utf8'), receipt);
    await writeFile(join(copy, 'reference.wav'), 'changed voice');
    await assert.rejects(checkNarration(html, copy), /Voice reference changed/);
    await writeFile(join(copy, 'reference.wav'), 'selected voice');
    await writeFile(join(copy, 'bed.wav'), 'changed music');
    await assert.rejects(checkNarration(html, copy), /Music changed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
