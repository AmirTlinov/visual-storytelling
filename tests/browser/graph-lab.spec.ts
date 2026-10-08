import { test, expect } from '@playwright/test';

test('graph keeps coordinates, keyboard input and rapid updates readable', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 850 });
  await page.goto('/graph-lab/index.html');
  await page.evaluate(() => window.galleryReady);
  await page.getByRole('button', { name: 'Исследовать', exact: true }).click();
  const speed = page.getByRole('slider', { name: 'Скорость, м/с', exact: true });
  await speed.focus();
  await speed.press('End');
  await page.getByRole('slider', { name: 'Время, с', exact: true }).fill('8');
  await expect(page.locator('[data-graph-reading]')).toHaveText('8 с × 4 м/с = 32 м.');
  await expect(page.locator('[data-plot-point="speed"]')).toHaveAttribute('data-value', '32');
  await page.getByRole('switch', { name: 'Сравнить с половиной скорости' }).check();
  await expect(page.locator('[data-plot-point="half-speed"]')).toHaveAttribute('data-value', '16');
  for (const width of [390, 1000])
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 850 });
      const inspection = await page.evaluate(async (theme) => {
        const scene = (document.querySelector('.ve-scene') as any).scene;
        await scene.control([{ type: 'theme', value: theme }]);
        await new Promise(requestAnimationFrame);
        return scene.presentation();
      }, theme);
      expect(inspection.clipped).toEqual([]);
      expect(inspection.unreadableText).toEqual([]);
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
