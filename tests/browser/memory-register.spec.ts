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
  await expect(page.locator('#enable')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('#clock').getAttribute('aria-pressed')).toBeNull();
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
  expect(layout).toEqual({ separated: true, fits: true, focusable: '0', grid: 0 });
  await page.locator('[data-select="7"]').click();
  await expect(page.locator('#inside')).toHaveAttribute('open', '');
  await expect(page.locator('#detail-bit')).toContainText('Бит 7');
  await page.locator('[data-mode="story"]').click();
  await page.locator('[data-seek]').fill('8');
  await expect(page.locator('[data-caption]')).not.toBeEmpty();
  for (const width of [375, 960]) {
    await page.setViewportSize({ width, height: 1000 });
    const sheet = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('#ve-scene')!;
      const stage = root.querySelector('.ve-stage')!;
      const caption = root.querySelector('[data-caption]')!;
      const player = root.querySelector('[data-player]')!;
      const bounds = root.getBoundingClientRect();
      return {
        grid: getComputedStyle(root).backgroundImage.includes('linear-gradient'),
        inside: [root.querySelector('h1')!, stage, caption, player].every((element) => {
          const rect = element.getBoundingClientRect();
          return (
            rect.left >= bounds.left && rect.right <= bounds.right && rect.bottom <= bounds.bottom
          );
        }),
        notesInStage: stage.contains(root.querySelector('.memory-notes')),
        captionBelow: caption.getBoundingClientRect().top >= stage.getBoundingClientRect().bottom,
        playerBelow: player.getBoundingClientRect().top >= caption.getBoundingClientRect().bottom,
        fits: document.documentElement.scrollWidth <= innerWidth,
      };
    });
    expect(sheet).toEqual({
      grid: true,
      inside: true,
      notesInStage: true,
      captionBelow: true,
      playerBelow: true,
      fits: true,
    });
  }
  expect(errors).toEqual([]);
});
