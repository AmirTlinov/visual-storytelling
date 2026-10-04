import { test, expect } from '@playwright/test';
import catalog from '../../examples/catalog.json' with { type: 'json' };

test('search, sections and the return from a scene preserve the chosen context', async ({
  page,
}) => {
  await page.goto('/');
  const search = page.getByRole('searchbox', { name: 'Найти пример' });
  await search.fill('НейРон');
  await page.getByRole('button', { name: 'Приёмы и API', exact: true }).click();
  await expect(page.locator('[data-example]:visible')).toHaveCount(1);
  await expect(page.locator('[data-example="neuron-morph"]')).toBeVisible();
  await search.fill('нет-такого-примера');
  await expect(page.locator('#empty')).toBeVisible();
  await page.getByRole('button', { name: 'Сбросить' }).click();
  await expect(search).toBeFocused();
  await expect(page.locator('[data-example]:visible')).toHaveCount(Object.keys(catalog).length);
  await search.fill('сложение');
  await page.locator('[data-example="explorer-svg"] .example-open').click();
  await expect(page).toHaveURL(/explorer-svg\/index.html/);
  await page.goBack();
  await expect(search).toHaveValue('сложение');
  await expect(page.locator('[data-example="explorer-svg"]')).toBeVisible();
  await expect(page.locator('[data-example="computer-explorer"]')).toBeHidden();
});

test('a card exposes copyable creation commands and the real source', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/?q=explorer-svg');
  const card = page.locator('[data-example="explorer-svg"]');
  await card.locator('summary').click();
  const commands = await card.locator('textarea').inputValue();
  await card.getByRole('button', { name: 'Копировать команды' }).click();
  await expect(card.getByRole('button', { name: 'Скопировано' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(commands);
  expect(commands).toContain('--example explorer-svg');
  const source = await page.request.get(
    await card.getByRole('link', { name: /Исходник/ }).getAttribute('href'),
  );
  expect(source.ok()).toBe(true);
  expect(await source.text()).toContain('SceneShell');
});

test('narrow dark gallery remains readable and keyboard controls filter immediately', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  const search = page.getByRole('searchbox', { name: 'Найти пример' });
  await search.focus();
  await search.pressSequentially('3d');
  const filter = page.getByRole('button', { name: 'Приёмы и API', exact: true });
  await filter.focus();
  await page.keyboard.press('Enter');
  await expect(filter).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-example="physical-objects"]')).toBeVisible();
  await expect(page.locator('[data-example="explorer-3d"]')).toBeHidden();
  await page.locator('[data-example="physical-objects"] summary').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(filter).toHaveAttribute('aria-pressed', 'true');
});
