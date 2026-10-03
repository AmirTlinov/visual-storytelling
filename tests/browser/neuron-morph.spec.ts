import { test, expect } from '@playwright/test';
import type { Viewport3D } from '../../src/viewport/three.js';

test('the signed neuron keeps its result through orbit, projection changes and repeated input', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/neuron-morph/index.html');
  await page.evaluate(() => window.galleryReady);
  const player = await page.locator('.ve-player').boundingBox();
  expect(player!.y + player!.height).toBeLessThanOrEqual(720);
  // Preparation may itself draw a probe; establish the displayed scene before taking its baseline.
  await page.locator('.neuron-volume canvas').screenshot();
  const rendererInfo = () =>
    page.evaluate(() => {
      const root = document.getElementById('neuron-scene') as HTMLElement & {
        scene: { view: ReturnType<typeof Viewport3D.mount> };
      };
      const info = root.scene.view.renderer.info;
      return {
        frame: info.render.frame,
        programs: (info.programs ?? []).map((program) => program.id),
      };
    });
  await expect.poll(async () => (await rendererInfo()).frame).toBeGreaterThan(0);
  const preparedPrograms = (await rendererInfo()).programs;
  expect(preparedPrograms.length).toBeGreaterThan(0);
  const seekWithoutCompilation = async (time: string) => {
    const before = (await rendererInfo()).frame;
    await page.locator('[data-seek]').fill(time);
    // Wait for the new state to reach the renderer, then compare actual program identities.
    await expect.poll(async () => (await rendererInfo()).frame).toBeGreaterThan(before);
    expect((await rendererInfo()).programs).toEqual(preparedPrograms);
  };
  await seekWithoutCompilation('11');
  await expect(page.locator('.neuron-volume')).toContainText('2 × (−0.5)');
  await seekWithoutCompilation('21');
  const result = page.locator('.neuron-volume .ve-surface-label').filter({ hasText: /^−4$/ });
  await expect(result).toBeVisible();
  await seekWithoutCompilation('7');
  await seekWithoutCompilation('21');
  const area = (await page.locator('.neuron-volume canvas').boundingBox())!;
  const x = area.x + area.width * 0.45,
    y = area.y + area.height * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + area.height * 0.55, y, { steps: 12 });
  await page.mouse.up();
  await expect(result).toBeVisible();
  await page.getByRole('radio', { name: 'Плоскость', exact: true }).check();
  const flat = page.locator('.neuron-flat');
  await expect(flat.locator('.vs-lettering[aria-label="(−1) + (−3) + 0 = −4"]')).toBeVisible();
  await page.locator('[data-mode=explore]').click();
  for (const value of ['4', '-2', '2'])
    await page.getByRole('spinbutton', { name: 'Вход 3', exact: true }).fill(value);
  await expect(flat.locator('.vs-lettering[aria-label="(−1) + (−3) + 4 = 0"]')).toBeVisible();
  await page.locator('[data-mode=story]').click();
  await expect(flat.locator('.vs-lettering[aria-label="(−1) + (−3) + 0 = −4"]')).toBeVisible();
  await page.locator('[data-seek]').fill('7');
  await page.locator('[data-seek]').fill('21');
  await expect(flat.locator('.vs-lettering[aria-label="(−1) + (−3) + 0 = −4"]')).toBeVisible();
  await page.setViewportSize({ width: 375, height: 720 });
  let stageY: number | undefined;
  let playerY: number | undefined;
  for (const time of ['0', '14', '21']) {
    await page.locator('[data-seek]').fill(time);
    const stage = (await page.locator('.ve-stage').boundingBox())!;
    const player = (await page.locator('.ve-player').boundingBox())!;
    stageY ??= stage.y;
    playerY ??= player.y;
    expect(stage.y).toBeCloseTo(stageY, 1);
    expect(player.y).toBeCloseTo(playerY, 1);
    expect(player.y + player.height).toBeLessThanOrEqual(720);
  }
  expect(errors).toEqual([]);
});
