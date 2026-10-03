import { test, expect } from '@playwright/test';

async function ready(page, file) {
  await page.goto(`/physical-objects/${file}.html`);
  await page.evaluate(async () => {
    await window.galleryReady;
    await document.fonts.ready;
  });
}
const state = (page) => page.evaluate(() => document.querySelector('.ve-scene').scene.snapshot());
const seek = (page, time) =>
  page.evaluate((t) => document.querySelector('.ve-scene').scene.seek(t), time);

test('ink deformation preserves a partial stroke reveal and releases removed drawing ids', async ({
  page,
}) => {
  await ready(page, 'index');
  const result = await page.evaluate(() => {
    const { view } = document.querySelector('.ve-scene').scene;
    const drawing = view.pen.line(view.layer, 'changing-line', [0, 0], [80, 0]);
    drawing.reveal(0.4);
    const path = drawing.element.querySelector('path');
    const ratio = () => Number(path.style.strokeDashoffset) / path.getTotalLength();
    const before = ratio();
    drawing.update('M0 0L240 0');
    const after = ratio();
    drawing.update('M0 0L0 0');
    const collapsed = [...drawing.element.querySelectorAll('path')].every(
      (path) => !path.style.strokeDashoffset.includes('NaN'),
    );
    drawing.element.remove();
    const replacement = view.pen.line(view.layer, 'changing-line', [0, 0], [80, 0]);
    const reused = replacement.element.isConnected;
    replacement.dispose();
    drawing.dispose();
    return { before, after, reused, collapsed };
  });
  expect(result.after).toBeCloseTo(result.before, 5);
  expect(result.reused).toBe(true);
  expect(result.collapsed).toBe(true);
});

for (const file of ['index', 'three'])
  test(`${file}: repeat restores the experiment; removing its view releases physical bodies`, async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await ready(page, file);
    const initial = await state(page);
    await seek(page, 3);
    await page.evaluate(() => {
      const scene = document.querySelector('.ve-scene').scene;
      for (const body of scene.bodies) body.rigid.sleep();
      if (!scene.world.sleeping) throw new Error('Expected a settled world');
      document.querySelector('[data-play]').click();
      scene.pause(false);
    });
    expect(await state(page)).toEqual(initial);
    const remaining = await page.evaluate(() => {
      const scene = document.querySelector('.ve-scene').scene;
      scene.view.dispose();
      scene.view.dispose();
      scene.world.step();
      const state = {
        bodies: scene.world.size,
        removed: scene.bodies.every((body) => body.disposed),
      };
      scene.dispose();
      return state;
    });
    expect(remaining).toEqual({ bodies: 0, removed: true });
    expect(errors).toEqual([]);
  });

