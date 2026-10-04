import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScene } from '../tools/build-pages.mjs';

const run = promisify(execFile);
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
  try {
    await mkdir(source);
    await put('index.html', html);
    await put('narration.json', narration);
    await put('audio.wav', 'existing generated audio');
    const { stdout } = await run(
      'python3',
      [
        '-c',
        'import json,sys;sys.path.insert(0,sys.argv[1]);from resources import digest;print(digest(json.loads(sys.argv[2])))',
        audioTools,
        narration,
      ],
      { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } },
    );
    const receipt = JSON.stringify({ audio: 'audio.wav', source_sha256: stdout.trim() });
    await put('timeline.json', receipt);
    await buildScene(source, output);
    const before = await readFile(join(output, 'index.html'), 'utf8');

    await mkdir(join(source, 'audio'));
    await put('audio/audio.wav', 'nested generated audio');
    await put('audio/timeline.json', receipt);
    await put(
      'timeline.json',
      JSON.stringify({ audio: 'audio.wav', source_sha256: 'old-template' }),
    );
    await put('index.html', html.replace('src="audio.wav"', 'data-src="audio/audio.wav"'));
    await buildScene(source, output); // The unused template at root cannot reject current nested audio.
    await rm(join(source, 'audio/timeline.json'));
    await put(
      'timeline.json',
      JSON.stringify({ audio: 'audio/audio.wav', source_sha256: stdout.trim() }),
    );
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
