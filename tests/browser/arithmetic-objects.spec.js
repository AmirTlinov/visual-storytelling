import { test, expect } from '@playwright/test';

const root = (page) => page.locator('#arithmetic-objects');
const object = (page, name) => page.locator(`[data-object="${name}"]`);
const seek = (page, time) => root(page).evaluate((node, t) => node.scene.seek(t), time);
const snapshot = (page) => root(page).evaluate((node) => node.scene.snapshot());

async function open(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/arithmetic-objects/index.html');
  await page.evaluate(() => window.galleryReady);
  return errors;
}

test('addition gathers existing objects; multiplication repeats the same-sized group', async ({
  page,
}) => {
  const errors = await open(page);
  const balloons = page.locator('[data-object^="balloon-"]:visible');
  await expect(balloons).toHaveCount(4);
  await expect(page.locator('.operation-equation')).toHaveText('2 + 2 = ?');
  await expect(page.getByRole('group', { name: 'Режим сцены' })).toBeHidden();
  const startingPositions = await balloons.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('transform')),
  );
  await seek(page, 7.5);
  await expect(balloons).toHaveCount(4);
  expect(await snapshot(page)).toMatchObject({ total: 4, collected: 4, result: 4 });
  const gathered = await balloons.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('transform')),
  );
  expect(gathered).not.toEqual(startingPositions);
  await seek(page, 0);
  expect(
    await balloons.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('transform'))),
  ).toEqual(startingPositions);

  await page.getByRole('radio', { name: '× Умножение' }).check();
  await expect(page.locator('[data-object^="cell-"]:visible')).toHaveCount(2);
  const original = await object(page, 'cell-0').evaluate((node) => {
    const { width, height } = node.getBoundingClientRect();
    return { width, height };
  });
  const identity = await object(page, 'cell-2').elementHandle();
  let paths;
  for (const time of [23, 25, 27.5, 20, 27.5]) {
    await seek(page, time);
    const drawn = await object(page, 'cell-2').evaluate((node) => {
      const { width, height } = node.getBoundingClientRect();
      return {
        width,
        height,
        paths: [...node.querySelectorAll('path')].map((path) => path.getAttribute('d')),
      };
    });
    if (time !== 20) {
      // Seeded hand-drawn contours vary slightly; their unit size must stay the same.
      expect(Math.abs(drawn.width - original.width)).toBeLessThan(2);
      expect(Math.abs(drawn.height - original.height)).toBeLessThan(2);
    }
    if (paths) expect(drawn.paths).toEqual(paths);
    paths = drawn.paths;
    expect(
      await identity.evaluate((node) => node === document.querySelector('[data-object="cell-2"]')),
    ).toBe(true);
  }
  await expect(page.locator('[data-object^="cell-"]:visible')).toHaveCount(4);
  await expect(page.locator('.operation-equation')).toHaveText('2 × 2 = 4');
  expect(errors).toEqual([]);
});

test('subtraction retains the recipient; division preserves pieces and reveals the answer after arrival', async ({
  page,
}) => {
  const errors = await open(page);
  await seek(page, 17.5);
  await expect(page.locator('[data-object^="coin-"]:visible')).toHaveCount(4);
  expect(await snapshot(page)).toMatchObject({ remaining: 2, transferred: 2, total: 4, result: 2 });
  const received = await object(page, 'recipient').evaluate((pocket) => {
    const box = pocket.getBoundingClientRect();
    return ['coin-2', 'coin-3'].every((id) => {
      const coin = document.querySelector(`[data-object="${id}"]`).getBoundingClientRect();
      return (
        coin.left >= box.left &&
        coin.right <= box.right &&
        coin.top >= box.top &&
        coin.bottom <= box.bottom
      );
    });
  });
  expect(received).toBe(true);

  await seek(page, 30);
  const pieces = page.locator('[data-object^="pie-half-"]');
  const shape = await pieces.evaluateAll((nodes) =>
    nodes.map((node) => [...node.querySelectorAll('path')].map((path) => path.getAttribute('d'))),
  );
  const beforeCut = await pieces.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('transform')),
  );
  await seek(page, 33);
  expect(
    await pieces.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('transform'))),
  ).toEqual(beforeCut);
  await expect(root(page)).toHaveAttribute('data-phase', 'cutting');
  await seek(page, 35);
  await expect(page.locator('.operation-equation')).toHaveText('2 ÷ 4 = ?');
  await seek(page, 37.5);
  expect(await snapshot(page)).toMatchObject({
    total: 2,
    pieceAreas: [0.5, 0.5, 0.5, 0.5],
    portion: 0.5,
    result: 0.5,
  });
  expect(
    await pieces.evaluateAll((nodes) =>
      nodes.map((node) => [...node.querySelectorAll('path')].map((path) => path.getAttribute('d'))),
    ),
  ).toEqual(shape);
  for (let i = 0; i < 4; i++) await expect(object(page, `plate-${i}:name`)).toHaveText('½ пирога');
  await expect(page.locator('.operation-equation')).toHaveText('2 ÷ 4 = ½');
  expect(errors).toEqual([]);
});

test('narrow dark scene keeps keyboard switching, reduced motion and playback in sync', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  const errors = await open(page);
  await page.getByRole('radio', { name: '+ Сложение' }).press('ArrowRight');
  await expect(page.getByRole('radio', { name: '− Вычитание' })).toBeFocused();
  await expect(root(page)).toHaveAttribute('data-operation', 'subtract');
  for (const name of ['÷ Деление', '+ Сложение', '× Умножение', '÷ Деление']) {
    await page.getByRole('radio', { name }).check();
  }
  await seek(page, 35);
  expect(await snapshot(page)).toMatchObject({
    operation: 'divide',
    progress: 0,
    cut: 1,
    done: false,
  });
  await page.getByRole('slider', { name: 'Позиция рассказа' }).fill('37.5');
  await expect(page.locator('.operation-equation')).toHaveText('2 ÷ 4 = ½');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('radio', { name: '× Умножение' }).check();
  await page.getByRole('button', { name: 'Воспроизвести', exact: true }).click();
  await expect
    .poll(() => root(page).evaluate((node) => node.scene.currentTime))
    .toBeGreaterThan(20.05);
  await page.getByRole('radio', { name: '+ Сложение' }).check();
  await expect(page.getByRole('button', { name: 'Воспроизвести', exact: true })).toBeVisible();
  expect(await root(page).evaluate((node) => node.scene.currentTime)).toBe(0);
  await root(page).evaluate((node) => node.scene.dispose());
  await page.setViewportSize({ width: 960, height: 1000 });
  await expect(root(page)).toBeEmpty();
  expect(errors).toEqual([]);
});
