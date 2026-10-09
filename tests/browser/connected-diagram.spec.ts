import { test, expect, type Page } from '@playwright/test';

const snapshot = (page: Page) =>
  page.evaluate(() => (document.querySelector('.ve-scene') as any).scene.snapshot());
const settle = (page: Page) =>
  page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
const focusBounds = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector('canvas') as any;
    const objects = canvas.__visualReview().objects;
    return [...document.querySelectorAll<HTMLButtonElement>('button[data-object]')].map(
      (button) => {
        const object = objects.find((item: any) => item.id === button.dataset.object);
        const bounds = button.getBoundingClientRect();
        return Math.max(
          ...(['x', 'y', 'width', 'height'] as const).map((key) =>
            Math.abs(bounds[key] - object[key]),
          ),
        );
      },
    );
  });

test('the recurrent chain reveals its state in the drawing and reverses without moving the frame', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1312, height: 800 });
  await page.goto('/connected-diagram/index.html');
  await page.evaluate(() => window.galleryReady);
  await settle(page);
  const initial = await snapshot(page);
  expect(initial.layout).toBe('row');
  expect(initial.state).toBe('h0');
  expect(initial.routes).toHaveLength(4);
  expect(initial.routes.every((route: unknown[]) => route.length >= 2)).toBe(true);
  expect(Math.max(...(await focusBounds(page)))).toBeLessThan(1);
  await expect(page.locator('.ve-explanation, .ve-disclosure')).toHaveCount(0);
  await expect(page.locator('.ve-captions:visible')).toHaveCount(0);
  await page.getByRole('button', { name: 'Исследовать', exact: true }).click();
  const time = page.getByRole('slider', { name: 'Момент', exact: true });
  await time.fill('10.5');
  await settle(page);
  const playing = await snapshot(page);
  expect(playing.signal.visible).toBe(true);
  expect(playing.output).toEqual(['the', 'cat']);
  const canvas = page.locator('.ve-stage canvas');
  const before = await canvas.boundingBox();
  const state = page.locator('button[data-object="recurrent-state"]');
  await state.focus();
  await state.press('Enter');
  await settle(page);
  expect((await snapshot(page)).details).toBe(true);
  expect(Math.max(...(await focusBounds(page)))).toBeLessThan(1);
  expect(await canvas.boundingBox()).toEqual(before);
  const expanded = await snapshot(page);
  expect(expanded.routes).toEqual(playing.routes);
  expect(expanded.camera).toEqual(playing.camera);
  await state.press('Enter');
  await settle(page);
  expect((await snapshot(page)).details).toBe(false);
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

test('the recurrent diagram keeps a 16:9 frame, object actions and both themes at narrow width', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/connected-diagram/index.html');
  await page.evaluate(() => window.galleryReady);
  await page.getByRole('button', { name: 'Исследовать', exact: true }).click();
  expect((await snapshot(page)).layout).toBe('row');
  await expect(
    page.getByRole('switch', { name: 'Расположить в столбик', exact: true }),
  ).toHaveCount(0);
  const time = page.getByRole('slider', { name: 'Момент', exact: true });
  await time.focus();
  await time.press('End');
  await expect(page.locator('[data-sequence-output]')).toHaveText('the cat is on the roof');
  await time.press('Home');
  await expect(page.locator('[data-sequence-state]')).toHaveText('h₀');
  const word = page.locator('button[data-object="input-word-1"]');
  await word.focus();
  await word.press('Enter');
  await settle(page);
  expect((await snapshot(page)).active).toBe(1);
  const state = page.locator('button[data-object="recurrent-state"]');
  await state.focus();
  await state.press('Enter');
  await settle(page);
  expect((await snapshot(page)).details).toBe(true);
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
    expect(presentation.frame.width / presentation.frame.height).toBeCloseTo(16 / 9, 2);
    expect(presentation.clipped).toEqual([]);
    expect(presentation.overflow).toBe(false);
    expect(Math.max(...(await focusBounds(page)))).toBeLessThan(1);
    await testInfo.attach(`narrow-${theme}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  }
  expect(errors).toEqual([]);
});
