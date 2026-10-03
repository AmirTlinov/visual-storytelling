import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { serve } from './site.mjs';
import { openScene } from './open-scene.mjs';

const catalog = JSON.parse(
  await readFile(new URL('../examples/catalog.json', import.meta.url), 'utf8'),
);
const scenes = Object.fromEntries(
  Object.entries(catalog).map(([id, item]) => [
    id,
    [item.page, item.checkpoints ?? [...new Set([0, item.time])]],
  ]),
);

async function settle(page, time) {
  await page.evaluate(async () => {
    await window.galleryReady;
    await document.fonts.ready;
    for (const audio of document.querySelectorAll('audio')) audio.pause();
    for (const svg of document.querySelectorAll('svg')) svg.pauseAnimations?.();
    for (const object of document.querySelectorAll('object')) {
      const doc = object.contentDocument;
      if (doc) {
        await doc.fonts.ready;
        doc.documentElement.pauseAnimations?.();
      }
    }
  });
  if (await page.locator('[data-mode=story]').isVisible())
    await page.locator('[data-mode=story]').click();
  await page.evaluate((time) => {
    const slider = document.querySelector('[data-seek]');
    if (slider) {
      slider.value = String(time);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }
    for (const svg of document.querySelectorAll('svg'))
      if (svg.setCurrentTime) svg.setCurrentTime(time);
    for (const object of document.querySelectorAll('object')) {
      const svg = object.contentDocument?.documentElement;
      if (svg?.setCurrentTime) {
        svg.pauseAnimations();
        svg.setCurrentTime(time);
      }
    }
  }, time);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

const [
  mode = 'capture',
  directory = 'site',
  output = 'artifacts/reference/pixels',
  reference = 'artifacts/reference/pixels',
] = process.argv.slice(2);
if (!['capture', 'compare'].includes(mode)) throw new Error('Choose capture or compare');
if (mode === 'compare' && resolve(output) === resolve(reference))
  throw new Error('Comparison output must differ from its reference');
const server = await serve(directory),
  browser = await chromium.launch();
const report = [];
try {
  for (const width of [960, 375])
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({
        viewport: { width, height: 1100 },
        deviceScaleFactor: 1,
        colorScheme: theme,
      });
      for (const [scene, [file, times]] of Object.entries(scenes)) {
        if (process.env.VISUAL_SCENES && !process.env.VISUAL_SCENES.split(',').includes(scene))
          continue;
        const page = await context.newPage(),
          errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        const url = `${server.url}/${scene}/${file}`;
        await openScene(page, url);
        for (const time of times) {
          await settle(page, time);
          const name = `${scene}-${width}-${theme}-${time}.png`,
            path = resolve(output, name);
          await mkdir(output, { recursive: true });
          console.log(name);
          await page.screenshot({ path, fullPage: true, timeout: 10000 });
          const item = { scene, width, theme, time, errors: [...errors] };
          if (mode === 'compare') {
            const { PNG } = await import('pngjs');
            const a = PNG.sync.read(await readFile(resolve(reference, name)));
            const b = PNG.sync.read(await readFile(path));
            let pixels = 0;
            if (a.width !== b.width || a.height !== b.height) pixels = -1;
            else
              for (let i = 0; i < a.data.length; i += 4)
                if ([0, 1, 2, 3].some((c) => a.data[i + c] !== b.data[i + c])) pixels++;
            item.changedPixels = pixels;
            item.dimensions = [a.width, a.height, b.width, b.height];
          }
          report.push(item);
        }
        await page.close();
      }
      await context.close();
    }
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  if (mode === 'compare' && report.some((item) => item.errors.length || item.changedPixels !== 0))
    process.exitCode = 1;
  console.log(
    JSON.stringify(
      {
        frames: report.length,
        errors: report.filter((x) => x.errors.length),
        changes: report.filter((x) => x.changedPixels),
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await server.close();
}
