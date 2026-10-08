import { test, expect } from '@playwright/test';
import { standalone } from '../../tools/standalone.mjs';

async function open(page, entry = 'index.html') {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`/parameter-cube/${entry}`);
  await page.evaluate(() => window.galleryReady);
  const frame = page.frames().find((item) => item.url().endsWith('.svg'));
  await frame.evaluate(() => window.galleryReady);
  return { frame, errors };
}

const state = (page) => page.locator('main').evaluate((root) => root.scene.snapshot());
const seek = (page, time) => page.locator('main').evaluate((root, t) => root.scene.seek(t), time);

test('BERT: one clock reveals the actual projection in order and selection restarts only its calculation', async ({
  page,
}) => {
  const { frame, errors } = await open(page);
  await seek(page, 0.8);
  await expect(frame.locator('#product-0')).toBeHidden();
  await expect(frame.locator('#partial')).toBeHidden();
  await seek(page, 2.65);
  await expect(frame.locator('[id^="product-"]:not([id^="product-box"])')).toHaveCount(4);
  for (let i = 0; i < 4; i++) await expect(frame.locator(`#product-${i}`)).toBeVisible();
  await expect(frame.locator('#partial')).toBeHidden();
  await seek(page, 3.7);
  await expect(frame.locator('#partial')).toBeVisible();
  await expect(frame.locator('#rest')).toBeHidden();
  await seek(page, 5);
  await expect(frame.locator('#rest')).toBeVisible();
  await expect(frame.locator('#final')).toBeHidden();
  await page.getByRole('slider', { name: 'Позиция рассказа' }).fill('7.2');
  await expect(frame.locator('#output-value')).toHaveText('q₁,₃ ≈ 0.648');
  const final = await state(page);
  expect(final.partial + final.rest).toBeCloseTo(final.output, 12);
  expect(await page.locator('main').evaluate((root) => root.scene.currentTime)).toBeCloseTo(7.2, 6);
  await seek(page, 1);
  await expect(frame.locator('#product-1')).toBeHidden();
  await expect(frame.locator('#final')).toBeHidden();
  await seek(page, 7.2);
  expect(await state(page)).toEqual(final);

  await frame.locator('#notation').press('ArrowDown');
  expect((await state(page)).time).toBe(7.2);
  await frame.getByRole('button', { name: 'Голова 3', exact: true }).click();
  expect(await state(page)).toMatchObject({ h: 2, time: 0, view: final.view });
  await frame.locator('#notation').press('ArrowRight');
  await frame.locator('#tokens').press('ArrowRight');
  await seek(page, 7.2);
  const chosen = await state(page);
  const actual = await frame.evaluate(() => window.getProjection().queries[2][2][3]);
  expect(chosen).toMatchObject({ token: 2, h: 2, j: 3, output: actual, view: final.view });
  await expect(frame.locator('#output-value')).toContainText('q₃,₄');

  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect
    .poll(() => page.locator('main').evaluate((root) => root.scene.currentTime))
    .toBeGreaterThan(0.05);
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  expect(await page.locator('main').evaluate((root) => root.scene.currentTime)).toBeLessThan(7.2);
  expect(errors).toEqual([]);
});

for (const theme of ['light', 'dark']) {
  test(`BERT: narrow ${theme} labels, keyboard and reduced motion retain the selected result`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    const { frame, errors } = await open(page);
    await seek(page, 0.8);
    await expect(frame.locator('#calculation-flow-0')).toBeHidden();
    await expect(frame.locator('#product-0')).toBeHidden();
    await seek(page, 3.1);
    await expect(frame.locator('#gather')).toBeHidden();
    await seek(page, 7.2);
    const outside = await frame.locator('svg').evaluate((svg) => {
      const bounds = svg.getBoundingClientRect();
      return [...svg.querySelectorAll('text')]
        .filter((text) => {
          const style = getComputedStyle(text),
            box = text.getBoundingClientRect();
          return (
            box.width &&
            style.visibility !== 'hidden' &&
            (box.left < bounds.left - 1 ||
              box.right > bounds.right + 1 ||
              box.top < bounds.top - 1 ||
              box.bottom > bounds.bottom + 1)
          );
        })
        .map((text) => text.textContent);
    });
    expect(outside).toEqual([]);
    await frame.locator('#notation').press('PageDown');
    await frame.locator('#notation').press('ArrowLeft');
    await frame.locator('#tokens').press('End');
    expect(await state(page)).toMatchObject({ h: 1, j: 1, token: 3, time: 0 });
    await seek(page, 7.2);
    await expect(frame.locator('#final')).toBeVisible();
    // Layout-only fixture: the longest token from the pinned vocabulary must fit its hit area.
    const overflow = await frame.evaluate(() => {
      const data = window.getProjection();
      window.setProjection({ ...data, tokens: data.tokens.map(() => 'telecommunications') });
      return [...document.querySelectorAll('[data-token]')].some((token) => {
        const box = token.querySelector('path').getBoundingClientRect();
        const text = token.querySelector('text').getBoundingClientRect();
        return text.left < box.left || text.right > box.right;
      });
    });
    expect(overflow).toBe(false);
    await page.locator('main').evaluate((root) => {
      const scene = root.scene;
      scene.dispose();
      scene.dispose();
    });
    await page.setViewportSize({ width: 960, height: 1000 });
    await expect(page.locator('main')).toBeEmpty();
    expect(errors).toEqual([]);
  });
}

test('BERT: disposing live input cancels its pending request and debounce', async ({ page }) => {
  const { errors } = await open(page, 'cube.html');
  let requests = 0;
  await page.route('**/api/projection', async (route) => {
    requests++;
    await new Promise((resolve) => setTimeout(resolve, 450));
    await route
      .fulfill({ status: 503, contentType: 'application/json', body: '{"error":"test response"}' })
      .catch(() => {});
  });
  await page.locator('#text').fill('our test');
  await expect.poll(() => requests).toBe(1);
  await page.locator('#text').fill('our home');
  await page.locator('main').evaluate((root) => root.scene.dispose());
  await page.waitForTimeout(600);
  expect(requests).toBe(1);
  await expect(page.locator('main')).toBeEmpty();
  expect(errors).toEqual([]);
});

test('BERT: autonomous HTML preserves the embedded drawing and its native player', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/packed-bert.html', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: packed,
    }),
  );
  const packed = await standalone('parameter-cube');
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto('/packed-bert.html');
  await page.evaluate(() => window.galleryReady);
  const frame = page.frames().find((item) => item !== page.mainFrame());
  await page.getByRole('slider', { name: 'Позиция рассказа' }).fill('7.2');
  await expect(frame.locator('#output-value')).toHaveText('q₁,₃ ≈ 0.648');
  await expect(frame.locator('svg')).toHaveAttribute('viewBox', /^0 0 550 /);
  await frame.getByRole('button', { name: 'Голова 2', exact: true }).click();
  expect(await state(page)).toMatchObject({ h: 1, time: 0 });
  await expect(frame.locator('#final')).toBeHidden();
  expect(errors).toEqual([]);
});
