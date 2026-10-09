import { test, expect } from '@playwright/test';
import { build } from 'esbuild';

test('handwriting keeps logical metrics through scaling, hidden chapters and reverse updates', async ({
  page,
}, testInfo) => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
        import { lettering, paragraph } from './dist/ink/index.js';
        import { measureText } from './dist/ink/text-measure.js';
        import { loadFonts } from './dist/ink/fonts.js';
        import './dist/style.css';
        window.inkMetrics = { lettering, paragraph, measureText, ready: loadFonts() };`,
    },
    bundle: true,
    format: 'iife',
    outfile: 'ink-metrics.js',
    write: false,
    loader: { '.woff2': 'dataurl' },
  });
  await page.setContent(`<!doctype html><main style="width:1280px;height:720px;transform-origin:0 0">
    <svg width="1280" height="720" viewBox="0 0 1280 720">
      <g id="chapter" style="font-family:SketchPencil;font-size:26px;letter-spacing:.5px">
        <text id="native" x="50%" y="44" text-anchor="middle" transform="scale(.7)">15 м</text>
      </g>
    </svg></main>`);
  await page.addStyleTag({
    content: bundle.outputFiles.find((f) => f.path.endsWith('.css'))!.text,
  });
  await page.addScriptTag({
    content: bundle.outputFiles.find((f) => f.path.endsWith('.js'))!.text,
  });
  const frames = [];
  for (const width of [1312, 390, 1312]) {
    await page.setViewportSize({ width, height: 900 });
    frames.push(
      await page.evaluate(async (width) => {
        const { lettering, paragraph, measureText, ready } = (window as any).inkMetrics;
        await ready;
        const main = document.querySelector('main')!;
        const chapter = document.querySelector<SVGGElement>('#chapter')!;
        main.style.transform = `scale(${Math.min(1, width / 1280)})`;
        const labels = ['body', 'heading', 'note'].map((handwriting) =>
          lettering(chapter, '15 м', {
            x: 220,
            y: 120,
            size: 26,
            handwriting,
            bounds: { width: 80, height: 40, padding: 3 },
          }),
        );
        const geometry = (label: any) => ({
          width: label.width,
          bounds: label.bounds,
          transform: label.element.getAttribute('transform'),
          strokes: [...label.element.querySelectorAll('[data-written-text] > g')].map(
            (glyph: any) => ({
              transform: glyph.getAttribute('transform'),
              paths: [...glyph.querySelectorAll('path')].map((path: any) => path.getAttribute('d')),
            }),
          ),
        });
        const samples = [],
          timing = [];
        const phrase =
          'При изменении системы координат компоненты тензора меняются, а физический смысл величины сохраняется. ' +
          'Измерьте расстояние между двумя отмеченными точками и сравните результат с предположением.';
        for (const hidden of [false, true, false]) {
          chapter.style.display = hidden ? 'none' : '';
          // Re-enter the value while hidden as well as while visible; cached glyphs must not hide a drift.
          for (const value of ['8 м', '15 м'])
            for (const label of labels) {
              label.text(value);
              label.write(0.3);
              label.write(1);
            }
          const native = measureText(document.querySelector('#native'), (text: SVGTextElement) => ({
            width: text.getComputedTextLength(),
            start: text.getStartPositionOfChar(0).x,
          }));
          const paragraphStart = performance.now();
          const explanation = paragraph(chapter, { size: 24 });
          explanation.render(phrase, 550, 360, 250);
          explanation.write(0.3);
          explanation.write(1);
          timing.push(performance.now() - paragraphStart);
          samples.push({
            labels: labels.map(geometry),
            native,
            paragraph: {
              bounds: explanation.bounds,
              rows: [...explanation.element.querySelectorAll('.vs-lettering')].map((row: any) => ({
                text: row.getAttribute('aria-label'),
                transform: row.getAttribute('transform'),
                glyphs: [...row.querySelectorAll('[data-written-text] > g')].map((glyph: any) =>
                  glyph.getAttribute('transform'),
                ),
              })),
            },
          });
          explanation.dispose();
        }
        const updates = [];
        for (let i = 0; i < 50; i++) {
          const start = performance.now();
          labels[0].text(i % 2 ? '15 м' : '8 м');
          updates.push(performance.now() - start);
        }
        labels.forEach((label) => label.dispose());
        return {
          samples,
          timing,
          updates,
          measurementTrees: document.querySelectorAll('body > svg').length,
        };
      }, width),
    );
  }
  const first = frames[0]!.samples[0]!;
  for (const frame of frames) {
    expect(frame.measurementTrees).toBe(0);
    for (const sample of frame.samples) expect(sample).toEqual(first);
  }
  expect(first.native.start).toBeGreaterThan(550);
  expect(first.native.start).toBeLessThan(640);
  expect(first.paragraph.bounds.width).toBeLessThanOrEqual(550);
  expect(first.paragraph.rows).toHaveLength(6);
  await testInfo.attach('lettering-preparation-ms', {
    contentType: 'application/json',
    body: JSON.stringify({
      paragraphs: frames.flatMap((frame) => frame.timing),
      updates: frames.flatMap((frame) => frame.updates),
    }),
  });
});
