import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('public MorphStory keeps physical lettering, local detail and a reversible linear map in a bounded frame', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'morph-frame-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
        import {MathMorph, MorphStory} from './dist/index.js';
        import './dist/style.css';
        window.galleryReady = MorphStory.mount(document.querySelector('main'), {
          title:'Почему площадь растёт быстрее стороны', presenter:MathMorph, initial:{k:2},
          parameters:[{key:'k',label:'Масштаб стороны k',min:1,max:3,step:.25}],
          script:{duration:16,cues:{scale:{start:2,end:12,action:'Умножить обе стороны.'}},segments:[{id:'scale',start:0,end:16,title:'Два направления роста',text:'Два направления одной клетки меняются вместе.'}]},
          chapters:[{id:'scale',operation:({k})=>MathMorph.linear([[k,0],[0,k]])}],
        }).then(lesson=>window.lesson=lesson);
      `,
    },
    bundle: true,
    format: 'iife',
    outfile: join(directory, 'index.js'),
    loader: { '.woff2': 'dataurl' },
  });
  await writeFile(
    join(directory, 'index.html'),
    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="index.css"><style>body{margin:0}</style><main class="ve-scene"></main><script src="index.js"></script>',
  );
  const browser = await chromium.launch(chromiumLaunchOptions());
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pathToFileURL(join(directory, 'index.html')).href);
  await page.evaluate(() => window.galleryReady);
  for (const width of [390, 960, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      for (const k of [1, 2, 3]) {
        const states = await page.evaluate(
          async ({ k }) => {
            const { presentation } = lesson;
            lesson.story.explore({ ...lesson.story.requested.values, k });
            await lesson.story.ready();
            const state = () =>
              [...presentation.element.querySelectorAll('path')]
                .map((el) => el.getAttribute('d'))
                .join('|');
            return [0.15, 0.57, 1].map((progress) => {
              presentation.render(progress);
              const before = state();
              presentation.render(1);
              presentation.render(0);
              presentation.render(progress);
              const paper = presentation.element.querySelector('svg');
              const aperture = paper.getBoundingClientRect();
              const frame = paper.closest('[data-scene-frame]').getBoundingClientRect();
              const texts = [...paper.querySelectorAll('.vs-lettering')]
                .map((el) => {
                  const rect = el.getBoundingClientRect(),
                    m = el.getScreenCTM(),
                    ref = el.querySelector('text');
                  return {
                    text: el.getAttribute('aria-label'),
                    size: Number(ref?.getAttribute('font-size')) * Math.hypot(m.c, m.d),
                    rect: {
                      left: rect.left,
                      right: rect.right,
                      top: rect.top,
                      bottom: rect.bottom,
                      width: rect.width,
                      height: rect.height,
                    },
                  };
                })
                .filter((item) => item.rect.width && item.rect.height);
              return {
                progress,
                reversed: state() === before,
                frameRatio: frame.width / frame.height,
                texts,
                aperture: {
                  left: aperture.left,
                  right: aperture.right,
                  top: aperture.top,
                  bottom: aperture.bottom,
                },
              };
            });
          },
          { k },
        );
        for (const state of states) {
          assert.equal(
            state.reversed,
            true,
            `reversible material at ${width}/${theme}/${k}/${state.progress}`,
          );
          assert.ok(Math.abs(state.frameRatio - 16 / 9) < 1e-6);
          assert.ok(state.texts.length >= 3, 'geometry and formula remain visibly labelled');
          for (const item of state.texts) {
            assert.ok(item.size >= 16, `${width}/${k}: ${item.text} is ${item.size}px`);
            assert.ok(
              item.rect.left >= state.aperture.left - 2 &&
                item.rect.right <= state.aperture.right + 2 &&
                item.rect.top >= state.aperture.top - 2 &&
                item.rect.bottom <= state.aperture.bottom + 2,
              `${width}/${k}: ${item.text} lies in the composition`,
            );
          }
        }
      }
    }
    if (width === 390) {
      const detail = page.getByRole('button', { name: 'Разбор', exact: true });
      const box = await detail.boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44, 'detail action has a physical 44px target');
      await detail.click();
      const panel = page.getByRole('region', { name: 'Разбор', exact: true });
      await panel.waitFor({ state: 'visible' });
      assert.ok(await panel.isVisible());
      assert.match(await panel.innerText(), /Модуль определителя/);
      await page.keyboard.press('Escape');
      await panel.waitFor({ state: 'hidden' });
      assert.equal(await panel.isVisible(), false);
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    lesson.presentation.render(0.57);
    lesson.presentation.render(0);
    lesson.presentation.render(0.57);
  });
  assert.deepEqual(errors, []);
});
