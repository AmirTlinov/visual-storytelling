import { test, expect } from '@playwright/test';

for (const [name, entry, region] of [
  ['geometric-tensor', 'index.html', '#viewport'],
  ['parameter-cube', 'preview.html', '#stage'],
]) {
  test(`${name}: common orbit, middle/shift pan, zoom and reset preserve the model`, async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/${name}/${entry}`);
    await expect.poll(() => page.frames().some((frame) => frame.url().endsWith('.svg'))).toBe(true);
    const frame = page.frames().find((frame) => frame.url().endsWith('.svg'));
    const svg = frame.locator('svg.ve-scene');
    await expect(svg).toBeVisible();
    await expect.poll(() => svg.evaluate((n) => Boolean(n.scene))).toBe(true);
    const state = () => svg.evaluate((n) => n.scene.snapshot());
    const initial = await state();
    const stage = frame.locator(region);
    const area = await stage.locator('rect').first().boundingBox();
    const x = area.x + area.width * 0.48,
      y = area.y + area.height * 0.4;
    async function drag(button = 'left', shift = false) {
      if (shift) await page.keyboard.down('Shift');
      await page.mouse.move(x, y);
      await page.mouse.down({ button });
      await page.mouse.move(x + 45, y + 25, { steps: 8 });
      await page.mouse.up({ button });
      if (shift) await page.keyboard.up('Shift');
    }
    await drag();
    await expect.poll(async () => (await state()).view.yaw).not.toBe(initial.view.yaw);
    await stage.press('Home');
    await expect.poll(async () => (await state()).view.yaw).toBeCloseTo(initial.view.yaw, 8);
    await drag('middle');
    const middle = (await state()).view;
    expect(Math.hypot(...middle.pan)).toBeGreaterThan(10);
    expect(middle.yaw).toBeCloseTo(initial.view.yaw, 8);
    await stage.press('Home');
    await drag('left', true);
    const shift = (await state()).view;
    expect(shift.pan[0]).toBeCloseTo(middle.pan[0], 6);
    expect(shift.pan[1]).toBeCloseTo(middle.pan[1], 6);
    await stage.press('Home');
    await stage.press('+');
    expect((await state()).view.zoom).toBeGreaterThan(1);
    await stage.press('Home');
    expect(Math.hypot(...(await state()).view.pan)).toBeLessThan(1e-8);
    const { view, ...model } = await state();
    const { view: _, ...original } = initial;
    expect(model).toEqual(original);
    expect(errors).toEqual([]);
  });
}
