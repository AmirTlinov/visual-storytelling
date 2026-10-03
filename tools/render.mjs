import { chromium } from 'playwright';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { serve } from './site.mjs';
import { openScene, seekScene } from './open-scene.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
export async function renderer({ scene, theme, width = 960, controls = false, directory }) {
  const catalog = JSON.parse(await readFile(resolve(root, 'examples/catalog.json'), 'utf8'));
  if (!directory && !catalog[scene]) throw new Error('Unknown example');
  const server = await serve(directory ?? resolve(root, 'site'));
  let browser;
  const close = async () => {
    try {
      await browser?.close();
    } finally {
      await server.close();
    }
  };
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width, height: 1200 },
      deviceScaleFactor: 1,
      colorScheme: theme,
    });
    const page = await context.newPage();
    const errors = [];
    const messages = new Map();
    let time = 0;
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (!['warning', 'error'].includes(message.type())) return;
      const entry = { type: message.type(), text: message.text(), ...message.location(), time };
      const key = JSON.stringify([entry.type, entry.text, entry.url, entry.lineNumber]);
      const previous = messages.get(key);
      if (previous) {
        previous.count++;
        previous.lastTime = time;
      } else messages.set(key, { ...entry, lastTime: time, count: 1 });
    });
    const file = directory ? 'index.html' : `${scene}/${catalog[scene].page}`,
      url = `${server.url}/${file}`;
    const capture = await openScene(page, url);
    await capture.evaluate((scene) => scene.pause());
    if (!controls)
      await page.evaluate(() => {
        const drawing = document.querySelector('svg.canvas,svg.vs-canvas');
        const paper = drawing?.closest('.ve-scene');
        const before = drawing?.getBoundingClientRect();
        const origin = paper?.getBoundingClientRect();
        const position =
          paper &&
          getComputedStyle(paper).backgroundPosition.split(',')[0].split(/\s+/).map(parseFloat);
        const style = document.createElement('style');
        style.textContent =
          '.ve-player,.modes,.ve-parameters,.ve-view-actions,.ve-camera-reset,.caption,.ve-status{display:none!important}';
        document.head.append(style);
        // Hiding a row above the canvas must move its notebook grid by the same amount.
        if (paper && before && origin && position) {
          const after = drawing.getBoundingClientRect(),
            nextOrigin = paper.getBoundingClientRect();
          paper.style.backgroundPosition = `${position[0] + after.left - before.left + origin.left - nextOrigin.left}px ${position[1] + after.top - before.top + origin.top - nextOrigin.top}px`;
        }
      });
    const exporter = await build({
      entryPoints: [resolve(root, 'dist/export/index.js')],
      bundle: true,
      format: 'iife',
      globalName: 'VisualExport',
      write: false,
      loader: { '.woff2': 'dataurl' },
    });
    await page.addScriptTag({ content: exporter.outputFiles[0].text });
    const info = await capture.evaluate((scene) => scene.info());
    const seek = async (next) => {
      time = next;
      await seekScene(capture, time);
      if (errors.length) throw new Error(`Scene failed: ${errors.join('; ')}`);
    };
    await seek(0);
    return {
      page,
      capture,
      url: server.url,
      info,
      get messages() {
        return [...messages.values()];
      },
      seek,
      async png() {
        const main = page.locator('.ve-scene').first();
        return (await main.count()) ? main.screenshot() : page.screenshot({ fullPage: true });
      },
      svg: () => capture.evaluate((scene) => scene.exportSVG()),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
