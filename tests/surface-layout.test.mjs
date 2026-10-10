import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { serve } from '../tools/site.mjs';

test('SVG shell preserves logical drawing geometry within its scaled composition', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-surface-'));
  let browser, server;
  try {
    await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
        import { SceneShell, surface } from './dist/index.js';
        import './dist/style.css';
        window.galleryReady = SceneShell.ready().then(() => {
          const shell = SceneShell.mount(document.querySelector('main'), {title:'Fractions'});
          const drawing = surface(shell.stage,{id:'fractions',width:360,height:440,title:'Parts',description:'Equal parts',grid:false});
          const resize = new ResizeObserver(() => drawing.resize(shell.stage.clientWidth,440,false));
          resize.observe(shell.stage);
        });`,
      },
      bundle: true,
      format: 'iife',
      outfile: join(directory, 'index.js'),
      loader: { '.woff2': 'dataurl' },
    });
    await writeFile(
      join(directory, 'index.html'),
      '<!doctype html><html><head><link rel="stylesheet" href="index.css"></head><body class="ve-standalone"><main class="ve-scene"></main><script src="index.js"></script></body></html>',
    );
    server = await serve(directory);
    browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(server.url);
    await page.evaluate(() => window.galleryReady);
    for (const width of [960, 375, 700, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForFunction(() => {
        const svg = document.querySelector('.vs-canvas');
        const scale = Number(svg.closest('[data-scene-frame]').dataset.frameScale);
        return Math.abs(svg.getBoundingClientRect().width - svg.viewBox.baseVal.width * scale) < 1;
      });
      const dimensions = await page.locator('.vs-canvas').evaluate((svg) => ({
        height: svg.getBoundingClientRect().height,
        logicalHeight: svg.viewBox.baseVal.height,
        inside:
          svg.getBoundingClientRect().bottom <=
          svg.closest('[data-scene-frame]').getBoundingClientRect().bottom + 0.1,
        frameScale: Number(svg.closest('[data-scene-frame]').dataset.frameScale),
        width: svg.getBoundingClientRect().width,
        logicalWidth: svg.viewBox.baseVal.width,
        scale: svg.getScreenCTM().a,
      }));
      assert.equal(dimensions.logicalHeight, 440);
      assert(
        dimensions.height >= 440 * dimensions.frameScale,
        'the aperture contains the full logical drawing',
      );
      assert(dimensions.inside, 'the drawing stays inside the composition');
      assert(Math.abs(dimensions.width - dimensions.logicalWidth * dimensions.frameScale) < 0.05);
      assert(Math.abs(dimensions.scale - dimensions.frameScale) < 1e-6);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
