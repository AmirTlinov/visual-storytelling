import { openFixture } from '../support/fixture.mjs';
import { test, expect } from '@playwright/test';
import sharp from 'sharp';

test('presentation samples only its selected projection and restores the latest pose when switching', async ({
  page,
}) => {
  await openFixture(page, 'arithmetic', 'projection.html');
  await page.evaluate(() => window.galleryReady);
  const sample = (progress: number) =>
    page.evaluate((progress) => {
      const math = (document.querySelector<HTMLElement>('.ve-scene')!.scene as any).math;
      const plan = math.plan,
        original = plan.sample;
      let calls = 0;
      plan.sample = (...args: unknown[]) => {
        calls++;
        return original.apply(plan, args);
      };
      try {
        const frame = math.render({ progress, reduced: false });
        return { calls, formula: frame.formula };
      } finally {
        plan.sample = original;
      }
    }, progress);
  expect((await sample(0.2)).calls).toBe(1);
  await page.getByRole('radio', { name: 'Плоскость', exact: true }).check();
  const flat = page.locator('[data-projection="2d"]');
  const result = await sample(1);
  expect(result.calls).toBe(1);
  await expect(flat.locator(`.vs-lettering[aria-label="${result.formula}"]`)).toBeVisible();
  const saved = await page.evaluate(() =>
    (document.querySelector<HTMLElement>('.ve-scene')!.scene as any).math.view.capture(),
  );
  await page.getByRole('radio', { name: 'Объём', exact: true }).check();
  await expect(page.locator('[data-projection="3d"]')).toContainText(result.formula);
  const reverse = await sample(0.2);
  expect(reverse.calls).toBe(1);
  expect(reverse.formula).not.toBe(result.formula);
  expect(
    await page.evaluate(
      (saved) =>
        (document.querySelector<HTMLElement>('.ve-scene')!.scene as any).math.view.restore(saved),
      saved,
    ),
  ).toBe(true);
  await expect(flat.locator(`.vs-lettering[aria-label="${reverse.formula}"]`)).toBeVisible();
});

test('a hidden 2D view starts safely and shows the latest sought operation when opened', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openFixture(page, 'arithmetic', 'projection.html');
  await page.evaluate(() => window.galleryReady);
  const flat = page.locator('[data-projection="2d"]');
  await expect(flat).toBeHidden();
  await page.locator('[data-seek]').fill('26');
  await page.getByRole('radio', { name: 'Плоскость', exact: true }).check();
  await expect(flat).toBeVisible();
  await expect(flat.locator('.vs-lettering[aria-label="6 ÷ 3 = 2"]')).toBeVisible();
  await expect(flat.locator('svg > desc')).toHaveText('2, 2, 2');
  // Inspect each material's center: the formula and body outlines cannot stand in for its digit.
  const canvas = flat.locator('[data-morph-ink] canvas');
  const paint = await canvas.evaluate((element) => ({
    color: getComputedStyle(element)
      .color.match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number),
    canvas: element.getBoundingClientRect().toJSON(),
    bodies: [...element.closest('svg')!.querySelectorAll('[data-stroke^="morph-body-"]')].map(
      (body) => body.getBoundingClientRect().toJSON(),
    ),
  }));
  const { data, info } = await sharp(await canvas.screenshot())
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(paint.bodies).toHaveLength(3);
  for (const body of paint.bodies) {
    const x0 = Math.ceil(
      ((body.x + body.width * 0.25 - paint.canvas.x) / paint.canvas.width) * info.width,
    );
    const x1 = Math.floor(
      ((body.x + body.width * 0.75 - paint.canvas.x) / paint.canvas.width) * info.width,
    );
    const y0 = Math.ceil(
      ((body.y + body.height * 0.2 - paint.canvas.y) / paint.canvas.height) * info.height,
    );
    const y1 = Math.floor(
      ((body.y + body.height * 0.8 - paint.canvas.y) / paint.canvas.height) * info.height,
    );
    let ink = 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * info.width + x) * info.channels;
        if (
          paint.color.every((channel, c) => Math.abs(data[i + c]! - channel) < 60) &&
          data[i + 3]! > 160
        )
          ink++;
      }
    expect(ink).toBeGreaterThan(80);
  }
  expect(errors).toEqual([]);
});

test('the largest authored power remains a visible measured area after changing inputs', async ({
  page,
}) => {
  await openFixture(page, 'arithmetic', 'projection.html');
  await page.evaluate(() => window.galleryReady);
  await page.locator('[data-mode=explore]').click();
  await expect(page.locator('[data-caption]')).toBeHidden();
  await page.getByRole('button', { name: 'Условия', exact: true }).click();
  await page.getByRole('radio', { name: 'Степень', exact: true }).check();
  await page.getByRole('slider', { name: 'Первое число', exact: true }).fill('6');
  await page.getByRole('slider', { name: 'Второе число', exact: true }).fill('4');
  await page.getByRole('slider', { name: 'Переход', exact: true }).fill('1');
  await page.getByRole('button', { name: 'Условия', exact: true }).click();
  await expect(page.locator('[data-projection="3d"]')).toContainText('6^4 = 1296');
  // Measure the canvas contribution against the same paper and HTML labels. This
  // stays valid for neutral ink; neither the grid nor the formula counts as area.
  const canvas = page.locator('[data-projection="3d"] canvas'),
    clip = (await canvas.boundingBox())!;
  const { data, info } = await sharp(await page.screenshot({ clip }))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const opacity = await canvas.evaluate((node) => {
    const before = node.style.opacity;
    node.style.opacity = '0';
    return before;
  });
  let background: Buffer;
  try {
    background = await sharp(await page.screenshot({ clip }))
      .ensureAlpha()
      .raw()
      .toBuffer();
  } finally {
    await canvas.evaluate((node, value) => (node.style.opacity = value), opacity);
  }
  let area = 0,
    top = info.height,
    bottom = 0;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      if (
        [0, 1, 2].some((channel) => Math.abs(data[i + channel]! - background[i + channel]!) > 20)
      ) {
        area++;
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  expect(area).toBeGreaterThan(2000);
  expect(bottom - top).toBeGreaterThan(70);
});
