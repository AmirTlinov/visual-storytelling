import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { assetURLs } from '../tools/asset-urls.mjs';

test('physical handwriting retains stroke coverage through subpixel motion and frame scaling', async () => {
  const bundled = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
      import {SceneShell} from './dist/scene.js';
      import {Viewport3D, ThreeKit as T} from './dist/viewport/index.js';
      import './dist/style.css';
      window.ready = SceneShell.ready().then(() => {
        const stage=document.querySelector('#stage'), view=Viewport3D.mount(stage);
        const anchor=new T.Group(); view.setObject(anchor,{fitView:false});
        const label=view.label('следующее слово',anchor,{space:'world',height:.75,maxWidth:8});
        view.camera.position.set(0,0,20);view.controls.target.set(0,0,0);view.controls.update();
        view.invalidate();window.lab={view,anchor,label,stage};
      });
    `,
    },
    outdir: '.',
    bundle: true,
    write: false,
    format: 'iife',
    loader: { '.woff2': 'dataurl' },
    plugins: [assetURLs()],
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1200, height: 800 },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      '<main class="ve-scene"><div id="stage" class="ve-stage" style="width:800px;height:400px;position:relative;transform-origin:0 0;--ve-ink:#000"></div></main>',
    );
    for (const file of bundled.outputFiles.filter((file) => file.path.endsWith('.css')))
      await page.addStyleTag({ content: file.text });
    await page.addScriptTag({
      content: bundled.outputFiles.find((file) => file.path.endsWith('.js')).text,
    });
    await page.evaluate(() => ready);
    const settle = () =>
      page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
    await settle();
    const geometry = () =>
      page.evaluate(() =>
        lab.label.object.children.map((plane) => ({
          position: plane.position.toArray(),
          scale: plane.scale.toArray(),
          rotation: plane.quaternion.toArray(),
        })),
      );
    const original = await geometry();
    for (const scale of [1, 0.6, 1]) {
      await page.evaluate((scale) => {
        lab.stage.style.transform = `scale(${scale})`;
        lab.stage.dispatchEvent(new CustomEvent('scene-frame-resize', { bubbles: true }));
      }, scale);
      await settle();
      const coverage = [];
      for (let step = 0; step < 10; step++) {
        await page.evaluate((step) => {
          lab.anchor.position.x = step * 0.004;
          lab.view.invalidate();
        }, step);
        await settle();
        const pixels = PNG.sync.read(await page.locator('canvas').screenshot());
        let mass = 0;
        for (let i = 0; i < pixels.data.length; i += 4)
          mass += (765 - pixels.data[i] - pixels.data[i + 1] - pixels.data[i + 2]) / 765;
        coverage.push(mass);
      }
      const spread =
        (Math.max(...coverage) - Math.min(...coverage)) /
        (coverage.reduce((sum, value) => sum + value, 0) / coverage.length);
      assert.ok(
        coverage.every((value) => value > 20),
        'the whole physical inscription remains painted',
      );
      assert.ok(
        spread < 0.08,
        `stroke coverage jumps by ${(spread * 100).toFixed(1)}% at frame scale ${scale}`,
      );
      assert.deepEqual(
        await geometry(),
        original,
        'raster density and camera translation cannot change inscription geometry',
      );
    }
  } finally {
    await browser.close();
  }
});
