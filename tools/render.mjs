import { chromium } from 'playwright';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { serve } from './site.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
export async function renderer({ scene, theme, width = 960, controls = false, directory }) {
  const catalog = JSON.parse(await readFile(resolve(root, 'examples/catalog.json'), 'utf8'));
  if (!directory && !catalog[scene]) throw new Error('Unknown example');
  const server = await serve(directory ?? resolve(root, 'site')),
    browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width, height: 1200 },
      deviceScaleFactor: 1,
      colorScheme: theme,
    });
    const file = directory ? 'index.html' : `${scene}/${catalog[scene].page}`,
      url = `${server.url}/${file}`;
    if (file.endsWith('.svg'))
      await page.setContent(
        `<html style="color-scheme:light dark"><body style="margin:0"><main class="ve-scene" style="width:100%"><object type="image/svg+xml" data="${url}" style="width:100%;height:1500px"></object></main></body></html>`,
      );
    else await page.goto(url);
    await page.waitForFunction(
      () =>
        document.querySelector('svg,canvas') ||
        document.querySelector('object')?.contentDocument?.documentElement?.tagName === 'svg',
    );
    await page.evaluate(async () => {
      await window.galleryReady;
      await document.fonts.ready;
      for (const object of document.querySelectorAll('object'))
        await object.contentDocument?.fonts.ready;
      window.explainer?.pause();
      for (const audio of document.querySelectorAll('audio')) audio.pause();
    });
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
      loader: { '.woff2': 'dataurl' },
    });
    await page.addScriptTag({ content: exporter.outputFiles[0].text });
    const info = await page.evaluate(() => ({
      duration:
        window.explainer?.duration ?? Number(document.querySelector('[data-seek]')?.max ?? 0),
      audioURL: document.querySelector('audio:not([data-silent=true])')?.src,
      checkpoints: window.explainer?.checkpoints ?? [0],
    }));
    const seek = async (time) => {
      await page.evaluate((time) => {
        if (window.explainer) {
          window.explainer.pause();
          window.explainer.seek(time);
          return;
        }
        const button = document.querySelector('[data-mode=story]');
        if (button && !button.hidden) button.click();
        const seek = document.querySelector('[data-seek]');
        if (seek) {
          seek.value = String(time);
          seek.dispatchEvent(new Event('input', { bubbles: true }));
        }
        for (const svg of [
          document.querySelector('svg.canvas'),
          ...[...document.querySelectorAll('object')].map(
            (o) => o.contentDocument?.documentElement,
          ),
        ])
          if (svg?.setCurrentTime) {
            svg.pauseAnimations();
            svg.setCurrentTime(time);
          }
      }, time);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
    };
    await seek(0);
    return {
      page,
      url: server.url,
      info,
      seek,
      async png() {
        const main = page.locator('.ve-scene').first();
        return (await main.count()) ? main.screenshot() : page.screenshot({ fullPage: true });
      },
      async svg() {
        return page.evaluate(() => {
          if (document.querySelector('canvas'))
            throw new Error('Use PNG, HTML or MP4 for a 3D surface');
          const svg =
            document.querySelector('svg.canvas,svg.vs-canvas') ??
            document.querySelector('object')?.contentDocument?.documentElement;
          if (!svg) throw new Error('No SVG surface');
          return window.VisualExport.exportSVG(svg);
        });
      },
      async close() {
        await browser.close();
        await server.close();
      },
    };
  } catch (error) {
    await browser.close();
    await server.close();
    throw error;
  }
}
