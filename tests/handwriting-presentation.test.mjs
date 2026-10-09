import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('Russian explanations and mathematics share one complete pen across fonts, writing and fusion', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'handwriting-'));
  let browser;
  try {
    await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
          import { lettering } from './src/ink/lettering.ts';
          import { paragraph } from './src/ink/paragraph.ts';
          import { fusionText } from './src/ink/fusion/text.ts';
          import { loadFonts } from './src/ink/fonts.ts';
          import { handwritingFamily } from './src/ink/handwriting.ts';
          import './src/styles/handwriting.css';
          window.ink = { lettering, paragraph, fusionText, loadFonts, handwritingFamily };
        `,
      },
      bundle: true,
      format: 'iife',
      outfile: join(directory, 'index.js'),
      loader: { '.woff2': 'dataurl' },
      logLevel: 'silent',
    });
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent('<main></main>');
    await page.addStyleTag({ content: await readFile(join(directory, 'index.css'), 'utf8') });
    await page.addScriptTag({ content: await readFile(join(directory, 'index.js'), 'utf8') });
    await page.evaluate(() => ink.loadFonts());
    const result = await page.evaluate(async () => {
      const cases = [
        'Почему более крутая линия означает большую скорость?',
        'За каждую секунду — ещё три метра',
        'Δs / Δt = 3 м/с',
        'T′ = R T Rᵀ',
        'Площадь = 6 × 2 = 12 см²',
        '0123456789 0,25 · 10³ ± ≤ ≥ ≠ ∞ α β γ δ ε λ π σ φ ω',
        'i j l · . : ; | ! ( )',
      ];
      const ns = 'http://www.w3.org/2000/svg';
      const canvas = () => {
        const element = document.createElement('canvas');
        element.width = 1500;
        element.height = 120;
        return element.getContext('2d', { willReadFrequently: true });
      };
      const raster = async (element) => {
        const context = canvas();
        const image = new Image();
        image.src = URL.createObjectURL(new Blob([element.outerHTML], { type: 'image/svg+xml' }));
        await image.decode();
        context.drawImage(image, 0, 0);
        URL.revokeObjectURL(image.src);
        return context.getImageData(0, 0, 1500, 120).data;
      };
      const mismatch = (a, b) => {
        let samples = 0,
          misses = 0;
        for (let y = 1; y < 119; y++)
          for (let x = 1; x < 1499; x++) {
            if (a[(y * 1500 + x) * 4 + 3] < 100) continue;
            samples++;
            let found = false;
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++)
                found ||= b[((y + dy) * 1500 + x + dx) * 4 + 3] >= 100;
            if (!found) misses++;
          }
        return misses / samples;
      };
      const samples = [];
      for (const profile of ['body', 'heading', 'note']) {
        const context = canvas();
        context.font = `400 36px ${ink.handwritingFamily(profile)}`;
        const advances = [...'0123456789'].map((digit) => context.measureText(digit).width);
        const metrics = [...'0123456789'].map((digit) => context.measureText(digit));
        const minimumGap = Math.min(
          ...metrics.flatMap((left) =>
            metrics.map(
              (right) => left.width - left.actualBoundingBoxRight - right.actualBoundingBoxLeft,
            ),
          ),
        );
        for (const text of cases) {
          const size = text.startsWith('i j l') ? 72 : 36;
          context.font = `400 ${size}px ${ink.handwritingFamily(profile)}`;
          const root = document.createElementNS(ns, 'svg');
          root.setAttribute('xmlns', ns);
          root.setAttribute('width', '1500');
          root.setAttribute('height', '120');
          root.style.color = 'black';
          document.querySelector('main').append(root);
          const label = ink.lettering(root, text, {
            x: 24,
            y: 80,
            size,
            anchor: 'start',
            handwriting: profile,
          });
          const paths = [...root.querySelectorAll('path')];
          const written = label.element.querySelector('[data-written-text]');
          const font = canvas();
          font.font = context.font;
          font.fillText(text, 24, 80);
          const a = font.getImageData(0, 0, 1500, 120).data;
          const b = await raster(root);
          const shape = ink.fusionText(text, {
            size,
            maxWidth: 1e6,
            handwriting: profile,
            align: 'left',
          });
          const first = paths[0].getPointAtLength(0).matrixTransform(paths[0].getCTM());
          const dx = first.x - shape.paths[0][0][0],
            dy = first.y - shape.paths[0][0][1];
          let fusionDistance = 0;
          paths.forEach((path, index) => {
            for (const position of [0, 1]) {
              const point = path
                .getPointAtLength(path.getTotalLength() * position)
                .matrixTransform(path.getCTM());
              const counterpart = position ? shape.paths[index].at(-1) : shape.paths[index][0];
              fusionDistance = Math.max(
                fusionDistance,
                Math.hypot(point.x - dx - counterpart[0], point.y - dy - counterpart[1]),
              );
            }
          });
          label.write(0.37);
          const state = () =>
            paths.map((path) => [
              path.getAttribute('d'),
              path.parentElement.getAttribute('transform'),
              path.style.strokeDashoffset,
              path.style.visibility,
            ]);
          const earlier = JSON.stringify(state());
          label.write(0.86);
          label.write(1);
          label.write(0.37);
          samples.push({
            profile,
            text,
            advances,
            minimumGap,
            paths: paths.length,
            fusionPaths: shape.paths.length,
            complete: Boolean(written),
            mismatch: Math.max(mismatch(a, b), mismatch(b, a)),
            fusionDistance,
            reversible: JSON.stringify(state()) === earlier,
          });
          label.dispose();
          root.remove();
        }
      }
      const root = document.createElementNS(ns, 'svg');
      root.setAttribute('width', '390');
      root.setAttribute('height', '900');
      document.querySelector('main').append(root);
      const paragraph = ink.paragraph(root, { size: 26 });
      const value =
        cases[0] +
        ' ' +
        cases[1] +
        '. Расстояние увеличивается равномерно, поэтому график остаётся прямым.';
      const layouts = [350, 280, 420, 350].map((width) => {
        paragraph.render(value, width, 195, 40);
        return {
          width,
          lines: [...root.querySelectorAll('.vs-lettering')].map((row) => ({
            text: row.getAttribute('aria-label'),
            size: Number(row.dataset.letteringSize),
            width: row.getBBox().width,
          })),
        };
      });
      paragraph.dispose();
      root.remove();
      return { samples, layouts, value };
    });
    assert.deepEqual(errors, []);
    for (const sample of result.samples) {
      const description = `${sample.profile}: ${sample.text}`;
      assert.equal(sample.complete, true, `complete authored pen: ${description}`);
      assert.ok(
        sample.mismatch < 0.015,
        `font and animated pen diverged ${sample.mismatch}: ${description}`,
      );
      assert.equal(
        sample.fusionPaths,
        sample.paths,
        `spatial lettering preserves every pen stroke: ${description}`,
      );
      assert.ok(
        sample.fusionDistance < 0.06,
        `spatial pen endpoint moved ${sample.fusionDistance}: ${description}`,
      );
      assert.equal(sample.reversible, true, `same sought frame: ${description}`);
      assert.ok(
        Math.max(...sample.advances) - Math.min(...sample.advances) < 0.01,
        `tabular digits: ${description}`,
      );
      assert.ok(sample.minimumGap > 0.2, `neighboring numerals keep visible space: ${description}`);
    }
    for (const layout of result.layouts) {
      assert.equal(layout.lines.map((line) => line.text).join(' '), result.value);
      for (const line of layout.lines) {
        assert.equal(line.size, 26);
        assert.ok(line.width <= layout.width + 0.5);
      }
    }
    assert.deepEqual(result.layouts[0], result.layouts.at(-1));
  } finally {
    await browser?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
