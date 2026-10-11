import { openFixture } from '../support/fixture.mjs';
import { test, expect } from '@playwright/test';

test('interval inscriptions stay clear of the line at the edge and after reverse changes', async ({
  page,
}) => {
  await openFixture(page, 'scene-shell', 'plot.html');
  await page.evaluate(() => window.galleryReady);
  for (const width of [736, 390, 1040]) {
    await page.setViewportSize({ width, height: 1000 });
    const frames = await page.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const scene = (document.querySelector('.ve-scene') as any).scene;
      await scene.control([{ type: 'mode', value: 'explore' }]);
      const frames = [];
      for (const speed of [2, 1, 4, 2])
        for (const time of [10, 3, 0.1, 10]) {
          await scene.control([{ type: 'parameters', values: { speed, time, detail: true } }]);
          const measurements = [
            ...document.querySelectorAll<SVGGraphicsElement>(
              '[data-object="distance-plot:slope"] .vs-lettering',
            ),
          ];
          const labels = measurements.filter((node) =>
            node.checkVisibility({ visibilityProperty: true }),
          );
          const curve = document.querySelector<SVGPathElement>(
            '[data-object="distance-plot:speed"] [data-stroke] path',
          )!;
          const matrix = curve.getScreenCTM()!;
          const length = curve.getTotalLength();
          const gap =
            4 *
            Number(
              (document.querySelector('[data-scene-frame]') as HTMLElement).dataset.frameScale,
            );
          const collisions = labels
            .filter((label) => {
              const box = label.getBoundingClientRect();
              for (let i = 0; i <= 300; i++) {
                const p = curve.getPointAtLength((length * i) / 300).matrixTransform(matrix);
                if (
                  p.x >= box.left - gap &&
                  p.x <= box.right + gap &&
                  p.y >= box.top - gap &&
                  p.y <= box.bottom + gap
                )
                  return true;
              }
              return false;
            })
            .map((node) => node.getAttribute('aria-label'));
          frames.push({
            speed,
            time,
            distance: scene.snapshot().distance,
            collisions,
            measurements: measurements.map((node) => ({
              text: node.getAttribute('aria-label'),
              visible: node.checkVisibility({ visibilityProperty: true }),
              status: node.dataset.layoutStatus,
            })),
            overflow: [...document.querySelectorAll('[data-plot-overflow] [data-label]')].map(
              (node) => node.textContent,
            ),
            labels: labels.map((node) => ({
              text: node.getAttribute('aria-label'),
              box: node.getBoundingClientRect().toJSON(),
            })),
          });
        }
      return frames;
    });
    for (const frame of frames) {
      const interval = Math.min(3, frame.time);
      expect(frame.distance).toBeCloseTo(frame.speed * frame.time);
      expect(frame.measurements.map((label) => label.text)).toEqual([
        `${Number(interval.toFixed(1))} с`,
        `${Number((interval * frame.speed).toFixed(1))} м`,
      ]);
      for (const label of frame.measurements) {
        expect(label.status).toBe(label.visible ? 'placed' : 'overflow');
        if (!label.visible) expect(frame.overflow).toContain(label.text);
      }
      expect(frame.collisions, `${width}px: ${frame.speed}m/s at ${frame.time}s`).toEqual([]);
      for (const { box } of frame.labels) {
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(width);
      }
    }
    const first = frames[0]!,
      last = frames.at(-1)!;
    expect(last.measurements).toEqual(first.measurements);
    expect(last.overflow).toEqual(first.overflow);
    expect(last.labels.map((label) => label.text)).toEqual(first.labels.map((label) => label.text));
    // Chromium may quantize transformed glyph boxes within a fraction of a physical pixel.
    last.labels.forEach((label, index) => {
      const before = first.labels[index]!.box;
      for (const key of ['x', 'y', 'width', 'height'] as const)
        expect(Math.abs(label.box[key] - before[key])).toBeLessThan(0.1);
    });
    const crowded = frames.find((frame) => frame.measurements.some((label) => !label.visible));
    if (crowded) {
      await page.evaluate(async ({ speed, time }) => {
        const scene = (document.querySelector('.ve-scene') as any).scene;
        await scene.control([{ type: 'parameters', values: { speed, time, detail: true } }]);
      }, crowded);
      const button = page.getByRole('button', { name: /Показать неуместившиеся подписи:/ });
      await button.focus();
      await button.press('Enter');
      const panel = page.getByRole('region', {
        name: 'Подписи, для которых недостаточно места в рисунке',
      });
      await expect(panel).toBeVisible();
      for (const label of crowded.measurements.filter((label) => !label.visible))
        await expect(panel.getByText(label.text!, { exact: true })).toBeVisible();
      await panel.press('Escape');
      await expect(panel).toBeHidden();
      await expect(button).toBeFocused();
    }
  }
});

