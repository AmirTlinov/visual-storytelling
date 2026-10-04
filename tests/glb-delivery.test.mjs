import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { buildScene } from '../tools/build-pages.mjs';
import { packDirectory } from '../tools/standalone.mjs';

test('shared 3D viewport decodes a compressed GLB in offline HTML without author preprocessing or external decoder URLs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'draco-delivery-'));
  let browser;
  try {
    // Eight-vertex unit cube encoded with Draco; contains no third-party model artwork.
    await cp(resolve('tests/fixtures/draco-cube.glb'), join(directory, 'cube.glb'));
    const scene = `
      import { Viewport3D } from '@visual-storytelling/core/three';
      import cube from './cube.glb';
      const view=Viewport3D.mount(document.getElementById('stage'));
      window.ready=(async()=>{const result=await view.loadGLB(cube);view.setObject(result.scene);let vertices=0;result.scene.traverse(node=>{vertices+=node.geometry?.attributes.position.count??0});window.result={vertices,canvases:document.querySelectorAll('canvas').length};view.dispose();window.disposed=document.querySelectorAll('canvas').length;})();`;
    const html = (script) =>
      `<!doctype html><html><body><main class="ve-scene"><div id="stage" style="width:500px;height:400px"></div></main>${script}</body></html>`;
    await writeFile(join(directory, 'index.html'), html(`<script type="module">${scene}</script>`));
    await buildScene(directory, join(directory, 'dist'), { sourcePackage: true });
    await writeFile(join(directory, 'offline.html'), await packDirectory(join(directory, 'dist')));
    // A regular consumer bundler needs no Draco-specific resolver or decoder setup.
    const compiled = await build({
      stdin: { contents: scene, resolveDir: directory },
      bundle: true,
      format: 'esm',
      write: false,
      tsconfigRaw: {},
      alias: { '@visual-storytelling/core/three': resolve('dist/viewport/index.js') },
      loader: { '.glb': 'dataurl' },
    });
    await writeFile(
      join(directory, 'compiled.html'),
      html(`<script type="module">${compiled.outputFiles[0].text}</script>`),
    );
    browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    for (const file of ['offline.html', 'compiled.html']) {
      await page.goto(pathToFileURL(join(directory, file)).href);
      await page.evaluate(() => window.ready);
      assert.deepEqual(
        await page.evaluate(() => window.result),
        { vertices: 8, canvases: 1 },
        file,
      );
      assert.equal(await page.evaluate(() => window.disposed), 0, file);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
