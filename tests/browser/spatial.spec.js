import { test, expect } from '@playwright/test';

async function open(page, scene) {
  await page.goto(`/${scene}/index.html`);
  await page.evaluate(async () => {
    await window.galleryReady;
  });
}
async function seek(page, time) {
  await page.evaluate(async (time) => {
    window.explainer.pause();
    window.explainer.seek(time);
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  }, time);
}
async function choose(page, name) {
  await page.getByRole('combobox', { name: 'Действие' }).click();
  await page.getByRole('option', { name, exact: true }).click();
}

test('spatial actions keep actual lettering readable through transitions and reflow', async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const width of [375, 1100])
    for (const colorScheme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 1100 });
      await page.emulateMedia({ colorScheme });
      for (const scene of ['math-workbench', 'tensor-slices']) {
        await open(page, scene);
        for (const name of scene === 'math-workbench'
          ? ['Сложение координат', 'Изменение масштаба', 'Фильтр изображения']
          : ['Срез']) {
          if (scene === 'math-workbench') await choose(page, name);
          const count =
            scene === 'math-workbench'
              ? (Number(await page.locator('[data-seek]').getAttribute('max')) - 3) / 5
              : 0;
          for (const time of scene === 'math-workbench'
            ? [
                0,
                1.15,
                ...Array.from({ length: count }, (_, i) => [
                  2 + i * 5,
                  3.8 + i * 5,
                  5.8 + i * 5,
                ]).flat(),
                2,
              ]
            : [2, 5, 6, 7, 9, 12, 2]) {
            await seek(page, time);
            const result = await page.evaluate(() => {
              const labels = [...document.querySelectorAll('.ve-label:not([hidden])')];
              const boxes = labels.map((label) => label.getBoundingClientRect());
              const overlaps = boxes.flatMap((a, i) =>
                boxes
                  .slice(i + 1)
                  .filter(
                    (b) =>
                      a.left < b.right - 1 &&
                      b.left < a.right - 1 &&
                      a.top < b.bottom - 1 &&
                      b.top < a.bottom - 1,
                  ),
              );
              return {
                readability: window.explainer.snapshot().readability,
                overlaps: overlaps.length,
                overflow: document.documentElement.scrollWidth > innerWidth,
                clipped: labels
                  .filter((label) => label.scrollWidth > label.clientWidth + 1)
                  .map((label) => label.textContent),
              };
            });
            const context = `${name} ${width} ${colorScheme} t=${time}`;
            expect(result.readability.issues, context).toEqual([]);
            expect(result.readability.connections.issues, context).toEqual([]);
            expect(result.overlaps, context).toBe(0);
            expect(result.overflow, context).toBe(false);
            expect(result.clipped, context).toEqual([]);
          }
        }
      }
    }
  expect(errors).toEqual([]);
});

test('orbit leaves playback running; return, reverse seek and repeated actions keep one scene', async ({
  page,
}) => {
  await open(page, 'math-workbench');
  await seek(page, 3.8);
  const snapshot = () => page.evaluate(() => window.explainer.snapshot());
  const initial = await snapshot();
  await page.locator('[data-play]').click();
  await page.locator('.ve-stage > canvas').press('ArrowRight');
  expect((await snapshot()).following).toBe(false);
  await expect.poll(() => page.locator('[data-seek]').inputValue().then(Number)).toBeGreaterThan(4);
  await expect(page.locator('[data-play]')).toHaveAttribute('aria-label', 'Пауза');
  await page.getByRole('button', { name: 'Вернуть ракурс' }).click();
  expect((await snapshot()).following).toBe(true);
  await seek(page, 42);
  expect((await snapshot()).visibleResult).toHaveLength(8);
  await seek(page, 3.8);
  expect((await snapshot()).visibleResult).toEqual(initial.visibleResult);
  const count = () =>
    page.evaluate(() => ({
      labels: document.querySelectorAll('.ve-label').length,
      geometries: window.explainer.view.renderer.info.memory.geometries,
    }));
  const before = await count();
  for (let i = 0; i < 3; i++) {
    await choose(page, 'Фильтр изображения');
    await seek(page, 47);
    expect((await snapshot()).visibleResult[0]).toBeCloseTo(0.446875);
    await choose(page, 'Сложение координат');
    await seek(page, 3.8);
  }
  expect(await count()).toEqual(before);
});

test('reduced motion preserves the time when a contribution becomes a result', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, 'math-workbench');
  await seek(page, 5.55);
  expect((await page.evaluate(() => window.explainer.snapshot())).completed).toBe(0);
  await seek(page, 5.65);
  expect((await page.evaluate(() => window.explainer.snapshot())).visibleResult[0]).toBeCloseTo(
    0.19,
  );
  await seek(page, 5.55);
  expect((await page.evaluate(() => window.explainer.snapshot())).visibleResult).toEqual([]);
});
