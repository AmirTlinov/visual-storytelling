import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildScene } from '../../tools/build-pages.mjs';

const target = resolve('artifacts/tests/counter-input');
test.beforeAll(async () => {
  await buildScene(resolve('tools/document-modules/counter'), target, {
    sourcePackage: true,
    silent: true,
  });
});
test('the in-frame counter retains keyboard focus through repeated edits and its bounds', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(pathToFileURL(resolve(target, 'index.html')).href);
  await page.evaluate(() => window.galleryReady);
  const set = (count: number) =>
    page.evaluate(async (count) => {
      await document
        .querySelector<HTMLElement>('main')!
        .scene!.control([{ type: 'parameters', values: { count } }]);
    }, count);
  const count = () =>
    page.evaluate(
      () =>
        (document.querySelector<HTMLElement>('main')!.scene!.snapshot() as { count: number }).count,
    );
  await set(7);
  const add = page.locator('[data-action="add"]');
  await add.focus();
  await page.keyboard.press('Enter');
  await expect.poll(count).toBe(8);
  await expect(add).toBeFocused();
  await page.keyboard.press('Space');
  await expect.poll(count).toBe(9);
  await expect(add).toBeFocused();
  await set(98);
  await add.focus();
  await page.keyboard.press('Enter');
  await expect.poll(count).toBe(99);
  const subtract = page.locator('[data-action="subtract"]');
  await expect(subtract).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(count).toBe(98);
  await expect(subtract).toBeFocused();
  await expect(page.locator('.ve-parameters')).toBeHidden();
});
