import { test, expect } from '@playwright/test';

test('drawn register writes only at an enabled edge and keeps prediction before reveal', async ({
  page,
}) => {
  await page.goto('/memory-register/index.html');
  await page.evaluate(() => (window as any).galleryReady);
  const input = page.locator('#input-value'),
    saved = page.locator('#saved-value');
  await page.locator('[data-value="42"]').click();
  await expect(input).toHaveText('42');
  await page.locator('#clock').click();
  await expect(saved).toHaveText('0');
  await page.locator('#clock').click();
  await page.locator('#enable').click();
  await page.locator('#clock').click();
  await expect(saved).toHaveText('42');
  await page.locator('[data-value="165"]').click();
  await expect(saved).toHaveText('42');
  await page.locator('#clock').click();
  await expect(saved).toHaveText('42');
  await page.locator('#clock').click();
  await expect(saved).toHaveText('165');
  await page.locator('#challenge-start').click();
  await expect(page.locator('#verify')).toBeDisabled();
  await page.locator('[data-bit="7"]').click({ force: true });
  await expect(input).toHaveText('165');
  await page.locator('[data-guess="165"]').click();
  await page.locator('#verify').click();
  await expect(saved).toHaveText('42');
  await expect(page.locator('#feedback')).toContainText('Получилось 42');
  await page.locator('#next-challenge').click();
  await page.locator('[data-guess="165"]').click();
  await page.locator('#verify').click();
  await expect(saved).toHaveText('165');
  await expect(page.locator('#feedback')).toContainText('Верно');
});

test('narrow notebook keeps drawn targets apart and keyboard activation changes one bit', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 1000 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/memory-register/index.html');
  await page.evaluate(() => (window as any).galleryReady);
  const bit = page.locator('[data-bit="7"]');
  await bit.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#input-value')).toHaveText('128');
  for (let i = 0; i < 10; i++) await bit.click();
  await expect(page.locator('#input-value')).toHaveText('128');
  const layout = await page.evaluate(() => {
    const rectangles = [...document.querySelectorAll('[data-bit]')].map((node) =>
      node.getBoundingClientRect(),
    );
    return {
      separated: rectangles.every((r, i) => !i || rectangles[i - 1]!.right < r.left),
      fits: document.documentElement.scrollWidth <= innerWidth,
      focusable: document.querySelector('[data-bit="7"]')!.getAttribute('tabindex'),
      grid: document.querySelectorAll('#memory-register > .vs-grid > path').length,
    };
  });
  expect(layout).toEqual({ separated: true, fits: true, focusable: '0', grid: 1 });
  await page.locator('[data-select="7"]').click();
  await expect(page.locator('#inside')).toHaveAttribute('open', '');
  await expect(page.locator('#detail-bit')).toContainText('Бит 7');
  expect(errors).toEqual([]);
});
