import { test, expect } from '@playwright/test';

test('one exemplar opens directly and its source remains available', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-example]')).toHaveCount(1);
  await expect(page.getByRole('searchbox')).toHaveCount(0);
  await expect(page.locator('.gallery-filters')).toHaveCount(0);
  const source = await page.request.get(
    await page.getByRole('link', { name: /Исходник/ }).getAttribute('href'),
  );
  expect(source.ok()).toBe(true);
  expect(await source.text()).toContain('SceneShell');
  await page.getByRole('link', { name: 'Исследовать объяснение', exact: true }).click();
  await expect(page).toHaveURL(/gpt-model\/index.html/);
  await page.goBack();
  await expect(page.locator('[data-example="gpt-model"]')).toBeVisible();
});

test('clean project and explicit exemplar have distinct copyable commands', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  for (const [summary, exemplar] of [
    ['Создать своё объяснение', false],
    ['Изменить этот разбор', true],
  ]) {
    const detail = page
      .locator('details')
      .filter({ has: page.locator('summary', { hasText: summary }) });
    await detail.locator('summary').click();
    const commands = await detail.locator('textarea').inputValue();
    expect(commands.includes('--example gpt-model')).toBe(exemplar);
    await detail.getByRole('button', { name: 'Копировать команды' }).click();
    await expect(detail.getByRole('button', { name: 'Скопировано' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(commands);
  }
});

test('narrow dark catalog preserves readable text, keyboard access and bounded layout', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  const detail = page.locator('details').first();
  await detail.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(detail).toHaveAttribute('open', '');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const target = await detail.getByRole('button').boundingBox();
  expect(target.height).toBeGreaterThanOrEqual(44);
});
