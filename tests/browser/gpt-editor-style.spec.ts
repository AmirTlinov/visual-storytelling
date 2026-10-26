import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

test('in-frame editing shares notebook ink in both themes without restyling embedded UI', async ({
  page,
}) => {
  await page.goto('/gpt-model/index.html');
  await page.evaluate(() => window.galleryReady);
  await mkdir(resolve('artifacts/direct-input'), { recursive: true });
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate(async (theme) => {
      await document.querySelector<HTMLElement>('main.ve-scene')!.scene!.control([
        { type: 'theme', value: theme },
        { type: 'parameters', values: { view: 'overview' } },
      ]);
    }, theme);
    for (const width of [375, 1200]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator('[data-action="edit-prompt"]').click();
      const field = page.getByRole('textbox', { name: 'Фраза', exact: true });
      await expect(field).toBeFocused();
      const style = await page.locator('.gpt-prompt-editor').evaluate((form) => {
        const input = form.querySelector('input')!;
        const button = form.querySelector('button')!;
        const native = document.createElement('button');
        form.parentElement!.append(native);
        const nativeAppearance = getComputedStyle(native).appearance;
        native.remove();
        return {
          nativeAppearance,
          appearance: getComputedStyle(button).appearance,
          background: getComputedStyle(button).backgroundColor,
          outline: getComputedStyle(input).outlineStyle,
          selection: getComputedStyle(input, '::selection').color,
          ink: getComputedStyle(input).color,
          fieldStroke: getComputedStyle(input.parentElement!, '::after').maskImage,
          buttonStroke: getComputedStyle(button, '::after').maskImage,
          font: getComputedStyle(input).fontFamily,
        };
      });
      expect(style.nativeAppearance).toBe('auto');
      expect(style.appearance).toBe('none');
      expect(style.background).toBe('rgba(0, 0, 0, 0)');
      expect(style.outline).toBe('none');
      expect(style.selection).toBe(style.ink);
      expect(style.fieldStroke).not.toBe('none');
      expect(style.buttonStroke).not.toBe('none');
      expect(style.font).toContain('SketchPencil');
      await page.locator('main.ve-scene').screenshot({
        path: resolve(`artifacts/direct-input/gpt-editor-${width}-${theme}.png`),
      });
      await field.press('Tab');
      await expect(page.getByRole('button', { name: 'Готово', exact: true })).toBeFocused();
      await page.getByRole('button', { name: 'Готово', exact: true }).press('Escape');
      await expect(field).toBeHidden();
    }
  }
});
