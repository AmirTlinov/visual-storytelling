import { test, expect } from '@playwright/test';
import { openFixture } from '../support/fixture.mjs';

test('rapid input survives reversed host echoes, external restore is silent and disposal releases listeners', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openFixture(page, 'scene-shell', 'persist.html');
  await page.evaluate(() => {
    window.receipts = [];
    const snapshots = new Map(),
      listeners = new Map();
    window.receiveWidget = (id, snapshot) => {
      for (const listener of listeners.get(id) ?? []) listener(snapshot);
    };
    window.widgetListeners = () => [...listeners.values()].reduce((n, set) => n + set.size, 0);
    document.querySelector('.ve-scene').scene.connectHost({
      widgetState: {
        read: (id) => snapshots.get(id),
        save(id, snapshot) {
          snapshots.set(id, snapshot);
          window.receipts.push({ id, snapshot });
        },
        subscribe(id, listener) {
          const subscribers = listeners.get(id) ?? new Set();
          listeners.set(id, subscribers);
          subscribers.add(listener);
          return () => subscribers.delete(listener);
        },
      },
    });
  });
  expect(await page.evaluate(() => window.receipts.length)).toBe(0);
  await page.locator('[data-mode=explore]').click();
  const field = page.getByRole('slider', { name: 'По горизонтали' });
  await field.fill('-1');
  await field.fill('-2');
  const count = await page.evaluate(() => window.receipts.length);
  expect(count).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => {
    for (const { id, snapshot } of [...window.receipts].reverse())
      window.receiveWidget(id, snapshot);
  });
  await expect(field).toHaveValue('-2');
  const checkpoint = await page.evaluate(() => ({
    ...document.querySelector('.ve-scene').scene.capture(),
    values: { x: 1, y: -1 },
  }));
  const restore = (privateContent) => window.receiveWidget('shell-regression', { privateContent });
  await page.evaluate(restore, checkpoint);
  await expect(field).toHaveValue('1');
  expect(await page.evaluate(() => window.receipts.length)).toBe(count);
  await page.evaluate(() => document.querySelector('.ve-scene').scene.dispose());
  expect(await page.evaluate(() => window.widgetListeners())).toBe(0);
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