test('removing another body preserves a 3D grab; removing the grabbed body restores the camera', async ({
  page,
}) => {
  await ready(page, 'three');
  await seek(page, 2);
  const point = await page.evaluate(() => {
    const scene = document.querySelector('.ve-scene').scene;
    for (const body of scene.bodies) body.rigid.sleep();
    const p = scene.bodies[2].mesh.position.clone().project(scene.view.camera);
    const rect = scene.view.renderer.domElement.getBoundingClientRect();
    return { x: rect.x + ((p.x + 1) * rect.width) / 2, y: rect.y + ((1 - p.y) * rect.height) / 2 };
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  expect(
    await page.evaluate(() => document.querySelector('.ve-scene').scene.world.time),
  ).toBeGreaterThan(1.99);
  expect(
    await page.evaluate(() => {
      const scene = document.querySelector('.ve-scene').scene;
      scene.bodies[0].dispose();
      return scene.view.controls.enabled;
    }),
  ).toBe(false);
  expect(
    await page.evaluate(() => {
      const scene = document.querySelector('.ve-scene').scene;
      scene.bodies[2].dispose();
      return scene.view.controls.enabled;
    }),
  ).toBe(true);
  await page.mouse.up();
  await page.evaluate(() => document.querySelector('.ve-scene').scene.dispose());
});

test('replacing the 3D subject releases its physics and attached annotations', async ({ page }) => {
  await ready(page, 'three');
  const result = await page.evaluate(() => {
    const scene = document.querySelector('.ve-scene').scene;
    const original = scene.bodies[0].mesh;
    const next = new original.constructor(original.geometry.clone(), original.material.clone());
    scene.view.setObject(next);
    scene.world.step();
    return {
      bodies: scene.world.size,
      removed: scene.bodies.every((body) => body.disposed),
      annotations: document.querySelectorAll('.ve-label,.ve-surface-label').length,
    };
  });
  expect(result).toEqual({ bodies: 0, removed: true, annotations: 0 });
  await page.evaluate(() => document.querySelector('.ve-scene').scene.dispose());
});

test('physical ink keeps its material through grabs, keyboard input, pause and reset', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const [width, colorScheme] of [
    [960, 'light'],
    [375, 'dark'],
  ]) {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await ready(page, 'index');
    const initial = await state(page);
    await seek(page, 2);
    const soft = page.locator('[data-physical-body="material-2"]');
    const before = (await state(page))[2].position;
    const box = await soft.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 20, box.y - 55, { steps: 8 });
    await expect
      .poll(async () => Math.abs((await state(page))[2].position[1] - before[1]))
      .toBeGreaterThan(0.2);
    await page.mouse.up();
    await page.locator('[data-play]').click();
    const paused = await state(page);
    await page.waitForTimeout(100);
    expect(await state(page)).toEqual(paused);
    await page.getByRole('button', { name: 'Сначала', exact: true }).click();
    expect(await state(page)).toEqual(initial);
    await page.locator('[data-physical-body="material-0"]').press('ArrowRight');
    await expect(page.locator('[data-player]')).toHaveAttribute('data-playing', 'true');
    await expect
      .poll(async () => (await state(page))[0].position[0])
      .toBeGreaterThan(initial[0].position[0] + 0.02);
    await seek(page, 0.65);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page
      .locator('.ve-scene')
      .screenshot({ path: `artifacts/physics/2d-${colorScheme}-${width}.png` });
    await page.evaluate(() => document.querySelector('.ve-scene').scene.dispose());
  }
  expect(errors).toEqual([]);
});

test('3D deformation preserves render geometry and releases capture on reset', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page, 'three');
  await page.evaluate(() => {
    const scene = document.querySelector('.ve-scene').scene;
    window.originalMeshParts = scene.bodies.map(({ mesh }) => ({
      material: mesh.material,
      uv: mesh.geometry.attributes.uv,
      index: mesh.geometry.index,
    }));
  });
  await seek(page, 2);
  const original = await state(page);
  for (const index of [0, 2, 2]) {
    const point = await page.evaluate((index) => {
      const scene = document.querySelector('.ve-scene').scene;
      const p = scene.bodies[index].mesh.position.clone().project(scene.view.camera);
      const rect = scene.view.renderer.domElement.getBoundingClientRect();
      return {
        x: rect.x + ((p.x + 1) * rect.width) / 2,
        y: rect.y + ((1 - p.y) * rect.height) / 2,
      };
    }, index);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    expect(
      await page.evaluate(() => document.querySelector('.ve-scene').scene.view.controls.enabled),
    ).toBe(false);
    await page.mouse.move(point.x - 20, point.y - 70, { steps: 8 });
    await expect
      .poll(async () => (await state(page))[index].position[1])
      .toBeGreaterThan(original[index].position[1] + 0.15);
    if (index === 0) {
      expect(
        await page.evaluate(() => {
          const scene = document.querySelector('.ve-scene').scene;
          const snapshot = scene.world.snapshot();
          scene.world.restore(snapshot);
          return scene.world.raw.bodies.len();
        }),
      ).toBe(4); // A snapshot excludes the temporary cursor body and its joint.
    }
    await seek(page, 2); // Reset while the pointer is still held.
    await page.mouse.up();
    expect(
      await page.evaluate(() => document.querySelector('.ve-scene').scene.view.controls.enabled),
    ).toBe(true);
    expect(await state(page)).toEqual(original);
  }
  expect(
    await page.evaluate(() =>
      document.querySelector('.ve-scene').scene.bodies.every(({ mesh }, i) => {
        const original = window.originalMeshParts[i];
        return (
          mesh.material === original.material &&
          mesh.geometry.attributes.uv === original.uv &&
          mesh.geometry.index === original.index
        );
      }),
    ),
  ).toBe(true);
  for (const [width, colorScheme] of [
    [960, 'light'],
    [375, 'dark'],
  ]) {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ colorScheme });
    await seek(page, 0.65);
    await page
      .locator('.ve-scene')
      .screenshot({ path: `artifacts/physics/3d-${colorScheme}-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  }
  await page.evaluate(() => document.querySelector('.ve-scene').scene.dispose());
  expect(errors).toEqual([]);
});
