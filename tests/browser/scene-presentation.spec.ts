import { test, expect } from '@playwright/test';
import { build } from 'esbuild';

test('selectable artwork has no control decoration and retains its own keyboard focus', async ({
  page,
}) => {
  await page.goto('/svg-artwork/index.html');
  await page.evaluate(() => (window as any).galleryReady);
  const art = page.getByRole('button', { name: 'Красный воздушный шар', exact: true });
  const decoration = () =>
    art.evaluate((element) => ({
      before: getComputedStyle(element, '::before').content,
      after: getComputedStyle(element, '::after').content,
      outline: getComputedStyle(element).outlineStyle,
    }));
  expect(await decoration()).toEqual({ before: 'none', after: 'none', outline: 'none' });
  // The actual player still uses the shared drawn controls.
  expect(
    await page
      .getByRole('button', { name: 'Воспроизвести', exact: true })
      .evaluate((element) => getComputedStyle(element, '::after').content),
  ).toBe('""');
  await art.focus();
  await expect.poll(async () => (await decoration()).outline).toBe('solid');
  await art.press('Enter');
  await expect(art).toHaveAttribute('data-selected');
  expect((await decoration()).after).toBe('none');
  await page.getByRole('button', { name: 'Исследовать', exact: true }).click();
  await page.getByRole('slider', { name: 'Видимость красного', exact: true }).fill('0');
  await expect(art).toBeHidden();
  await page.getByRole('slider', { name: 'Видимость красного', exact: true }).fill('1');
  await expect(art).toBeVisible();
});

test('review ignores hidden SVG and measures lettering after real perspective projection', async ({
  page,
}) => {
  const bundle = await build({
    entryPoints: ['dist/scene-frame.js'],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'FrameUnderTest',
  });
  await page.setContent(`<main style="position:absolute;left:0;top:0;width:300px;height:200px;overflow:hidden">
    <div style="transform-origin:0 0;transform:matrix3d(1,0,0,0,0,1,0,.005,0,0,1,0,0,0,0,1)">
      <svg width="300" height="200">
        <g style="display:none"><text x="900" y="700" font-size="8">Hidden</text></g>
        <g opacity="0"><text x="900" y="700" font-size="8">Transparent</text></g>
        <text data-review-id="far-label" x="20" y="100" font-size="20">Дальний край</text>
      </svg>
    </div></main>`);
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
  const inspect = () =>
    page.evaluate(() =>
      (window as any).FrameUnderTest.inspectPresentation(document.querySelector('main')),
    );
  const projected = await inspect();
  expect(projected.clipped).toEqual([]);
  expect(projected.unreadableText).toHaveLength(1);
  expect(projected.unreadableText[0].id).toBe('far-label');
  expect(projected.unreadableText[0].pixels).toBeGreaterThan(9);
  expect(projected.unreadableText[0].pixels).toBeLessThan(12);
  await page.locator('main > div').evaluate((element: HTMLElement) => {
    element.style.transform = 'none';
  });
  const flat = await inspect();
  expect(flat.clipped).toEqual([]);
  expect(flat.unreadableText).toEqual([]);
  expect(await page.locator('svg g').count()).toBe(2);
});

test('pointer selection keeps formulas and moving results clean; keyboard focus remains visible', async ({
  page,
}) => {
  await page.goto('/result-delivery/index.html');
  await page.evaluate(() => (window as any).galleryReady);
  await page.locator('[data-seek]').fill('9.5');
  const formula = page.locator('.ve-label[data-object="calculation"]:not([hidden])');
  const calculation = page.locator('button[data-object="calculation"]');
  const result = page.locator('button[data-object^="calculation:"]:not([hidden])');
  const decorations = () =>
    page.locator('[data-object]:not([hidden])').evaluateAll((nodes) =>
      nodes.map((node) => ({
        outline: getComputedStyle(node).outlineStyle,
        filter: getComputedStyle(node).filter,
      })),
    );
  const expectClean = async () => {
    await expect
      .poll(async () =>
        (await decorations()).every((item) => item.outline === 'none' && item.filter === 'none'),
      )
      .toBe(true);
    await expect(calculation.locator('span')).toBeHidden();
    await expect(result.locator('span')).toBeHidden();
  };
  await formula.click();
  await expect(calculation).toHaveAttribute('data-selected');
  await expectClean();
  await formula.click();
  await expect(calculation).not.toHaveAttribute('data-selected');
  const body = (await result.boundingBox())!;
  await page.mouse.click(body.x + body.width / 2, body.y + body.height / 2);
  await expect(result).toHaveAttribute('data-selected');
  await expectClean();
  const canvas = page.locator('.ve-stage canvas');
  await canvas.click({ position: { x: 8, y: 8 } });
  await expect(page.locator('[data-selected]')).toHaveCount(0);
  // Browser keyboard modality owns the indicator; a remembered selection does not.
  await canvas.focus();
  await page.keyboard.press('Tab');
  await result.focus();
  await expect
    .poll(() => result.evaluate((node) => getComputedStyle(node).outlineStyle))
    .toBe('solid');
  await expect(result.locator('span')).toBeVisible();
  await result.press('Enter');
  await expect(result).toHaveAttribute('data-selected');
  await canvas.click({ position: { x: 8, y: 8 } });
  await expect(page.locator('[data-selected]')).toHaveCount(0);
  await expectClean();
});
