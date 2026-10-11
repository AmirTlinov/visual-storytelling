import { test, expect } from '@playwright/test';
import { build } from 'esbuild';

test('bare fields and authored frame controls retain their own keyboard focus', async ({
  page,
}) => {
  const styles = await build({
    entryPoints: ['dist/style.css'],
    bundle: true,
    write: false,
    loader: { '.woff2': 'dataurl', '.svg': 'dataurl' },
  });
  await page.setContent(
    '<main class="ve-scene"><input aria-label="Bare field"><textarea aria-label="Bare text"></textarea><div class="ve-frame"><button>Authored control</button></div></main>',
  );
  await page.addStyleTag({ content: styles.outputFiles[0]!.text });
  const field = page.getByRole('textbox', { name: 'Bare field', exact: true });
  await field.focus();
  for (const control of [
    field,
    page.getByRole('textbox', { name: 'Bare text', exact: true }),
    page.getByRole('button', { name: 'Authored control', exact: true }),
  ]) {
    await expect(control).toBeFocused();
    expect(await control.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe('none');
    expect(await control.evaluate((node) => getComputedStyle(node, '::after').content)).toBe(
      'none',
    );
    await page.keyboard.press('Tab');
  }
});

test('numeric controls preserve a typed negative fraction and recover incomplete input on blur', async ({
  page,
}) => {
  const bundle = await build({
    entryPoints: ['dist/controls/fields.js'],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'ControlsUnderTest',
  });
  await page.setContent('<main></main><button type="button">Готово</button>');
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
  await page.evaluate(() => {
    const { SketchControls } = (
      window as unknown as {
        ControlsUnderTest: typeof import('../../src/controls/fields.js');
      }
    ).ControlsUnderTest;
    for (const type of ['number', 'stepper'] as const) {
      const output = document.createElement('output');
      output.id = `${type}-value`;
      const field = SketchControls.field(
        { type, label: type, min: -6, max: 6, step: 0.1, value: 2 },
        (value) => {
          output.textContent = String(value);
        },
      );
      document.querySelector('main')!.append(field.element, output);
    }
  });
  for (const type of ['number', 'stepper']) {
    const input = page.getByRole('spinbutton', { name: type, exact: true });
    await input.fill('');
    await input.pressSequentially('-0');
    await expect(input).toHaveValue('-0');
    await input.pressSequentially('.5');
    await expect(input).toHaveValue('-0.5');
    await expect(page.locator(`#${type}-value`)).toHaveText('-0.5');
    await input.fill('');
    await input.pressSequentially('-');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await page.getByRole('button', { name: 'Готово', exact: true }).click();
    await expect(input).toHaveValue('-0.5');
  }
  await page.getByRole('button', { name: 'Увеличить: stepper', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'stepper', exact: true })).toHaveValue('-0.4');
});
