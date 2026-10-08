import { test, expect } from '@playwright/test';

const snapshot = (page) =>
  page.evaluate(() => document.querySelector('.ve-scene').scene.snapshot());

async function open(page, name) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`/${name}/index.html`);
  await page.evaluate(() => window.galleryReady);
  return errors;
}

async function expectLabelsInside(page) {
  const outside = await page.locator('svg.canvas').evaluate((svg) => {
    const bounds = svg.getBoundingClientRect();
    return [...svg.querySelectorAll('text')]
      .filter((text) => getComputedStyle(text).visibility !== 'hidden' && text.textContent)
      .filter((text) => {
        const rect = text.getBoundingClientRect();
        return (
          rect.left < bounds.left - 2 ||
          rect.right > bounds.right + 2 ||
          rect.top < bounds.top - 2 ||
          rect.bottom > bounds.bottom + 2
        );
      })
      .map((text) => text.textContent);
  });
  expect(outside).toEqual([]);
}

test('neuron: contributions arrive before the sum, the threshold precedes the output', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 1000 });
  const errors = await open(page, 'threshold-neuron');
  await page.locator('[data-a]').fill('3');
  expect(await snapshot(page)).toMatchObject({ a: 3, sumVisible: false, outputVisible: false });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-pulses] g[visibility="visible"]').length === 2,
  );
  expect(await snapshot(page)).toMatchObject({ sumVisible: false, outputVisible: false });
  await expect(page.locator('.sum')).toBeHidden();
  const coveredLabels = await page.evaluate(() => {
    const packets = [...document.querySelectorAll('[data-pulses] g[visibility="visible"]')];
    return [...document.querySelectorAll('[data-labels] text')]
      .filter((label) => getComputedStyle(label).visibility !== 'hidden' && label.textContent)
      .filter((label) => {
        const a = label.getBoundingClientRect();
        return packets.some((packet) => {
          const b = packet.getBoundingClientRect();
          return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        });
      })
      .map((label) => label.textContent);
  });
  expect(coveredLabels).toEqual([]);
  await page.waitForFunction(
    () => document.querySelector('.ve-scene').dataset.phase === 'threshold',
  );
  expect(await snapshot(page)).toMatchObject({ sum: 13, sumVisible: true, outputVisible: false });
  await expect(page.locator('.sum')).toHaveText('13');
  await page.locator('[data-mode="formulas"]').click();
  await page.locator('[data-b]').fill('0');
  await page.locator('[data-a]').fill('2');
  expect(await snapshot(page)).toMatchObject({ a: 2, b: 0, outputVisible: false });
  await expect.poll(async () => (await snapshot(page)).outputVisible).toBe(true);
  expect(await snapshot(page)).toMatchObject({ terms: [6, 0], sum: 6, output: 0 });
  await expect(page.locator('.operation')).toHaveText('6 < 9 → выход 0');
  await expectLabelsInside(page);
  expect(errors).toEqual([]);
});

test('fraction: repeated input keeps the same moving chips and reveals only the settled groups', async ({
  page,
}) => {
  const errors = await open(page, 'fraction-of-a-set');
  await page.evaluate(() => {
    window.originalChips = [...document.querySelectorAll('[data-chip]')];
  });
  await page.locator('[data-parts="4"]').click();
  await page.waitForTimeout(180);
  expect(await snapshot(page)).toMatchObject({ parts: 4, settled: false, result: null });
  await expect(page.locator('.fraction-result')).toBeHidden();
  const continuation = await page.evaluate(() => {
    const before = document.querySelector('.ve-scene').scene.snapshot().positions;
    document.querySelector('[data-mode="formulas"]').click();
    const after = document.querySelector('.ve-scene').scene.snapshot();
    return { before, after };
  });
  expect(continuation.after.settled).toBe(false);
  expect(continuation.after.positions).toEqual(continuation.before);
  await page.locator('[data-taken]').fill('1');
  expect(await snapshot(page)).toMatchObject({ settled: false, result: null });
  await page.locator('[data-parts="6"]').click();
  await page.setViewportSize({ width: 375, height: 1000 });
  await expect.poll(async () => (await snapshot(page)).settled).toBe(true);
  expect(await snapshot(page)).toMatchObject({ parts: 6, taken: 1, result: 2, total: 12 });
  expect(
    await page.evaluate(() =>
      window.originalChips.every((chip, i) => chip === document.querySelectorAll('[data-chip]')[i]),
    ),
  ).toBe(true);
  await expect(page.locator('[data-chip][data-selected="true"]')).toHaveCount(2);
  await expect(page.locator('.fraction-result')).toBeVisible();
  await expectLabelsInside(page);
  expect(errors).toEqual([]);
});

