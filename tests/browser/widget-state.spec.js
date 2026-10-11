import { test, expect } from '@playwright/test';
import { openFixture } from '../support/fixture.mjs';

test('rapid input survives reversed host echoes, external restore is silent and disposal releases listeners', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.receipts = [];
    window.openai = { setWidgetState: (snapshot) => window.receipts.push(snapshot) };
  });
  await openFixture(page, 'scene-shell', 'persist.html');
  expect(await page.evaluate(() => window.receipts.length)).toBe(0);
  await page.locator('[data-mode=explore]').click();
  const field = page.getByRole('slider', { name: 'По горизонтали' });
  await field.fill('-1');
  await field.fill('-2');
  const count = await page.evaluate(() => window.receipts.length);
  expect(count).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => {
    for (const widgetState of [...window.receipts].reverse())
      window.dispatchEvent(
        new CustomEvent('openai:set_globals', { detail: { globals: { widgetState } } }),
      );
  });
  await expect(field).toHaveValue('-2');
  const checkpoint = await page.evaluate(() => ({
    ...document.querySelector('.ve-scene').scene.capture(),
    values: { x: 1, y: -1 },
  }));
  const restore = (privateContent) =>
    window.dispatchEvent(
      new CustomEvent('openai:set_globals', {
        detail: { globals: { widgetState: { privateContent } } },
      }),
    );
  await page.evaluate(restore, checkpoint);
  await expect(field).toHaveValue('1');
  expect(await page.evaluate(() => window.receipts.length)).toBe(count);
  await page.evaluate(() => document.querySelector('.ve-scene').scene.dispose());
  await page.evaluate(restore, checkpoint);
  await page.setViewportSize({ width: 500, height: 800 });
  await expect(page.locator('.ve-scene')).toBeEmpty();
  expect(errors).toEqual([]);
});

test('offline reload restores the same condition and camera through the shared bridge', async ({
  page,
}) => {
  await openFixture(page, 'scene-shell', 'persist.html');
  await page.locator('[data-mode=explore]').click();
  await page.locator('#shell-subject').focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('slider', { name: 'По горизонтали' }).fill('-2');
  await page.getByRole('slider', { name: 'По вертикали' }).fill('1');
  const before = await page.evaluate(() => document.querySelector('.ve-scene').scene.capture());
  await page.reload();
  await page.evaluate(() => window.galleryReady);
  await expect(page.getByRole('slider', { name: 'По горизонтали' })).toHaveValue('-2');
  expect(await page.evaluate(() => document.querySelector('.ve-scene').scene.capture())).toEqual(
    before,
  );
});
