import { test, expect } from '@playwright/test';

test('reading enlarges the same 16:9 scene and keeps its model, focus and controls', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  for (const example of ['graph-lab', 'connected-diagram', 'area-lesson'])
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await page.goto(`/${example}/index.html`);
      await page.evaluate(() => window.galleryReady);
      const capture = () =>
        page.evaluate(() => document.querySelector<HTMLElement>('.ve-scene')!.scene!.capture());
      const before = await capture();
      const enlarge = page.getByRole('button', { name: 'Читать крупнее', exact: true });
      await enlarge.focus();
      await enlarge.press('Enter');
      const viewport = page.getByRole('region', {
        name: 'Увеличенный рисунок. Прокрутка к деталям.',
      });
      await expect(viewport).toBeFocused();
      const reading = await page.evaluate(() =>
        document.querySelector<HTMLElement>('.ve-scene')!.scene!.presentation(),
      );
      expect(reading.viewing?.mode).toBe('reading');
      expect(reading.frame.width / reading.frame.height).toBeCloseTo(16 / 9, 5);
      expect(reading.viewing!.aperture.width / reading.viewing!.aperture.height).toBeCloseTo(
        16 / 9,
        5,
      );
      expect(reading.unreadableText, `${example}, ${colorScheme}: actual reading size`).toEqual([]);
      if (example === 'graph-lab') {
        const point = await page
          .locator('[data-object="distance-plot:distance-value"] .vs-lettering')
          .boundingBox();
        const aperture = reading.viewing!.aperture;
        expect(point!.x).toBeGreaterThanOrEqual(aperture.x);
        expect(point!.x + point!.width).toBeLessThanOrEqual(aperture.x + aperture.width);
      }
      expect(await capture()).toEqual(before);
      const from = await viewport.evaluate((element) => element.scrollLeft);
      await viewport.press('ArrowRight');
      await expect
        .poll(() => viewport.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(from);
      await viewport.press('Escape');
      await expect(enlarge).toBeFocused();
      expect(await capture()).toEqual(before);
      const overview = await page.evaluate(() =>
        document.querySelector<HTMLElement>('.ve-scene')!.scene!.presentation(),
      );
      expect(overview.viewing).toBeUndefined();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        390,
      );
    }
  await page.goto('/graph-lab/index.html');
  await page.evaluate(() => window.galleryReady);
  await page.getByRole('button', { name: 'Читать крупнее', exact: true }).click();
  await page.getByRole('button', { name: 'Исследовать', exact: true }).click();
  const speed = page.getByRole('slider', { name: 'Скорость, м/с', exact: true });
  await speed.focus();
  await speed.press('End');
  await expect(speed).toHaveValue('4');
  await expect(page.locator('[data-plot-point="speed"]')).toHaveAttribute('data-value', '16');
  const bounds = await speed.boundingBox();
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { name: 'Весь кадр', exact: true }).click();
  await expect(speed).toHaveValue('4');
  expect(errors).toEqual([]);
});
