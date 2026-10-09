import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('plots share surface ink, independent of update order, and release overflow with their surface', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
        import { surface } from './src/ink/surface.ts';
        import { loadFonts } from './src/ink/fonts.ts';
        import { plot } from './src/recipes/plot.ts';
        import { SvgLayout } from './src/layout/svg.ts';
        import './src/style.css';
        window.Kit = { surface, plot, SvgLayout, ready: loadFonts() };`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    outfile: 'plot-surface-labels.js',
    loader: { '.woff2': 'dataurl' },
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent('<main class="ve-scene" style="width:900px;height:400px"></main>');
    await page.addStyleTag({
      content: bundle.outputFiles.find((file) => file.path.endsWith('.css')).text,
    });
    await page.addScriptTag({
      content: bundle.outputFiles.find((file) => file.path.endsWith('.js')).text,
    });
    const result = await page.evaluate(async () => {
      const { surface, plot, SvgLayout } = Kit;
      await Kit.ready;
      const sheet = surface(document.querySelector('main'), {
        id: 'shared-paper',
        width: 900,
        height: 400,
        title: 'Два измерения',
        description: '',
        grid: false,
      });
      const options = { y: 80, width: 320, height: 250, xDomain: [0, 10], yDomain: [0, 100] };
      const first = plot(sheet, 'first', { ...options, x: 30 });
      const value = first.label('value', 'Измеренный путь', { at: [10, 50], side: 'right' });
      const valueNode = value.element.querySelector('[data-plot-label]');
      const box = (node) => SvgLayout.box(node, sheet.element);
      first.layout();
      const alone = box(valueNode);
      const second = plot(sheet, 'second', {
        ...options,
        x: 470,
        yTicks: [
          { value: 0, label: '0' },
          { value: 50, label: '50' },
          { value: 100, label: '100' },
        ],
        xLabel: 't',
        yLabel: 's',
      });
      const other = second.label('other', 'Другое измерение', { at: [0, 50], side: 'left' });
      // A label is checked in its local ink coordinates against each neighboring axis,
      // so rotation cannot be mistaken for a rectangular obstacle in the wrong space.
      function checkAxes(node, chart, x) {
        const local = node.getBBox();
        const matrix = node.getCTM().inverse().multiply(chart.content.getCTM());
        const map = ([x, y]) => new DOMPoint(x, y).matrixTransform(matrix);
        const crosses = ([a, b]) => {
          let lo = 0,
            hi = 1;
          for (const [key, min, max] of [
            ['x', local.x - 2, local.x + local.width + 2],
            ['y', local.y - 2, local.y + local.height + 2],
          ]) {
            const delta = b[key] - a[key];
            if (!delta) {
              if (a[key] < min || a[key] > max) return false;
            } else {
              const ends = [(min - a[key]) / delta, (max - a[key]) / delta];
              lo = Math.max(lo, Math.min(...ends));
              hi = Math.min(hi, Math.max(...ends));
              if (lo > hi) return false;
            }
          }
          return true;
        };
        for (const segment of [
          [
            [x, 330],
            [x, 73],
          ],
          [
            [x, 330],
            [x + 327, 330],
          ],
        ])
          if (crosses(segment.map(map)))
            throw new Error('A neighboring axis crosses visible lettering');
      }
      function snapshot() {
        const nodes = [...sheet.element.querySelectorAll('[data-plot-label]')].filter(
          (node) =>
            node.dataset.layoutStatus === 'placed' &&
            getComputedStyle(node).visibility !== 'hidden',
        );
        return nodes.map((node) => ({ text: node.getAttribute('aria-label'), ...box(node) }));
      }
      function check() {
        const labels = snapshot();
        for (let i = 0; i < labels.length; i++) {
          const a = labels[i];
          if (a.x < -1e-5 || a.y < -1e-5 || a.x + a.width > 900.00001 || a.y + a.height > 400.00001)
            throw new Error('A placed label leaves its surface');
          for (const b of labels.slice(i + 1))
            if (
              a.x < b.x + b.width &&
              b.x < a.x + a.width &&
              a.y < b.y + b.height &&
              b.y < a.y + a.height
            )
              throw new Error(`Visible labels overlap: ${a.text} / ${b.text}`);
        }
        checkAxes(valueNode, second, 470);
        checkAxes(other.element.querySelector('[data-plot-label]'), first, 30);
        return labels;
      }
      first.layout();
      second.layout();
      const forward = check();
      second.layout();
      first.layout();
      const reverse = check();
      value.at(9, 82);
      other.text('Длинное русское измерение');
      second.layout();
      first.layout();
      check();
      value.at(10, 50);
      other.text('Другое измерение');
      first.layout();
      const rewind = check();
      second.at(-45, 15, -12);
      first.move(15, -2, 3);
      first.layout();
      checkAxes(valueNode, second, 470);
      checkAxes(other.element.querySelector('[data-plot-label]'), first, 30);
      second.at(0, 0);
      first.move(0, 0);
      second.layout();
      const restored = check();
      value.pigment('red');
      first.layout();
      const leader = first.element.querySelector('[data-plot-leaders] path');
      const colors = [getComputedStyle(leader).color, getComputedStyle(valueNode).color];
      second.show(false);
      first.layout();
      const hidden = box(valueNode);
      second.show(true);
      first.layout();
      const shownAgain = check();
      second.dispose();
      first.layout();
      const disposed = box(valueNode);
      // The Surface owns global listeners even if the chart is not disposed first.
      const listeners = [];
      const add = window.addEventListener;
      window.addEventListener = function (type, fn, options) {
        if (['resize', 'scroll'].includes(type) && options?.signal) listeners.push(options.signal);
        return add.call(this, type, fn, options);
      };
      value.text('Подробное измерение '.repeat(40));
      first.layout();
      const control = sheet.element.querySelector('.ve-label-overflow');
      const hasOverflow = !!control && !control.hidden;
      window.addEventListener = add;
      sheet.dispose();
      const released =
        listeners.length === 2 &&
        listeners.every((signal) => signal.aborted) &&
        !control.isConnected;
      first.dispose();
      sheet.dispose();
      window.dispatchEvent(new Event('resize'));
      return {
        alone,
        forward,
        reverse,
        rewind,
        restored,
        hidden,
        shownAgain,
        disposed,
        colors,
        hasOverflow,
        released,
      };
    });
    assert.ok(
      result.alone.x < 470 && result.alone.x + result.alone.width > 470,
      'the isolated preferred position reproduces the crossing',
    );
    for (const key of ['reverse', 'rewind', 'restored', 'shownAgain'])
      assert.deepEqual(result[key], result.forward, `${key} resolves from authored state`);
    assert.deepEqual(result.hidden, result.alone, 'a hidden plot reserves no geometry or labels');
    assert.deepEqual(result.disposed, result.alone, 'a disposed plot releases its registry');
    assert.equal(result.colors[0], result.colors[1], 'the connection follows the current pigment');
    assert.equal(result.hasOverflow, true);
    assert.equal(result.released, true, 'Surface.dispose releases controls and window listeners');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
