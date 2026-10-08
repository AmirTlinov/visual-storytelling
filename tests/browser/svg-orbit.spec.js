import { test, expect } from '@playwright/test';

for (const [name, entry, region] of [
  ['geometric-tensor', 'index.html', '#viewport'],
  ['parameter-cube', 'index.html', '#stage'],
]) {
  test(`${name}: common orbit, middle/shift pan, zoom and reset preserve the model`, async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/${name}/${entry}`);
    await page.evaluate(async () => {
      await window.galleryReady;
    });
    const frame =
      name === 'geometric-tensor'
        ? page.mainFrame()
        : page.frames().find((frame) => frame.url().endsWith('.svg'));
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
    await page.goto(`/${name}/${entry}`);
    await page.evaluate(() => window.galleryReady);
    const frame =
      name === 'geometric-tensor'
        ? page.mainFrame()
        : page.frames().find((item) => item.url().endsWith('.svg'));
    await frame.evaluate(() => window.galleryReady);
    const capture = () =>
      page.evaluate(() => {
        const scene = document.querySelector('.ve-scene').scene;
        return { checkpoint: scene.capture(), snapshot: scene.snapshot() };
      });
    const restore = (value) =>
      page.evaluate((value) => document.querySelector('.ve-scene').scene.restore(value), value);
    const initial = await capture();
    const immediate = await frame.evaluate((name) => {
      const field = document.querySelector(
        name === 'geometric-tensor' ? '#tensor-control-input' : '#layers-input',
      );
      field.value = '0.38';
      field.dispatchEvent(new Event('input', { bubbles: true }));
      const scene = document.querySelector('svg.ve-scene').scene;
      return {
        checkpoint: scene.capture(),
        snapshot: scene.snapshot(),
        eigen: document.querySelector('#eigen-0')?.textContent,
      };
    }, name);
    if (name === 'geometric-tensor') {
      expect(immediate.checkpoint.values).toEqual({ t: 0.38 });
      expect(immediate.snapshot.t).toBe(0.38);
      expect(immediate.eigen).toBe('1.32');
    } else {
      expect(immediate.checkpoint.subject.spread).toBe(0.38);
      expect(immediate.snapshot.spread).toBe(0.38);
      await frame.evaluate(() => {
        const projection = structuredClone(window.getProjection());
        projection.inputs[2][0] += 0.25;
        projection.queries[3][2][1] += 0.5;
        window.setProjection(projection);
      });
      await page.evaluate(() =>
        document.querySelector('.ve-scene').scene.control([
          { type: 'parameters', values: { selected: '2-1-3', token: 2, spread: 0.68 } },
          { type: 'seek', time: 3.1 },
        ]),
      );
    }
    const stage = frame.locator(region);
    await stage.press('ArrowLeft');
    await stage.press('ArrowUp');
    await stage.press('Shift+ArrowRight');
    await stage.press('+');
    const saved = await capture();
    expect(saved.checkpoint.view.kind).toBe('svg-orbit');
    expect(saved.checkpoint.view.zoom).toBeGreaterThan(1);
    expect(Math.hypot(...saved.checkpoint.view.pan)).toBeGreaterThan(1);
    if (name === 'parameter-cube') {
      expect(saved.checkpoint.values).toEqual({ selected: '2-1-3', token: 2, spread: 0.68 });
      expect(saved.checkpoint.time).toBe(3.1);
      expect(saved.checkpoint.subject.projection).not.toEqual(
        initial.checkpoint.subject.projection,
      );
    }
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
    if (name === 'parameter-cube') {
      await expect(
        restore({
          ...saved.checkpoint,
          time: 0,
          subject: { ...saved.checkpoint.subject, token: 100000 },
        }),
      ).rejects.toThrow(/existing coefficient/);
      expect((await capture()).checkpoint).toEqual(restored.checkpoint);
      const invalidObjects = await page.evaluate(async () => {
        const scene = document.querySelector('.ve-scene').scene;
        const before = scene.capture();
        class CustomState {
          constructor(value) {
            Object.assign(this, value);
          }
        }
        const failures = [];
        for (const subject of [
          new CustomState(before.subject),
          Object.assign(Object.create({ custom: true }), before.subject),
        ]) {
          try {
            await scene.restore({ ...before, subject });
          } catch (error) {
            failures.push(error.message);
          }
        }
        return { failures, unchanged: JSON.stringify(scene.capture()) === JSON.stringify(before) };
      });
      expect(invalidObjects.failures).toEqual(
        Array(2).fill('A scene subject checkpoint must contain finite JSON values.'),
      );
      expect(invalidObjects.unchanged).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}
