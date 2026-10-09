import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('plot and route labels share the actual SVG boundary after placement, motion and rotation', async () => {
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
    outfile: 'svg-label-boundary.js',
    loader: { '.woff2': 'dataurl' },
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent('<main class="ve-scene" style="width:600px;height:400px"></main>');
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
        id: 'boundary-proof',
        width: 600,
        height: 400,
        title: 'Граница рисунка',
        description: '',
        grid: false,
      });
      const chart = plot(sheet, 'chart', {
        x: 80,
        y: 60,
        width: 280,
        height: 200,
        xDomain: [0, 10],
        yDomain: [0, 100],
      });
      const value = chart.label('value', 'Результат', { at: [10, 70], side: 'right' });
      const poses = [
        { at: [0, 0, 0], move: [0, 0, 0] },
        { at: [150, 0, 0], move: [0, 0, 0] },
        { at: [0, 0, 0], move: [150, 0, 0] },
        { at: [135, -5, 24], move: [0, 0, 0] },
        { at: [120, 5, 15], move: [12, -4, -35] },
        { at: [0, 0, 0], move: [0, 0, 0] },
      ];
      const within = (node) => {
        const box = SvgLayout.box(node, sheet.element);
        if (
          box.x < -1e-5 ||
          box.y < -1e-5 ||
          box.x + box.width > 600.00001 ||
          box.y + box.height > 400.00001
        )
          throw new Error(`Placed ink leaves the viewport: ${JSON.stringify(box)}`);
        return box;
      };
      const labels = poses.map(({ at, move }) => {
        chart.at(...at);
        chart.move(...move);
        chart.layout();
        const node = value.element.querySelector('[data-plot-label]');
        if (node.dataset.layoutStatus !== 'placed')
          throw new Error('A short plot label should fit');
        return within(node);
      });
      const group = SvgLayout.element('g');
      const caption = SvgLayout.element('text', { 'font-size': 24 }, 'направление');
      sheet.layer.append(group);
      group.append(caption);
      const route = { start: { x: 60, y: 250 }, end: { x: 400, y: 250 } };
      const routes = poses.map(({ at, move }) => {
        group.setAttribute(
          'transform',
          `translate(${at[0]} ${at[1]}) rotate(${at[2]}) translate(${move[0]} ${move[1]}) rotate(${move[2]})`,
        );
        const result = SvgLayout.along(caption, route, { at: 0.9, offset: 24, space: group });
        if (result.status !== 'placed') throw new Error('A short route label should fit');
        return within(caption);
      });
      chart.dispose();
      sheet.dispose();
      return { labels, routes };
    });
    assert.deepEqual(
      result.labels.at(-1),
      result.labels[0],
      'chart rewind retains the same layout',
    );
    assert.deepEqual(
      result.routes.at(-1),
      result.routes[0],
      'route rewind retains the same layout',
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
