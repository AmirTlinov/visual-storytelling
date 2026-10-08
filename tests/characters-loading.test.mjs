import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { renderer } from '../tools/render.mjs';
import { assetURLs } from '../tools/asset-urls.mjs';

test(
  'a cancelled character chapter stops rig requests and SVG preparation, then mounts cleanly',
  { timeout: 15000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'character-loading-'));
    let capture, pendingRoute;
    try {
      const bundle = await build({
      plugins: [assetURLs()],
        stdin: {
          resolveDir: fileURLToPath(new URL('../', import.meta.url)),
          contents: `
          import { characterChapter } from './dist/characters/chapter.js';
          import { chibi } from './dist/characters/packs/chibi.js';
          import { readingRoom } from './dist/characters/staging/sets.js';
          const parent = document.querySelector('#scene');
          const options = {id:'reading',pack:chibi,set:readingRoom(),
            cast:{hero:{skin:'tesla',at:'entry'}},
            beats:[{id:'start',text:'Ready',seconds:1}]};
          let controller, pending;
          const outcome = promise => promise.then(
            stage => {stage.dispose();return 'mounted';}, error => error.name);
          window.lab = {
            beginRig() {
              controller = new AbortController();
              const gltf = JSON.parse(chibi.gltf);
              gltf.buffers[0].uri = new URL('/delayed-rig.bin', location.href).href;
              pending = outcome(characterChapter({...options,pack:{...chibi,gltf:JSON.stringify(gltf)}}).mount(parent,controller.signal));
            },
            async abortRig() {controller.abort();return {result:await pending,children:parent.childElementCount};},
            async cancelArtwork() {
              controller = new AbortController();
              const decode = HTMLImageElement.prototype.decode;
              let reached = false;
              HTMLImageElement.prototype.decode = function() {
                const result = decode.call(this);
                if (this.src.startsWith('data:image/svg+xml')) {
                  reached = true;
                  queueMicrotask(() => controller.abort());
                }
                return result;
              };
              try {
                const result = await outcome(characterChapter(options).mount(parent,controller.signal));
                return {result,reached,children:parent.childElementCount};
              } finally {HTMLImageElement.prototype.decode = decode;}
            },
            async retry() {
              const stage = await characterChapter(options).mount(parent,new AbortController().signal);
              stage.render({time:0,reduced:false,values:{},mode:'story'});
              const mounted = parent.childElementCount;
              stage.dispose();
              return {mounted,children:parent.childElementCount};
            }
          };`,
        },
        bundle: true,
        format: 'iife',
        write: false,
      });
      await writeFile(
        join(directory, 'index.html'),
      '<!doctype html><body><div class="ve-scene" id="scene"></div><script src="index.js"></script>',
      );
      await writeFile(join(directory, 'index.js'), bundle.outputFiles[0].text);
      capture = await renderer({ directory, width: 960, controls: true });
      let requested;
      const request = new Promise((resolve) => {
        requested = resolve;
      });
      await capture.page.route('**/delayed-rig.bin', (route) => {
        pendingRoute = route;
        requested();
      });
      await capture.page.evaluate(() => window.lab.beginRig());
      await request;
      assert.deepEqual(await capture.page.evaluate(() => window.lab.abortRig()), {
        result: 'AbortError',
        children: 0,
      });
      await pendingRoute.abort().catch(() => {});
      pendingRoute = undefined;
      assert.deepEqual(await capture.page.evaluate(() => window.lab.cancelArtwork()), {
        result: 'AbortError',
        reached: true,
        children: 0,
      });
      assert.deepEqual(await capture.page.evaluate(() => window.lab.retry()), {
        mounted: 1,
        children: 0,
      });
    } finally {
      await pendingRoute?.abort().catch(() => {});
      await capture?.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
