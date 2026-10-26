import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';

test('a frozen chapter preserves real WebGL pixels after the live buffer changes, using its existing viewport', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
      import {Viewport3D} from './dist/viewport/three.js';
      import * as T from './dist/viewport/engine.js';
      import {freezePresentation} from './dist/story/frozen-presentation.js';
      import {snapshotCanvas} from './dist/export/raster.js';
      const contexts=new Set(),nativeContext=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(kind,...args){const context=nativeContext.call(this,kind,...args);if(kind.startsWith('webgl')&&context)contexts.add(this);return context};
      const element=document.querySelector('section');
      const view=Viewport3D.mount(element);
      const material=new T.MeshBasicMaterial({color:0xff3300});
      view.setObject(new T.Mesh(new T.BoxGeometry(),material));
      const pixel=canvas=>[...canvas.getContext('2d').getImageData(canvas.width/2,canvas.height/2,1,1).data];
      window.ready=view.whenRendered().then(async()=>{
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const release=await freezePresentation({element,drawing:{}},new AbortController().signal);
        element.style.clipPath='inset(100%)';
        const frozen=document.querySelector('[data-presentation-frozen] canvas');
        const before=pixel(frozen);
        material.color.set(0x0033ff);view.invalidate();await view.whenRendered();
        const copy=document.createElement('canvas');await snapshotCanvas(view.renderer.domElement,copy);
        window.result={before,after:pixel(frozen),live:pixel(copy),gpu:contexts.size};
        window.finish=()=>{release();view.dispose()};
      });`,
    },
    bundle: true,
    write: false,
    format: 'iife',
  });
  const browser = await chromium.launch(chromiumLaunchOptions());
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<main style="position:relative;width:320px;height:180px"><section data-chapter="accepted" style="position:absolute;inset:0"></section></main>',
    );
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => ready);
    const result = await page.evaluate(() => window.result);
    assert.deepEqual(result.before, [255, 51, 0, 255]);
    assert.deepEqual(result.after, result.before);
    assert.deepEqual(result.live, [0, 51, 255, 255]);
    assert.equal(result.gpu, 1);
    await mkdir('artifacts/slice13', { recursive: true });
    await page.locator('main').screenshot({ path: 'artifacts/slice13/frozen-gpu.png' });
    await page.evaluate(() => finish());
    assert.equal(await page.locator('[data-presentation-frozen]').count(), 0);
  } finally {
    await browser.close();
  }
});
