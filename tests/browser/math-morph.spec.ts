import { test, expect } from '@playwright/test';
import sharp from 'sharp';

test('a hidden 2D view starts safely and shows the latest sought operation when opened', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/math-morph/index.html');
  await page.evaluate(() => window.galleryReady);
  const flat = page.locator('.math-flat');
  await expect(flat).toBeHidden();
  await page.locator('[data-seek]').fill('26');
  await page.getByRole('radio', { name: 'Плоскость', exact: true }).check();
  await expect(flat).toBeVisible();
  await expect(flat.locator('.vs-lettering[aria-label="6 ÷ 3 = 2"]')).toBeVisible();
  await expect(flat.locator('svg > desc')).toHaveText('2, 2, 2');
  // The visible inscription now belongs to the clipped GPU material.
  const { data, info } = await sharp(await flat.locator('[data-morph-ink] canvas').screenshot())
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let ink = 0;
  for (let i = 0; i < data.length; i += info.channels)
    if (data[i]! < 100 && data[i + 1]! < 100 && data[i + 2]! < 100 && data[i + 3]! > 160) ink++;
  expect(ink).toBeGreaterThan(80);
  expect(errors).toEqual([]);
});

test('the largest authored power remains a visible measured area after changing inputs', async ({
  page,
}) => {
  await page.goto('/math-morph/index.html');
  await page.evaluate(() => window.galleryReady);
  await page.locator('[data-mode=explore]').click();
  await expect(page.locator('[data-caption]')).toBeHidden();
  await page.getByRole('radio', { name: 'Степень', exact: true }).check();
  await page.getByRole('slider', { name: 'Первое число', exact: true }).fill('6');
  await page.getByRole('slider', { name: 'Второе число', exact: true }).fill('4');
  await page.getByRole('slider', { name: 'Переход', exact: true }).fill('1');
  await expect(page.locator('.math-volume')).toContainText('6^4 = 1296');
  // Read displayed pixels: a formula alone cannot satisfy this visible-area regression.
  const { data, info } = await sharp(await page.locator('.math-volume canvas').screenshot())
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let area = 0,
    top = info.height,
    bottom = 0;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      if (data[i + 2]! - data[i]! > 20 && data[i + 1]! > data[i]!) {
        area++;
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  expect(area).toBeGreaterThan(2000);
  expect(bottom - top).toBeGreaterThan(70);
});
