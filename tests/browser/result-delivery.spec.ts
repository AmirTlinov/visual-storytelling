import { test, expect } from '@playwright/test';

test('computed results arrive once and rewind through the same path, including exploration', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/result-delivery/index.html');
  await page.evaluate(() => window.galleryReady);
  const receiver = page.getByRole('button', { name: 'Записанный результат', exact: true });
  const computed = page.locator('[data-object^="calculation:"]:not([hidden])');
  const state = () =>
    page.evaluate(() => {
      const view = (document.querySelector('main') as any).scene.view;
      const calculation = view.scene.getObjectByName('calculation');
      const source = calculation.children[0],
        target = view.scene.getObjectByName('stored-result');
      return {
        source: source.visible,
        target: target.visible,
        pose: [...source.matrix.elements],
        camera: view.camera.position.toArray(),
        result: calculation.userData.visualReview().frame.result,
        formula: [...document.querySelectorAll<HTMLElement>('.ve-label')].some(
          (label) =>
            !label.hidden &&
            label.textContent === calculation.userData.visualReview().frame.formula,
        ),
      };
    });
  const seek = async (time: number) => {
    await page.locator('[data-seek]').fill(String(time));
    await page.locator('.ve-stage canvas').screenshot();
    return state();
  };
  expect((await seek(7.5)).formula).toBe(true);
  await expect(receiver).toBeHidden();
  await expect(computed).toHaveCount(1);
  const before = (await computed.boundingBox())!;
  const travelling = await seek(9.5);
  const during = (await computed.boundingBox())!;
  expect(during.y).toBeGreaterThan(before.y + 30);
  expect(travelling).toMatchObject({ source: true, target: false, result: 5, formula: false });
  const arrived = await seek(11);
  await expect(receiver).toBeVisible();
  await expect(computed).toHaveCount(0);
  expect(arrived).toMatchObject({ source: false, target: true, result: 5, formula: false });
  expect(arrived.camera).toEqual(travelling.camera);
  const address = (await receiver.boundingBox())!;
  await page.mouse.click(address.x + address.width / 2, address.y + address.height / 2);
  await expect(receiver).toHaveAttribute('data-selected');
  await seek(2);
  await expect(receiver).toBeHidden();
  expect(await seek(9.5)).toEqual(travelling);
  expect(await seek(11)).toEqual(arrived);

  await page.getByRole('button', { name: 'Исследовать', exact: true }).click();
  await page.getByRole('radio', { name: 'Собрать элемент вектора', exact: true }).check();
  await page.getByRole('slider', { name: 'Поворот ячеек', exact: true }).fill('25');
  for (const value of ['-3', '5', '2'])
    await page.getByRole('slider', { name: 'Первое число', exact: true }).fill(value);
  expect(await state()).toMatchObject({ source: false, target: true, result: -3 });
  await page.getByRole('slider', { name: 'Момент', exact: true }).fill('9.5');
  const vectorTravel = await state();
  expect(vectorTravel).toMatchObject({ source: true, target: false });
  await page.getByRole('slider', { name: 'Момент', exact: true }).fill('13');
  await expect(receiver).toBeVisible();
  await page.getByRole('slider', { name: 'Момент', exact: true }).fill('0');
  await expect(receiver).toBeHidden();
  await page.getByRole('slider', { name: 'Момент', exact: true }).fill('9.5');
  expect((await state()).pose).toEqual(vectorTravel.pose);

  // Resizing and reduced motion re-render the last two cues, not the initial frame.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.locator('.ve-stage canvas').screenshot();
  expect((await state()).pose).toEqual(vectorTravel.pose);
  await page.getByRole('button', { name: 'Рассказ', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const held = await seek(7.5);
  (await seek(9.5)).pose.forEach((value: number, i: number) =>
    expect(value).toBeCloseTo(held.pose[i], 10),
  );
  await expect(receiver).toBeHidden();
  expect(await seek(11)).toMatchObject({ source: false, target: true });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await seek(9.5)).toMatchObject({ source: true, target: false });
  expect(errors).toEqual([]);
});
