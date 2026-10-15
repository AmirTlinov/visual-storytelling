import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { assetURLs } from '../tools/asset-urls.mjs';

test('authored fraction and route attention uses the shared contour without replacing viewer selection', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
    import {IllustratedStory} from './dist/story/illustrated.js';import './dist/style.css';
    window.mount=async(recipe)=>{
      const root=document.querySelector('main');root.scene?.dispose();root.replaceChildren();
      const fraction=recipe==='fractions', model=fraction?'fractions':'route';
      const targets=fraction?['fractions:left','fractions:right']:['route:order:417','route:node:provider'];
      const inputs=fraction?{leftNumerator:1,leftDenominator:2,rightNumerator:1,rightDenominator:3,action:'move'}:{orderId:'417',reserve:'none'};
      const lesson=await IllustratedStory.mount(root,{document:{recipe,inputs,chapters:[{id:'look',title:'Проследим предмет',beats:[{id:'first',seconds:2,focus:[targets[0]],...(!fraction?{operation:{model,name:'trace'}}:{})},{id:'second',seconds:2,focus:[targets[1]]},{id:'clear',seconds:1}]}]}});
      window.scene=lesson.scene;return targets;
    };
    window.read=()=>({selected:scene.selected,highlight:[...document.querySelectorAll('[data-story-highlight]')].map(n=>n.dataset.object),contours:[...document.querySelectorAll('[data-contour-emphasized]')].map(n=>({visible:getComputedStyle(n.querySelector('[data-selection-contour]')).visibility,bounds:n.getBoundingClientRect().toJSON()}))});
  `,
    },
    bundle: true,
    write: false,
    outdir: '.',
    format: 'iife',
    plugins: [assetURLs()],
    loader: { '.woff2': 'dataurl' },
  });
  const browser = await chromium.launch(chromiumLaunchOptions());
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    await page.setContent('<main class="ve-scene"></main>');
    await page.addStyleTag({
      content: bundle.outputFiles.find((f) => f.path.endsWith('.css')).text,
    });
    await page.addScriptTag({
      content: bundle.outputFiles.find((f) => f.path.endsWith('.js')).text,
    });
    for (const recipe of ['fractions', 'dependency-route']) {
      const targets = await page.evaluate((recipe) => mount(recipe), recipe);
      const first = await page.evaluate(() => read());
      assert.deepEqual(first.highlight, [targets[0]]);
      assert.deepEqual(first.selected, []);
      assert.equal(first.contours[0].visible, 'visible');
      await page.evaluate(async (target) => {
        await scene.control([
          { type: 'select', ids: [target] },
          { type: 'seek', time: 2.5 },
        ]);
      }, targets[0]);
      const second = await page.evaluate(() => read());
      assert.deepEqual(second.highlight, [targets[1]]);
      assert.deepEqual(second.selected, [targets[0]]);
      assert.equal(second.contours[0].visible, 'visible');
      await page.evaluate(() => scene.control([{ type: 'seek', time: 4.5 }]));
      assert.deepEqual((await page.evaluate(() => read())).highlight, []);
      await page.evaluate(() => scene.control([{ type: 'seek', time: 0.2 }]));
      assert.deepEqual((await page.evaluate(() => read())).highlight, [targets[0]]);
      await page.setViewportSize({ width: 960, height: 900 });
      await page.evaluate(() => scene.ready());
      assert.deepEqual((await page.evaluate(() => read())).highlight, [targets[0]]);
    }
  } finally {
    await browser.close();
  }
});
