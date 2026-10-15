import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { assetURLs } from '../tools/asset-urls.mjs';
import {
  validateStoryDocument,
  prepareStoryDocument,
  documentModelsAt,
  cueSheet,
} from '../dist/index.js';

const authored = { recipe: 'circuit', inputs: { closed: false } };
test('circuit recipe preserves explicit static/narrative choices and rejects invalid physics inputs', () => {
  const doc = validateStoryDocument(authored);
  assert.equal(doc.models[0].module, 'circuit');
  assert.equal(doc.chapters.length, 1);
  const { script } = prepareStoryDocument(doc);
  assert.equal(
    documentModelsAt(doc, cueSheet(script).at(script.duration)).models.circuit.closed,
    true,
  );
  assert.deepEqual(validateStoryDocument({ ...authored, chapters: [] }).chapters, []);
  assert.throws(() => validateStoryDocument({ ...authored, inputs: { closed: 1 } }), /boolean/);
  assert.throws(
    () => validateStoryDocument({ ...authored, inputs: { closed: false, resistance: 10 } }),
    /boolean/,
  );
});
test(
  'circuit artwork follows one model, keyboard input, undo and replay at mobile/desktop sizes',
  { timeout: 60000 },
  async () => {
    const bundled = await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `import {IllustratedStory} from './dist/story/illustrated.js';import './dist/style.css'; window.ready=IllustratedStory.mount(document.querySelector('main'),{document:${JSON.stringify(authored)}}).then(lab=>window.lab=lab);`,
      },
      bundle: true,
      write: false,
      outdir: '.',
      format: 'iife',
      plugins: [assetURLs()],
      loader: { '.woff2': 'dataurl' },
    });
    const browser = await chromium.launch(chromiumLaunchOptions());
    const out = 'artifacts/slice14/circuit';
    await mkdir(out, { recursive: true });
    const observations = [];
    try {
      for (const width of [320, 390, 1200]) {
        const page = await browser.newPage({ viewport: { width, height: 800 } });
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.setContent('<body class="ve-standalone"><main class="ve-scene"></main></body>');
        await page.addStyleTag({
          content: bundled.outputFiles.find((f) => f.path.endsWith('.css')).text,
        });
        await page.addScriptTag({
          content: bundled.outputFiles.find((f) => f.path.endsWith('.js')).text,
        });
        await page.evaluate(() => window.ready);
        const seek = async (time) =>
          page.evaluate(async (time) => {
            lab.scene.seek(time);
            await lab.scene.ready();
          }, time);
        const state = () =>
          page.evaluate(() => ({
            snapshot: lab.scene.snapshot(),
            objects: lab.scene.inspect({ presentation: false }).objects,
          }));
        await seek(0);
        assert.equal((await state()).snapshot.closed, false);
        await seek(4);
        assert.equal((await state()).snapshot.closed, true);
        assert.equal((await state()).objects.find((x) => x.id === 'circuit:lamp').value, true);
        await seek(0);
        assert.equal((await state()).snapshot.closed, false);
        await seek(4);
        const switchButton = page.getByRole('button', {
          name: 'Замкнуть или разомкнуть цепь',
          exact: true,
        });
        await switchButton.focus();
        await page.keyboard.press('Space');
        await page.evaluate(() => lab.scene.ready());
        assert.equal((await state()).snapshot.closed, false);
        await page.evaluate(() => lab.scene.undoExperiment());
        assert.equal((await state()).snapshot.closed, true);
        await switchButton.evaluate((n) => n.blur());
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await seek(4);
        assert.equal(await page.locator('[data-object^="circuit:current-"]:visible').count(), 0);
        for (const theme of ['light', 'dark']) {
          await page.evaluate(async (theme) => {
            await lab.scene.setTheme(theme);
          }, theme);
          const geometry = await page.evaluate(() => {
            const root = document.querySelector('[data-object="loop"]'),
              bounds = root.getBoundingClientRect(),
              frame = document.querySelector('[data-scene-frame]').getBoundingClientRect();
            return {
              bounds: {
                left: bounds.left,
                right: bounds.right,
                top: bounds.top,
                bottom: bounds.bottom,
              },
              frame: { left: frame.left, right: frame.right, top: frame.top, bottom: frame.bottom },
              fonts: [...root.querySelectorAll('text')]
                .filter((n) => n.textContent)
                .map(
                  (n) =>
                    Number(n.getAttribute('font-size')) *
                    Math.hypot(n.getScreenCTM().a, n.getScreenCTM().b),
                ),
              overflow: document.documentElement.scrollWidth > innerWidth,
              colorScheme: getComputedStyle(document.querySelector('main')).colorScheme,
            };
          });
          assert(!geometry.overflow);
          assert.equal(geometry.colorScheme, theme);
          assert(
            geometry.fonts.every((size) => size >= 15.9),
            JSON.stringify(geometry),
          );
          assert(
            geometry.bounds.left >= geometry.frame.left - 1 &&
              geometry.bounds.right <= geometry.frame.right + 1,
            JSON.stringify(geometry),
          );
          const png = await page
            .locator('[data-scene-frame]')
            .screenshot({ path: `${out}/${width}-${theme}.png` });
          const { data, info } = await sharp(png)
            .removeAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
          const offset = (info.width * 10 + 10) * info.channels;
          const brightness = [...data.subarray(offset, offset + 3)].reduce((a, b) => a + b) / 3;
          assert(
            theme === 'dark' ? brightness < 100 : brightness > 200,
            `${theme} paper brightness ${brightness}`,
          );
          observations.push({ width, theme, geometry, state: await state() });
        }
        const before = await page.evaluate(() => ({
          doc: lab.scene.authoring.document,
          svg: document.querySelector('[data-object="loop"]').outerHTML,
        }));
        const failure = await page.evaluate(async () => {
          const doc = structuredClone(lab.scene.authoring.document);
          doc.chapters[0].beats[1].text = 'x'.repeat(200);
          try {
            await lab.scene.authoring.replace(doc);
          } catch (e) {
            return e.message;
          }
        });
        assert.match(failure, /short readable/);
        assert.deepEqual(
          await page.evaluate(() => ({
            doc: lab.scene.authoring.document,
            svg: document.querySelector('[data-object="loop"]').outerHTML,
          })),
          before,
        );
        await page.evaluate(async () => {
          const doc = structuredClone(lab.scene.authoring.document);
          doc.views[0].id = 'new-loop';
          await lab.scene.authoring.replace(doc);
        });
        assert.equal(await page.locator('[data-object="loop"]').count(), 0);
        assert.equal(await page.locator('[data-object="new-loop"]').count(), 1);
        const description = await page.locator('svg.vs-canvas > desc').textContent();
        assert.match(description, /не скорость электронов/);
        assert(!description.includes('Путь тока замкнут'));
        assert.deepEqual(errors, []);
        await page.close();
      }
      await writeFile(out + '/observations.json', JSON.stringify(observations, null, 2));
    } finally {
      await browser.close();
    }
  },
);
