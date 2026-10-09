import { test, expect, type Page } from '@playwright/test';

const snapshot = (page: Page) =>
  page.evaluate(() => (document.querySelector('.ve-scene') as any).scene.snapshot());
const settle = (page: Page) =>
  page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });

test('recurrent chain keeps its drawing through details, rearrangement and reverse seek', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1120, height: 900 });
  await page.goto('/connected-diagram/index.html');
  await page.evaluate(() => window.galleryReady);
  await settle(page);
  const initial = await snapshot(page);
  expect(initial.layout).toBe('row');
  expect(initial.routes).toHaveLength(4);
  expect(initial.routes.every((route: unknown[]) => route.length >= 2)).toBe(true);
  await expect(page.locator('[data-sequence-reading]')).toHaveText('Читаем «кот».');
  await page.getByRole('button', { name: 'Исследовать', exact: true }).click();
  const time = page.getByRole('slider', { name: 'Момент', exact: true });
  await time.fill('10.5');
  await settle(page);
  const playing = await snapshot(page);
  expect(playing.signal.visible).toBe(true);
  expect(playing.output).toEqual(['the', 'cat']);
  const canvas = page.locator('.ve-explanation-figure canvas');
  const before = await canvas.boundingBox();
  const summary = page.locator('.ve-disclosure summary');
  await summary.focus();
  await summary.press('Enter');
  await expect(page.locator('.ve-disclosure')).toHaveAttribute('open', '');
  await settle(page);
  expect(await canvas.boundingBox()).toEqual(before);
  const expanded = await snapshot(page);
  expect(expanded.routes).toEqual(playing.routes);
  expect(expanded.camera).toEqual(playing.camera);
  await summary.press('Enter');
  await expect(page.locator('.ve-disclosure')).not.toHaveAttribute('open', '');
  const column = page.getByRole('switch', { name: 'Расположить в столбик', exact: true });
  await expect(column).toBeEnabled();
  await column.check();
  await settle(page);
  expect((await snapshot(page)).layout).toBe('column');
  await column.uncheck();
  await settle(page);
  expect((await snapshot(page)).routes).toEqual(playing.routes);
  const timings = await page.evaluate(async () => {
    const control = document.querySelector('input[aria-label="Момент"]') as HTMLInputElement;
    const times: number[] = [];
    for (const value of [0, 1.2, 6.8, 13.4, 10.5, 0, 6.5, 3.8, 12.2, 10.5]) {
      const start = performance.now();
      control.value = String(value);
      control.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(requestAnimationFrame);
      times.push(performance.now() - start);
    }
    return times;
  });
  await settle(page);
  const restored = await snapshot(page);
  expect(restored.routes).toEqual(playing.routes);
  expect(restored.signal).toEqual(playing.signal);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await time.fill('10.6');
  await time.fill('10.5');
  await settle(page);
  const reduced = await snapshot(page);
  expect(reduced.reduced).toBe(true);
  expect(reduced.signal.visible).toBe(false);
  expect(reduced.output).toEqual(playing.output);
  await testInfo.attach('input-to-frame-ms', {
    body: JSON.stringify(timings),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});

test('recurrent diagram stays readable on a narrow sheet in both themes', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/connected-diagram/index.html');
  await page.evaluate(() => window.galleryReady);
  await page.getByRole('button', { name: 'Исследовать', exact: true }).click();
  await expect(
    page.getByRole('switch', { name: 'Расположить в столбик', exact: true }),
  ).toBeDisabled();
  expect((await snapshot(page)).layout).toBe('column');
  const time = page.getByRole('slider', { name: 'Момент', exact: true });
  await time.focus();
  await time.press('End');
  await expect(page.locator('[data-sequence-reading]')).toHaveText('the cat is on the roof');
  await time.press('Home');
  await expect(page.locator('[data-sequence-reading]')).toHaveText('Читаем «кот».');
  const state = page.locator('button[data-object="recurrent-state"]');
  await state.focus();
  await state.press('Enter');
  await expect(page.locator('.ve-disclosure')).toHaveAttribute('open', '');
  for (const theme of ['light', 'dark']) {
    const presentation = await page.evaluate(async (theme) => {
      const scene = (document.querySelector('.ve-scene') as any).scene;
      await scene.control([{ type: 'theme', value: theme }]);
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      return {
        ...scene.presentation(),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    }, theme);
    expect(presentation.clipped).toEqual([]);
    expect(presentation.unreadableText).toEqual([]);
    expect(presentation.overflow).toBe(false);
    await testInfo.attach(`narrow-${theme}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  }
  expect(errors).toEqual([]);
});
