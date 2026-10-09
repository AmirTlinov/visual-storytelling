import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { runExport } from '../tools/export.mjs';
import { deliver } from '../tools/deliver.mjs';
import { reviewMotion } from '../tools/motion/review.mjs';
import { orderedInsights } from '../tools/motion/focus.mjs';
import { contentDigest } from '../tools/build-info.mjs';

test('a silent prepared HTML keeps its media clock without exporting recordings or changing the selected build', async () => {
  const root = await mkdtemp(join(tmpdir(), 'story-quiet-delivery-'));
  const source = join(root, 'scene'),
    built = join(source, 'dist');
  const html =
    '<!doctype html><html><body><main class="ve-scene">Selected frame</main><audio data-story-audio src="data:audio/wav;base64,UklGRg==" data-story-timeline="timeline.json"><source src="unused.wav"></audio></body></html>';
  try {
    await mkdir(built, { recursive: true });
    await writeFile(join(source, 'index.html'), html);
    await writeFile(join(built, 'index.html'), html);
    const prepared = {
      directory: built,
      html,
      revision: 'shown',
      sourceRevision: 'authored',
      outputDigest: await contentDigest(built, ['.']),
    };
    const output = await deliver(source, {
      out: join(root, 'quiet'),
      formats: ['html'],
      silent: true,
      prepared,
    });
    const quiet = await readFile(join(output.directory, 'story.html'), 'utf8');
    assert.match(quiet, /<audio[^>]*data-story-audio[^>]*data-silent="true"/);
    assert.doesNotMatch(quiet, /data:audio|unused\.wav|<source|data-story-timeline/);
    assert.equal(await readFile(join(built, 'index.html'), 'utf8'), html);
    assert.equal(output.buildRevision, 'shown');
    const audible = await deliver(source, {
      out: join(root, 'audible'),
      formats: ['html'],
      prepared,
    });
    assert.equal(await readFile(join(audible.directory, 'story.html'), 'utf8'), html);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the mounted story supplies aliased captions and presentation evidence to export, delivery and model review', async () => {
  const root = await mkdtemp(join(tmpdir(), 'story-delivery-'));
  const source = join(root, 'scene'),
    review = join(root, 'review');
  try {
    await mkdir(source);
    const script = {
      duration: 2,
      cues: { speech: { start: 0, end: 2 } },
      segments: [{ id: 'speech', start: 0, end: 2, text: 'Открой пэ дэ эф.' }],
      captionAliases: { 'пэ дэ эф': 'PDF' },
    };
    const compiled = await build({
      stdin: {
        contents: `
        import { cueSheet } from './src/story/cues.ts';
        import { mountScene } from './src/scene-handle.ts';
        const sheet = cueSheet(${JSON.stringify(script)});
        let time = 0;
        mountScene(document.querySelector('main'), {
          dispose() {},
          duration: 2, pause() {}, review: () => sheet.review(),
          seek(value) { time = value; sheet.at(time).progress('speech'); },
          presentation() { return {
            outsideViewport: false,
            clipped: time >= 1 ? [{ id: 'drawing', bounds: { x: 0, y: 0, width: 50, height: 40 }, clip: { x: 0, y: 0, width: 40, height: 40 } }] : [],
            unreadableText: time >= 1 ? [{ id: 'label', pixels: 9, minimum: 14 }] : [],
            uninspectedCanvases: time >= 1 ? 1 : 0,
          }; },
        });`,
        resolveDir: fileURLToPath(new URL('../', import.meta.url)),
      },
      bundle: true,
      write: false,
      format: 'iife',
    });
    await writeFile(join(source, 'index.js'), compiled.outputFiles[0].text);
    await writeFile(
      join(source, 'index.html'),
      '<!doctype html><main class="ve-scene" style="width:80px;height:60px"><svg width="80" height="60"><rect width="20" height="20" fill="red"/></svg></main><script src="./index.js"></script>',
    );
    // An old sidecar must not override the currently mounted scene's authored text.
    await writeFile(
      join(source, 'timeline.json'),
      JSON.stringify({
        ...script,
        segments: [{ id: 'speech', start: 0, end: 2, text: 'Stale timeline' }],
      }),
    );
    const srt = join(root, 'export.srt');
    await runExport(['--directory', source, '--format', 'srt', '--out', srt]);
    assert.match(await readFile(srt, 'utf8'), /Открой PDF\./);
    const release = join(root, 'release');
    await deliver(source, { out: release, formats: ['srt', 'vtt'], silent: true });
    assert.match(await readFile(join(release, 'story.vtt'), 'utf8'), /Открой PDF\./);
    const result = await reviewMotion({
      input: source,
      out: review,
      frames: 3,
      from: 0,
      seconds: 2,
      width: 400,
      maxSize: 80,
    });
    const report = JSON.parse(await readFile(result.data, 'utf8'));
    assert.equal(report.sampling, 'model-checkpoints');
    assert.equal(
      report.runtime,
      undefined,
      'checkpoint geometry is not a playback performance trace',
    );
    const geometry = orderedInsights(report).filter((item) =>
      ['content-clipped', 'unreadable-text', 'uninspected-canvas'].includes(item.kind),
    );
    assert.deepEqual(
      geometry.map(({ kind, target, time }) => ({ kind, target, time })),
      [
        { kind: 'content-clipped', target: 'drawing', time: 1 },
        { kind: 'unreadable-text', target: 'label', time: 1 },
        { kind: 'uninspected-canvas', target: 'scene:canvas', time: 1 },
      ],
    );
    assert.equal(geometry[1].pixels, 9);
    assert.match(await readFile(result.path, 'utf8'), /unreadable-text/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