test('a single 16:9 graph preserves keyboard input, themes and rapid changes', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openFixture(page, 'scene-shell', 'plot.html');
  await page.evaluate(() => window.galleryReady);
  await page.getByRole('button', { name: 'Исследовать', exact: true }).click();
  const speed = page.getByRole('slider', { name: 'Скорость, м/с', exact: true });
  await speed.focus();
  await speed.press('End');
  await page.getByRole('slider', { name: 'Время, с', exact: true }).fill('8');
  await expect(page.locator('[data-plot-point="speed"]')).toHaveAttribute('data-value', '32');
  await page.getByRole('switch', { name: 'Вторая скорость: вдвое меньше' }).check();
  await expect(page.locator('[data-plot-point="half-speed"]')).toHaveAttribute('data-value', '16');
  const initial = await page.evaluate(() => {
    const scene = (document.querySelector('.ve-scene') as any).scene;
    return { model: scene.snapshot(), time: scene.currentTime, playing: scene.playing };
  });
  for (const width of [390, 1040])
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 850 });
      const inspection = await page.evaluate(async (theme) => {
        const scene = (document.querySelector('.ve-scene') as any).scene;
        await scene.control([{ type: 'theme', value: theme }]);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const box = document.querySelector<SVGSVGElement>('svg#distance')!.viewBox.baseVal;
        return {
          presentation: scene.presentation(),
          layout: scene.shell.layout,
          viewBox: { x: box.x, y: box.y, width: box.width, height: box.height },
          state: { model: scene.snapshot(), time: scene.currentTime, playing: scene.playing },
        };
      }, theme);
      expect(inspection.presentation.clipped).toEqual([]);
      expect(
        inspection.presentation.frame.width / inspection.presentation.frame.height,
      ).toBeCloseTo(16 / 9, 5);
      if (width >= 1040) expect(inspection.presentation.unreadableText).toEqual([]);

      expect(inspection.state).toEqual(initial);
      expect(inspection.viewBox.x).toBe(0);
      expect(inspection.viewBox.y).toBe(0);
      expect(inspection.viewBox.width).toBeCloseTo(inspection.layout.width, 3);
      expect(inspection.viewBox.height).toBeCloseTo(inspection.layout.height, 3);
      await expect(page.locator('[data-plot-point="speed"]')).toHaveAttribute('data-value', '32');
      await expect(page.locator('[data-plot-point="half-speed"]')).toHaveAttribute(
        'data-value',
        '16',
      );
      await expect(page.locator('details,.ve-explanation-notes,.ve-captions')).toHaveCount(0);
    }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const times = await page.evaluate(async () => {
    const input = document.querySelector('input[aria-label="Время, с"]') as HTMLInputElement;
    const scene = (document.querySelector('.ve-scene') as any).scene;
    const times: number[] = [];
    for (let i = 0; i < 30; i++) {
      const started = performance.now();
      input.value = String((i % 10) + 0.5);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(requestAnimationFrame);
      times.push(performance.now() - started);
    }
    return { input: times.sort((a, b) => a - b), snapshot: scene.snapshot() };
  });
  expect(times.snapshot.distance).toBe(38);
  await expect(page.locator('[data-plot-point="speed"]')).toHaveAttribute('data-value', '38');
  await testInfo.attach('input-to-frame-ms', {
    body: JSON.stringify({ p95: times.input[28], samples: times.input }),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});
