import { test, expect } from '@playwright/test';
for (const name of ['bubble-sort', 'shared-memory'])
  test(
    name + ': host restore is silent, own echoes do not rewind, disposal releases listeners',
    async ({ page }) => {
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(() => {
        window.receipts = [];
        window.openai = {
          setWidgetState(snapshot) {
            window.receipts.push(snapshot);
            setTimeout(
              () =>
                window.dispatchEvent(
                  new CustomEvent('openai:set_globals', {
                    detail: { globals: { widgetState: structuredClone(snapshot) } },
                  }),
                ),
              20,
            );
            return Promise.resolve();
          },
        };
      });
      await page.goto('/' + name + '/index.html');
      await page.locator('[data-seek]').waitFor();
      expect(await page.evaluate(() => window.receipts.length)).toBe(0);
      await page.locator('[data-next]').click();
      await expect(page.locator('[data-seek]')).toHaveValue('1');
      await page.waitForTimeout(50);
      expect(await page.evaluate(() => window.receipts.length)).toBe(1);
      const saved =
        name === 'bubble-sort' ? { version: 1, step: 3 } : { kind: 'shared-memory-v1', step: 3 };
      await page.evaluate(
        (privateContent) =>
          window.dispatchEvent(
            new CustomEvent('openai:set_globals', {
              detail: { globals: { widgetState: { privateContent } } },
            }),
          ),
        saved,
      );
      await expect(page.locator('[data-seek]')).toHaveValue('3');
      expect(await page.evaluate(() => window.receipts.length)).toBe(1);
      await page.locator('[data-play]').click();
      await page.evaluate(() => document.querySelector('.ve-scene').scene.dispose());
      await page.evaluate(
        (privateContent) =>
          window.dispatchEvent(
            new CustomEvent('openai:set_globals', {
              detail: { globals: { widgetState: { privateContent } } },
            }),
          ),
        saved,
      );
      expect(await page.locator('[data-seek]').count()).toBe(0);
      expect(errors).toEqual([]);
    },
  );
test('neuron: a delayed host echo preserves the current camera transition', async ({ page }) => {
  await page.addInitScript(() => {
    window.openai = {
      setWidgetState(snapshot) {
        setTimeout(
          () =>
            window.dispatchEvent(
              new CustomEvent('openai:set_globals', {
                detail: { globals: { widgetState: structuredClone(snapshot) } },
              }),
            ),
          50,
        );
        return Promise.resolve();
      },
    };
  });
  await page.goto('/neuron-explorer/index.html');
  await page.locator('[data-hit-key="sum"]').click();
  await page.locator('[data-hit-key="term-0"]').click();
  await expect(page.locator('.ve-view-actions .caption')).toContainText('2 + 2 + 2 = 6');
  expect(await page.locator('[data-child-scene]').count()).toBe(0);
});

const editableScenes = [
  {
    name: 'fraction-of-a-set',
    act: async (page) => {
      await page.locator('[data-parts="4"]').click();
      await page.locator('[data-parts="6"]').click();
    },
    state: '[data-parts="6"]',
    attribute: 'aria-pressed',
    value: 'true',
    restore: { example: 'fraction', parts: 2, taken: 1, mode: 'formulas' },
    restored: '[data-parts="2"]',
  },
  {
    name: 'threshold-neuron',
    act: async (page) => {
      await page.locator('[data-a]').fill('3');
      await page.locator('[data-a]').fill('4');
    },
    state: '[data-a-value]',
    value: '4',
    restore: { example: 'neuron', a: 0, b: 1, mode: 'numbers' },
    restored: '[data-a-value]',
    restoredValue: '0',
  },
  {
    name: 'equation-balance',
    act: async (page) => {
      await page.locator('[data-next]').click();
      await page.locator('[data-next]').click();
    },
    state: '.equation',
    value: 'x = 2',
    restore: { example: 'balance', step: 1 },
    restored: '.equation',
    restoredValue: '3x = 6',
  },
];
for (const scene of editableScenes)
  test(`${scene.name}: rapid input survives reversed echoes, restore and removal`, async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.receipts = [];
      window.openai = {
        setWidgetState: (snapshot) => {
          window.receipts.push(snapshot);
        },
      };
    });
    await page.goto(`/${scene.name}/index.html`);
    await page.evaluate(() => window.galleryReady);
    expect(await page.evaluate(() => window.receipts.length)).toBe(0);
    await scene.act(page);
    expect(await page.evaluate(() => window.receipts.length)).toBe(2);
    await page.evaluate(() => {
      for (const widgetState of [...window.receipts].reverse())
        window.dispatchEvent(
          new CustomEvent('openai:set_globals', { detail: { globals: { widgetState } } }),
        );
    });
    if (scene.attribute)
      await expect(page.locator(scene.state)).toHaveAttribute(scene.attribute, scene.value);
    else await expect(page.locator(scene.state)).toHaveText(scene.value);
    const restore = (privateContent) =>
      window.dispatchEvent(
        new CustomEvent('openai:set_globals', {
          detail: { globals: { widgetState: { privateContent } } },
        }),
      );
    await page.evaluate(restore, scene.restore);
    if (scene.attribute)
      await expect(page.locator(scene.restored)).toHaveAttribute(scene.attribute, scene.value);
    else await expect(page.locator(scene.restored)).toHaveText(scene.restoredValue);
    expect(await page.evaluate(() => window.receipts.length)).toBe(2);
    await page.evaluate(() => document.querySelector('.ve-scene').scene.dispose());
    await page.evaluate(restore, scene.restore);
    await page.setViewportSize({ width: 500, height: 800 });
    await expect(page.locator('.ve-scene')).toBeEmpty();
    expect(errors).toEqual([]);
  });

test('fraction: offline reload restores the same inputs through the shared bridge', async ({
  page,
}) => {
  await page.goto('/fraction-of-a-set/index.html');
  await page.evaluate(() => window.galleryReady);
  await page.locator('[data-parts="6"]').click();
  await page.locator('[data-taken]').fill('4');
  await page.reload();
  await page.evaluate(() => window.galleryReady);
  await expect(page.locator('[data-parts="6"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-taken]')).toHaveValue('4');
});
