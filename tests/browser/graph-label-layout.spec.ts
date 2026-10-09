import { test, expect } from '@playwright/test';
import { build } from 'esbuild';

test('graph labels retain the axes, readable values and matching hitboxes across the experiment', async ({
  page,
}) => {
  await page.goto('/graph-lab/index.html');
  await page.evaluate(() => (window as any).galleryReady);
  for (const width of [1312, 390])
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 900 });
      const failures = await page.evaluate(async (theme) => {
        const scene = (document.querySelector('.ve-scene') as any).scene;
        await scene.control([
          { type: 'theme', value: theme },
          { type: 'mode', value: 'explore' },
        ]);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const failures = [];
        for (const speed of [1, 2, 4])
          for (const time of [0, 0.1, 3, 8, 10])
            for (const compare of [false, true])
              for (const detail of [false, true]) {
                await scene.control([
                  { type: 'parameters', values: { speed, time, compare, detail, practice: false } },
                ]);
                const state = { speed, time, compare, detail };
                const labels = [
                  ...document.querySelectorAll<SVGGraphicsElement>('[data-plot-label]'),
                ]
                  .filter((node) =>
                    node.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
                  )
                  .map((node) => ({
                    id: node.dataset.plotLabel,
                    text: node.getAttribute('aria-label'),
                    box: node.getBoundingClientRect(),
                  }));
                for (const [id, count] of Object.entries({
                  'x-tick': 6,
                  'y-tick': 4,
                  'x-title': 1,
                  'y-title': 1,
                  'distance-value': 1,
                  'comparison-value': compare ? 1 : 0,
                }))
                  if (labels.filter((label) => label.id === id).length !== count)
                    failures.push({ state, missing: id });
                for (let i = 0; i < labels.length; i++)
                  for (let j = i + 1; j < labels.length; j++) {
                    const a = labels[i]!,
                      b = labels[j]!;
                    if (
                      Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left) >
                        0.01 &&
                      Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top) > 0.01
                    )
                      failures.push({ state, overlap: [a.id, a.text, b.id, b.text] });
                  }
                const value = labels.find((label) => label.id === 'distance-value')!;
                const hit = document.elementFromPoint(
                  value.box.x + value.box.width / 2,
                  value.box.y + value.box.height / 2,
                );
                if (hit?.getAttribute('aria-label') !== 'Измерить наклон у точки')
                  failures.push({ state, hit: hit?.getAttribute('aria-label') });
                const overflow = scene.presentation().layoutOverflow;
                if (overflow.length) failures.push({ state, overflow });
              }
        return failures;
      }, theme);
      expect(failures, `${width}px, ${theme}`).toEqual([]);
    }
});

test('a narrow plot separates a long axis title and large ticks, and exposes crowded labels by keyboard and pointer', async ({
  page,
}) => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
        import { surface } from './dist/ink/index.js';
        import { plot } from './dist/recipes/index.js';
        import { loadFonts } from './dist/ink/fonts.js';
        import './dist/style.css';
        window.plotFixture = { surface, plot, ready: loadFonts() };`,
    },
    bundle: true,
    format: 'iife',
    outfile: 'plot-fixture.js',
    write: false,
    loader: { '.woff2': 'dataurl' },
  });
  await page.setViewportSize({ width: 600, height: 600 });
  await page.setContent(
    '<!doctype html><main class="ve-scene" style="width:440px;height:400px"></main>',
  );
  await page.addStyleTag({
    content: bundle.outputFiles.find((file) => file.path.endsWith('.css'))!.text,
  });
  await page.addScriptTag({
    content: bundle.outputFiles.find((file) => file.path.endsWith('.js'))!.text,
  });
  const ordinary = await page.evaluate(async () => {
    const fixture = (window as any).plotFixture;
    await fixture.ready;
    const view = fixture.surface(document.querySelector('main'), {
      id: 'compact-plot',
      width: 440,
      height: 400,
      title: 'Измерение пути',
      description: '',
      grid: false,
    });
    const chart = fixture.plot(view, 'compact', {
      x: 100,
      y: 70,
      width: 280,
      height: 150,
      xDomain: [0, 10],
      yDomain: [0, 100],
      xTicks: [0, 5, 10].map((value) => ({ value, label: String(value) })),
      yTicks: [0, 100].map((value) => ({ value, label: String(value) })),
      tickSize: 38,
      labelSize: 28,
      xLabel: 'Время наблюдения, секунды',
      yLabel: 'Путь, м',
    });
    fixture.chart = chart;
    const title = document.querySelector<SVGGraphicsElement>('[data-plot-label="x-title"]')!;
    const end = [
      ...document.querySelectorAll<SVGGraphicsElement>('[data-plot-label="x-tick"]'),
    ].find((node) => node.getAttribute('aria-label') === '10')!;
    return {
      overflow: [...document.querySelectorAll('[data-layout-status="overflow"]')].map((node) =>
        node.getAttribute('aria-label'),
      ),
      title: title.getBoundingClientRect().toJSON(),
      end: end.getBoundingClientRect().toJSON(),
    };
  });
  expect(ordinary.overflow).toEqual([]);
  expect(ordinary.title.top).toBeGreaterThan(ordinary.end.bottom);
  await page.evaluate(() => {
    const fixture = (window as any).plotFixture;
    fixture.crowded = fixture.chart.label(
      'crowded',
      'Подробное сравнение расстояний при одинаковом времени наблюдения',
      { at: [5, 50], size: 28 },
    );
    fixture.chart.layout();
  });
  const button = page.getByRole('button', { name: /Показать неуместившиеся подписи:/ });
  await expect(button).toBeVisible();
  await button.focus();
  await button.press('Enter');
  const panel = page.getByRole('region', {
    name: 'Подписи, для которых недостаточно места в рисунке',
  });
  await expect(panel).toBeVisible();
  await expect(panel).toBeFocused();
  await expect(panel).toContainText(
    'Подробное сравнение расстояний при одинаковом времени наблюдения',
  );
  expect(
    await panel.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return node.contains(
        document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
      );
    }),
  ).toBe(true);
  await panel.press('Escape');
  await expect(panel).toBeHidden();
  await expect(button).toBeFocused();
  await page.evaluate(() => {
    const fixture = (window as any).plotFixture;
    fixture.crowded.text('Пройденный путь');
    fixture.chart.layout();
  });
  await expect(button).toBeHidden();
});
