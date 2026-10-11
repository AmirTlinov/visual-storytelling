import { openFixture } from '../support/fixture.mjs';
import { test, expect } from '@playwright/test';

for (const [name, entry, region] of [
  ['SVG in HTML', 'index.html', '#viewport'],
  ['SVG entry', 'subject.svg', '#viewport'],
]) {
  test(`${name}: common orbit, middle/shift pan, zoom and reset preserve the model`, async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openFixture(page, 'svg', entry);
    await page.evaluate(async () => {
      await window.galleryReady;
    });
    const frame = page.mainFrame();
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

  test(`${name}: one checkpoint restores the visible experiment, camera and outer access`, async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openFixture(page, 'svg', entry);
    await page.evaluate(() => window.galleryReady);
    const frame = page.mainFrame();
    await frame.evaluate(() => window.galleryReady);
    const capture = () =>
      page.evaluate(() => {
        const scene = document.querySelector('.ve-scene').scene;
        return { checkpoint: scene.capture(), snapshot: scene.snapshot() };
      });
    const restore = (value) =>
      page.evaluate((value) => document.querySelector('.ve-scene').scene.restore(value), value);
    const initial = await capture();
    const immediate = await frame.evaluate(() => {
      const field = document.querySelector('#condition');
      field.value = '0.38';
      field.dispatchEvent(new Event('input', { bubbles: true }));
      const scene = document.querySelector('svg.ve-scene').scene;
      return {
        checkpoint: scene.capture(),
        snapshot: scene.snapshot(),
        eigen: document.querySelector('#value')?.textContent,
      };
    });
    expect(immediate.checkpoint.values).toEqual({ t: 0.38 });
    expect(immediate.snapshot.t).toBe(0.38);
    expect(immediate.eigen).toBe('0.38');
    const stage = frame.locator(region);
    await stage.press('ArrowLeft');
    await stage.press('ArrowUp');
    await stage.press('Shift+ArrowRight');
    await stage.press('+');
    const saved = await capture();
    expect(saved.checkpoint.view.kind).toBe('svg-orbit');
    expect(saved.checkpoint.view.zoom).toBeGreaterThan(1);
    expect(Math.hypot(...saved.checkpoint.view.pan)).toBeGreaterThan(1);
    await restore(initial.checkpoint);
    expect((await capture()).snapshot).not.toEqual(saved.snapshot);
    const recovered = await restore(saved.checkpoint);
    expect(recovered.restoreNotices).toEqual([]);
    const restored = await capture();
    expect(restored.checkpoint.values).toEqual(saved.checkpoint.values);
    expect(restored.checkpoint.subject).toEqual(saved.checkpoint.subject);
    expect(restored.checkpoint.time).toBe(saved.checkpoint.time);
    const { view, ...model } = restored.snapshot;
    const { view: expectedView, ...expectedModel } = saved.snapshot;
    expect(model).toEqual(expectedModel);
    for (const key of ['yaw', 'pitch', 'zoom']) expect(view[key]).toBeCloseTo(expectedView[key], 8);
    for (let i = 0; i < 2; i++) expect(view.pan[i]).toBeCloseTo(expectedView.pan[i], 8);
    const invalidCamera = await page.evaluate(() => {
      const scene = document.querySelector('.ve-scene').scene;
      const before = scene.capture();
      const rejected = scene.camera.restore({ ...before.view, zoom: NaN });
      return { rejected, unchanged: JSON.stringify(before) === JSON.stringify(scene.capture()) };
    });
    expect(invalidCamera).toEqual({ rejected: false, unchanged: true });
    expect(errors).toEqual([]);
  });
}
