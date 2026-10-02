import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const scenes = ['area', 'remainder', 'sort', 'lc', 'vector', 'transfer', 'materials'];
test('all scenes reconstruct identical drawings after backwards and forwards seeks', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const scene of scenes) {
    await page.goto(`/?scene=${scene}`);
    await page.evaluate(() => window.galleryReady);
    for (const time of await page.evaluate(() => window.explainer.checkpoints)) {
      const before = await page.evaluate((time) => {
        window.explainer.seek(time);
        return { state: window.explainer.snapshot(), drawing: window.explainer.svg().outerHTML };
      }, time);
      await page.evaluate(() => {
        window.explainer.seek(window.explainer.duration);
        window.explainer.seek(0);
      });
      const after = await page.evaluate((time) => {
        window.explainer.seek(time);
        return { state: window.explainer.snapshot(), drawing: window.explainer.svg().outerHTML };
      }, time);
      expect(after.state, `${scene} model at ${time}`).toEqual(before.state);
      const original = before.drawing.replaceAll(' style=""', ''),
        restored = after.drawing.replaceAll(' style=""', '');
      const first = [...original].findIndex((char, i) => char !== restored[i]);
      expect(
        restored === original,
        `${scene} at ${time}, difference near ${first}:\n${original.slice(Math.max(0, first - 100), first + 180)}\n${restored.slice(Math.max(0, first - 100), first + 180)}`,
      ).toBe(true);
    }
  }
  expect(errors).toEqual([]);
});
test('manual input pauses a story; return restores the paused story values', async ({ page }) => {
  await page.goto('/?scene=vector&t=10');
  await page.evaluate(() => window.galleryReady);
  await page.getByRole('button', { name: 'Воспроизвести', exact: true }).click();
  await page.getByRole('slider', { name: 'Масштаб x', exact: true }).fill('-1.4');
  await expect(page.locator('.vs-notebook')).toHaveAttribute('data-mode', 'explore');
  await expect(page.getByRole('button', { name: 'Воспроизвести', exact: true })).toBeVisible();
  const state = (await page.evaluate(() => window.explainer.snapshot())) as {
    input: { a: number };
  };
  expect(state.input.a).toBe(-1.4);
  await page.getByRole('button', { name: 'Вернуться к рассказу' }).click();
  await expect(page.locator('.vs-notebook')).toHaveAttribute('data-mode', 'story');
  const restored = (await page.evaluate(() => window.explainer.snapshot())) as {
    input: { a: number };
  };
  expect(restored.input.a).toBeCloseTo(1.8);
});
test('real audio can start, pause, scrub back and survive rapid repeated controls', async ({
  page,
}) => {
  await page.goto('/?scene=area&t=2');
  await page.evaluate(() => window.galleryReady);
  await page.getByRole('button', { name: 'Воспроизвести', exact: true }).click();
  await expect
    .poll(() => page.getByRole('slider', { name: 'Позиция рассказа' }).inputValue().then(Number))
    .toBeGreaterThan(2.1);
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  await page.getByRole('slider', { name: 'Позиция рассказа' }).fill('4.3');
  expect(await page.evaluate(() => window.explainer.snapshot())).toMatchObject({
    heightText: 1,
    widthText: 0,
  });
  for (let i = 0; i < 4; i++) await page.locator('.vs-player button').first().click();
  await expect(page.getByRole('button', { name: 'Воспроизвести', exact: true })).toBeVisible();
  const paused = await page.getByRole('slider', { name: 'Позиция рассказа' }).inputValue();
  await page.waitForTimeout(200);
  expect(await page.getByRole('slider', { name: 'Позиция рассказа' }).inputValue()).toBe(paused);
});
test('narrow scenes retain one player row, keyboard focus and theme-aware ink', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 950 });
  await mkdir('artifacts/previews', { recursive: true });
  for (const scene of scenes)
    for (const theme of ['light', 'dark']) {
      await page.goto(`/?scene=${scene}&theme=${theme}`);
      await page.evaluate(() => window.galleryReady);
      await page.evaluate(() => window.explainer.seek(window.explainer.checkpoints.at(-1)!));
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        375,
      );
      const row = await page.locator('.vs-player').evaluate((element) =>
        [...element.children].map((child) => {
          const r = child.getBoundingClientRect();
          return r.top + r.height / 2;
        }),
      );
      expect(Math.max(...row) - Math.min(...row)).toBeLessThan(2);
      await page.locator('.vs-player button').first().focus();
      expect(
        await page
          .locator('.vs-player button')
          .first()
          .evaluate((element) => element.matches(':focus-visible')),
      ).toBe(true);
      await page.screenshot({
        path: `artifacts/previews/${scene}-${theme}-375.png`,
        fullPage: true,
      });
    }
});
test('reduced motion keeps facts and package SVG export is self contained', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?scene=area&theme=dark&t=58.1');
  await page.evaluate(() => window.galleryReady);
  const state = (await page.evaluate(() => window.explainer.snapshot())) as { squares: number[] };
  expect(state.squares).toEqual(Array(20).fill(1));
  const source = await page.evaluate(() => window.explainer.exportSVG!());
  expect(source.includes('data:font/woff2;base64,')).toBe(true);
  expect(source.includes('var(--vs-')).toBe(false);
  await page.goto('/?scene=transfer&t=6');
  await page.evaluate(() => window.galleryReady);
  await expect(page.locator('.vs-canvas')).toHaveAttribute('data-received', 'true');
  await page.getByRole('slider', { name: 'Позиция рассказа' }).fill('3');
  await expect(page.locator('.vs-canvas')).toHaveAttribute('data-received', 'false');
});
