import { chromium } from 'playwright';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { serve } from './site.mjs';
import { openScene, seekScene, controlScene } from './open-scene.mjs';
import { readCatalog } from './catalog.mjs';
import { assetURLs } from './asset-urls.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
export async function renderer({
  scene,
  theme,
  width = 960,
  height = 1200,
  controls = false,
  directory,
  entry = 'index.html',
  reduced = false,
  signal,
}) {
  signal?.throwIfAborted();
  if (![width, height].every((n) => Number.isInteger(n) && n > 0 && n <= 8192))
    throw new Error('Render viewport width and height must be integers from 1 to 8192');
  const catalog = directory ? undefined : await readCatalog();
  if (!directory && !catalog[scene]) throw new Error('Unknown example');
  const server = await serve(directory ?? resolve(root, 'site'));
  let launched, closing;
  const close = () =>
    (closing ??= (async () => {
      signal?.removeEventListener('abort', abort);
      try {
        await (await launched)?.close();
      } finally {
        await server.close();
      }
    })());
  const abort = () => {
    void close().catch(() => {});
  };
  try {
    launched = chromium.launch({
      executablePath: process.env.VISUAL_STORY_CHROMIUM,
      // Headless Chromium otherwise selects SwiftShader on macOS, even with Metal available.
      args: process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu'] : [],
    });
    signal?.addEventListener('abort', abort, { once: true });
    const browser = await launched;
    signal?.throwIfAborted();
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      colorScheme: theme,
      reducedMotion: reduced ? 'reduce' : 'no-preference',
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
    const file = directory ? entry : `${scene}/${catalog[scene].page}`,
      url = `${server.url}/${file.split('/').map(encodeURIComponent).join('/')}`;
    let rejectStartup;
    const startupFailure = new Promise((_, reject) => {
      rejectStartup = reject;
    });
    const onStartupFailure = (error) =>
      rejectStartup(new Error(`Scene failed during startup: ${error.message}`));
    page.on('pageerror', onStartupFailure);
    let capture;
    try {
      capture = await Promise.race([openScene(page, url), startupFailure]);
    } finally {
      page.off('pageerror', onStartupFailure);
    }
    await capture.evaluate((scene) => scene.pause());
    if (!controls)
      await page.evaluate(() => {
        document.querySelector('.ve-scene')?.setAttribute('data-scene-export', '');
        const drawing = document.querySelector('svg.canvas,svg.vs-canvas');
        const paper = drawing?.closest('.ve-scene');
        const before = drawing?.getBoundingClientRect();
        const origin = paper?.getBoundingClientRect();
        const position =
          paper &&
          getComputedStyle(paper).backgroundPosition.split(',')[0].split(/\s+/).map(parseFloat);
        const style = document.createElement('style');
        style.textContent =
          '.ve-player,.modes,.ve-parameters,.ve-view-actions,.caption,.ve-status{display:none!important}';
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
      plugins: [assetURLs()],
    });
    await page.addScriptTag({ content: exporter.outputFiles[0].text });
    const info = await capture.evaluate((scene) => scene.info());
    const seek = async (next) => {
      time = next;
      await seekScene(capture, time);
      if (errors.length) throw new Error(`Scene failed: ${errors.join('; ')}`);
    };
    await seek(0);
    signal?.throwIfAborted();
    return {
      page,
      capture,
      url: server.url,
      info,
      get messages() {
        return [...messages.values()];
      },
      seek,
      control: (commands) => controlScene(capture, commands),
      async png() {
        const frame = page.locator('[data-scene-frame]').first();
        if (!controls && (await frame.count())) return frame.screenshot();
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