test('balance: forward, interrupted reverse and restored actions keep the equation behind the movement', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.openai = { setWidgetState() {} };
  });
  const errors = await open(page, 'equation-balance');
  await page.locator('[data-next]').click();
  expect(await snapshot(page)).toMatchObject({ step: 1, complete: false, equation: null });
  await expect(page.locator('.equation')).toBeHidden();
  await expect.poll(async () => (await snapshot(page)).complete).toBe(true);
  await expect(page.locator('[data-removed="true"]')).toHaveCount(4);
  await page.locator('[data-next]').click();
  await expect(page.locator('[data-removed="true"]')).toHaveCount(4);
  await page.waitForTimeout(180);
  const reverse = await page.evaluate(() => {
    const before = document.querySelector('.ve-scene').scene.snapshot().positions;
    document.querySelector('[data-back]').click();
    return { before, after: document.querySelector('.ve-scene').scene.snapshot() };
  });
  expect(reverse.after).toMatchObject({ step: 1, complete: false, equation: null });
  expect(reverse.after.positions).toEqual(reverse.before);
  await expect(page.locator('[data-action]')).toContainText('Собираем три группы');
  await page.evaluate(() => {
    const checkpoint = document.querySelector('.ve-scene').scene.capture();
    checkpoint.subject.progress = 1;
    window.dispatchEvent(
      new CustomEvent('openai:set_globals', {
        detail: { globals: { widgetState: { privateContent: checkpoint } } },
      }),
    );
  });
  expect(await snapshot(page)).toMatchObject({ step: 1, complete: true, equation: '3x = 6' });
  await expect(page.locator('.equation')).toBeVisible();
  await expectLabelsInside(page);
  expect(errors).toEqual([]);
});

for (const name of ['threshold-neuron', 'fraction-of-a-set', 'equation-balance']) {
  test(`${name}: narrow dark keyboard input and reduced motion preserve readable final states`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 1000 });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    const errors = await open(page, name);
    if (name === 'threshold-neuron') {
      await page.locator('[data-a]').focus();
      await page.keyboard.press('ArrowUp');
      expect(await snapshot(page)).toMatchObject({ a: 3, outputVisible: true, sum: 13 });
      await page.locator('[data-mode="formulas"]').click();
    } else if (name === 'fraction-of-a-set') {
      await page.locator('[data-parts="6"]').focus();
      await page.keyboard.press('Enter');
      expect(await snapshot(page)).toMatchObject({ parts: 6, settled: true, result: 4 });
      await page.locator('[data-mode="formulas"]').click();
    } else {
      await page.locator('[data-next]').focus();
      await page.keyboard.press('Enter');
      expect(await snapshot(page)).toMatchObject({ step: 1, complete: true, equation: '3x = 6' });
      await page.keyboard.press('Enter');
      expect(await snapshot(page)).toMatchObject({ step: 2, complete: true, equation: 'x = 2' });
    }
    await expectLabelsInside(page);
    await page.evaluate(() => {
      const scene = document.querySelector('.ve-scene').scene;
      scene.dispose();
      scene.dispose();
    });
    await page.setViewportSize({ width: 960, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(page.locator('.ve-scene')).toBeEmpty();
    expect(errors).toEqual([]);
  });
}
