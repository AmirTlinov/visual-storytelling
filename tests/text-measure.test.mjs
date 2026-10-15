import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';

test('batched future lettering preserves exact native advances, source ink and styled tspan content', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
      import {lettering} from './dist/ink/lettering.js';
      import {measureText,measureTextVariants} from './dist/ink/text-measure.js';
      import {loadFonts} from './dist/ink/fonts.js';
      import './dist/style.css';
      window.lab={lettering,measureText,measureTextVariants,ready:loadFonts()};
    `,
    },
    bundle: true,
    write: false,
    outfile: 'lettering.js',
    loader: { '.woff2': 'dataurl' },
  });
  const browser = await chromium.launch(chromiumLaunchOptions());
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<main style="transform:scale(.34);transform-origin:0 0"><svg viewBox="0 0 1280 720" width="1280" height="720"><g id="labels" style="letter-spacing:.5px;font-weight:normal"></g></svg></main>',
    );
    await page.addStyleTag({
      content: bundle.outputFiles.find((f) => f.path.endsWith('.css')).text,
    });
    await page.addScriptTag({
      content: bundle.outputFiles.find((f) => f.path.endsWith('.js')).text,
    });
    const result = await page.evaluate(async () => {
      await lab.ready;
      const group = document.querySelector('#labels'),
        values = ['Всего: 36', 'Ещё: 0', 'Группы: 18', 'Остаток: 3', '10 測定', 'A → Б'];
      const comparisons = [];
      for (const handwriting of ['body', 'heading', 'note'])
        for (const hidden of [false, true]) {
          group.style.display = hidden ? 'none' : '';
          const label = lab.lettering(group, 'Принятая подпись', { size: 25, handwriting });
          const before = label.element.outerHTML;
          const widths = label.measureWidths(values),
            after = label.element.outerHTML;
          const probe = lab.lettering(group, '', { size: 25, handwriting });
          const expected = values.map((value) => {
            probe.text(value);
            return probe.width;
          });
          comparisons.push({ widths, expected, unchanged: before === after });
          label.dispose();
          probe.dispose();
        }
      const native = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      native.innerHTML = '<tspan font-size="12">12</tspan><tspan dx="1">м</tspan>';
      group.append(native);
      const original = native.outerHTML;
      const measured = lab.measureText(native, (copy) => ({
        children: copy.children.length,
        content: copy.innerHTML,
        width: copy.getComputedTextLength(),
      }));
      const mixed = lab.measureTextVariants(native, ['X', undefined, 'YYY'], (copy) => ({
        children: copy.children.length,
        content: copy.innerHTML,
        width: copy.getComputedTextLength(),
      }));
      try {
        lab.measureText(native, () => {
          throw Error('Probe failed');
        });
      } catch {}
      return {
        comparisons,
        measured,
        mixed,
        original: original === native.outerHTML,
        stages: document.querySelectorAll('body > svg').length,
      };
    });
    for (const row of result.comparisons) {
      assert(row.unchanged);
      assert.deepEqual(row.widths, row.expected);
    }
    assert.equal(result.measured.children, 2);
    assert.deepEqual(result.mixed[1], result.measured);
    assert(result.measured.width > 0);
    assert(result.original);
    assert.equal(result.stages, 0);
  } finally {
    await browser.close();
  }
});
