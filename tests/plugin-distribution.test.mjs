import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, cp, rm, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import { buildScene } from '../tools/build-pages.mjs';
import { packDirectory } from '../tools/standalone.mjs';
import { releaseInput, macosDeployment } from '../plugin/package.mjs';

test('silent authoring needs no Python and preserves authored cues, assets and credits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-silent-'));
  try {
    const script = {
      version: 1,
      duration: 4,
      segments: [{ id: 'start', text: 'Move', start: 0, end: 4 }],
      cues: { move: { start: 1, end: 3 } },
    };
    await writeFile(
      join(directory, 'timeline.json'),
      JSON.stringify({
        ...script,
        audio: 'audio.wav',
        source_sha256: 'old',
        voice_settings: { reference_audio: '/Users/private/voice.wav' },
      }),
    );
    for (const name of [
      'narration.json',
      'narration.txt',
      'audio.wav',
      'voice.wav',
      'music.wav',
      'voice-preview.html',
      'voice.json',
      'scene.js',
      'logo.svg',
    ])
      await writeFile(join(directory, name), 'source');
    await writeFile(
      join(directory, 'index.html'),
      '<main><audio src="audio.wav"></audio><p>Example</p></main>',
    );
    await writeFile(
      join(directory, 'CREDITS.txt'),
      "Product logo and fonts\n\n=== visual-story:audio ===\nThis audio was created with Boson AI's Higgs Audio — https://www.boson.ai/higgs-audio\n=== /visual-story:audio ===\n",
    );
    await promisify(execFile)(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import {silenceSceneCopy} from ${JSON.stringify(new URL('../tools/narration.mjs', import.meta.url).href)};await silenceSceneCopy(process.argv[1]);await silenceSceneCopy(process.argv[1]);`,
        directory,
      ],
      { env: { ...process.env, PATH: join(directory, 'no-system-tools') } },
    );
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'timeline.json'))), script);
    assert.equal(
      await readFile(join(directory, 'CREDITS.txt'), 'utf8'),
      'Product logo and fonts\n',
    );
    assert.equal(
      await readFile(join(directory, 'index.html'), 'utf8'),
      '<main><p>Example</p></main>',
    );
    assert.deepEqual((await readdir(directory)).sort(), [
      'CREDITS.txt',
      'index.html',
      'logo.svg',
      'scene.js',
      'timeline.json',
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('offline bundles retain dependency licenses without author voice paths or absolute asset IDs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-release-'));
  try {
    const dependency = join(directory, 'node_modules/three');
    await mkdir(join(dependency, 'examples/jsm/libs/draco/gltf'), { recursive: true });
    await writeFile(join(dependency, 'package.json'), '{"name":"three","version":"1.0.0"}');
    await writeFile(join(dependency, 'LICENSE'), 'Dependency license stays with the bundle.');
    await writeFile(join(dependency, 'NOTICE'), 'Dependency attribution stays with the bundle.');
    await writeFile(join(dependency, 'examples/jsm/libs/draco/gltf/decoder.wasm'), 'decoder bytes');
    const timeline = {
      duration: 2,
      cues: { start: { start: 0, end: 2, action: 'show' } },
      segments: [
        {
          id: 'start',
          text: 'Show',
          start: 0,
          end: 2,
          audio_start: 0,
          words: [{ text: 'Show', start: 0, end: 2, score: 1 }],
        },
      ],
      voice_settings: { reference_audio: '/Users/private/narrator.wav' },
      synthesis: { model: 'private-model' },
    };
    await writeFile(join(directory, 'timeline.json'), JSON.stringify(timeline));
    await writeFile(
      join(directory, 'scene.js'),
      "import decoder from 'three/examples/jsm/libs/draco/gltf/decoder.wasm?url';import timeline from './timeline.json';import timelineURL from './timeline.json?url';globalThis.proof={decoder,timeline,timelineURL,relativeTimelineURL:new URL('./timeline.json',import.meta.url).href};",
    );
    await writeFile(
      join(directory, 'index.html'),
      '<!doctype html><html><body><script type="module" src="./scene.js"></script></body></html>',
    );
    const output = join(directory, 'dist');
    await buildScene(directory, output);
    const context = { URL };
    runInNewContext(await readFile(join(output, 'index.js'), 'utf8'), context);
    for (const url of [context.proof.timelineURL, context.proof.relativeTimelineURL]) {
      const embedded = await (await fetch(url)).json();
      assert.equal(embedded.voice_settings, undefined);
      assert.equal(embedded.synthesis, undefined);
      assert.deepEqual(embedded.cues, timeline.cues);
    }
    const html = await packDirectory(output);
    assert.ok(html.includes('Dependency license stays with the bundle.'));
    assert.ok(html.includes('Dependency attribution stays with the bundle.'));
    assert.ok(html.includes('TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION'));
    assert.ok(!html.includes('/Users/private/'));
    assert.ok(!html.includes(`scene-asset-url:${directory}`));
    assert.ok(!html.includes('private-model'));
    const delivered = JSON.parse(await readFile(join(output, 'timeline.json')));
    assert.deepEqual(delivered.cues, timeline.cues);
    assert.deepEqual(delivered.segments[0].words, [{ text: 'Show', start: 0, end: 2 }]);
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, 'timeline.json'))),
      timeline,
      'authored synthesis receipt remains intact',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the release copy excludes development environments, hidden credentials and nested outputs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-profile-'));
  try {
    const source = join(directory, 'source'),
      output = join(directory, 'release');
    for (const path of [
      'tools/.venv/mlx',
      'tools/.credentials',
      'tools/__pycache__/code.pyc',
      'tools/node_modules/private/index.js',
      'tools/artifacts/log.txt',
      'tools/scene.mjs',
      'plugin/dist/server.mjs',
      'dist/index.js',
    ]) {
      await mkdir(join(source, path, '..'), { recursive: true });
      await writeFile(join(source, path), path);
    }
    await cp(source, output, {
      recursive: true,
      filter: (path) => releaseInput(relative(source, path)),
    });
    assert.deepEqual(await readdir(join(output, 'tools')), ['scene.mjs']);
    assert.equal(
      await readFile(join(output, 'plugin/dist/server.mjs'), 'utf8'),
      'plugin/dist/server.mjs',
    );
    assert.equal(await readFile(join(output, 'dist/index.js'), 'utf8'), 'dist/index.js');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  'release platform metadata reads the packaged Node deployment target',
  { skip: process.platform !== 'darwin' },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'story-platform-'));
    try {
      await link(process.execPath, join(directory, 'node'));
      const value = await macosDeployment(directory);
      assert.match(value.minimumMacOS, /^\d+\.\d+/);
      assert.equal(value.binaries[0].path, 'node');
      assert.equal(value.binaries[0].minimumMacOS, value.minimumMacOS);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
