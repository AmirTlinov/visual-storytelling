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
            receipts.push(snapshot);
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
      expect(await page.evaluate(() => receipts.length)).toBe(0);
      await page.locator('[data-next]').click();
      await expect(page.locator('[data-seek]')).toHaveValue('1');
      await page.waitForTimeout(50);
      expect(await page.evaluate(() => receipts.length)).toBe(1);
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
      expect(await page.evaluate(() => receipts.length)).toBe(1);
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
