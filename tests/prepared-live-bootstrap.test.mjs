import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

test('the classic prepared boot waits for parser-owned narration before mounting', async () => {
  const source = await readFile(new URL('../plugin/ui/live-scene.mjs', import.meta.url), 'utf8');
  const result = await build({
    stdin: { contents: source, loader: 'js' },
    bundle: true,
    format: 'iife',
    write: false,
    plugins: [
      {
        name: 'observe-mount',
        setup(builder) {
          builder.onResolve({ filter: /^@visual-storytelling\/core/ }, ({ path }) => ({
            path,
            namespace: 'fixture',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents: path.endsWith('.css')
              ? ''
              : 'export const IllustratedStory = {mount: (...args) => globalThis.recordMount(...args)};',
            loader: 'js',
          }));
        },
      },
    ],
  });
  for (const readyState of ['loading', 'complete']) {
    let ready, audio;
    const calls = [];
    const context = {
      window: { __visualStoryDocument: { version: 2 } },
      document: {
        readyState,
        addEventListener(type, listener, options) {
          assert.equal(type, 'DOMContentLoaded');
          assert.deepEqual(options.once, true);
          ready = listener;
        },
        querySelector(selector) {
          return selector === 'main' ? 'scene-root' : audio;
        },
      },
      recordMount(...args) {
        calls.push(args);
      },
    };
    if (readyState === 'complete') audio = { recording: 'accepted' };
    runInNewContext(result.outputFiles[0].text, context);
    if (readyState === 'loading') {
      await Promise.resolve();
      assert.equal(calls.length, 0, 'the body parser has not reached the audio yet');
      audio = { recording: 'accepted' };
      ready();
    }
    await context.window.galleryReady;
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1].audio, audio);
  }
});
