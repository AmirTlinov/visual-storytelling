import { fixturePage, openFixture } from '../support/fixture.mjs';
import { test, expect } from '@playwright/test';

for (const [name, values] of [['chapters', { closed: false }]] as const)
  for (const variant of [false, true]) {
    test(`${name}: character chapter and live drawing share state, framing and rewind ${variant ? 'compact alternate set' : 'wide'}`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.setViewportSize({ width: variant ? 375 : 1000, height: 800 });
      await page.goto((await fixturePage(name)) + (variant ? '?variant' : ''));
      await page.evaluate(() => window.galleryReady);
      const command = (commands: unknown[]) =>
        page.evaluate(async (commands) => {
          const scene = (document.querySelector('#story') as any).scene;
          await scene.control(commands);
          return scene.inspect();
        }, commands);
      const close = await command([
        { type: 'pause' },
        { type: 'cue', id: 'workshop.explain', progress: 0.65 },
      ]);
      const root = page.locator('#story');
      const sheet = page.locator('.ve-scene-content');
      await expect(root).toHaveAttribute('data-presentation', 'stage');
      await expect(root).toHaveAttribute('data-paper', 'false');
      await expect(sheet).toHaveCSS('padding', '0px');
      await expect(sheet).toHaveCSS('background-image', 'none');
      await expect(sheet.locator('.ve-heading')).toBeHidden();
      await expect(sheet.locator('.ve-scene-toolbar, .ve-parameters, .ve-player')).toHaveCount(0);
      const stageFrame = await sheet.evaluate((element) => {
        const frame = element.getBoundingClientRect();
        const aperture = element.querySelector('.ve-character-aperture')!.getBoundingClientRect();
        (window as any).originalPlayer = document.querySelector('.ve-player');
        return ['x', 'y', 'width', 'height'].map((key) =>
          Math.abs(
            (frame[key as keyof DOMRect] as number) - (aperture[key as keyof DOMRect] as number),
          ),
        );
      });
      expect(Math.max(...stageFrame)).toBeLessThan(0.1);
      expect(
        close.snapshot.content.camera.width / close.snapshot.content.camera.height,
      ).toBeCloseTo(16 / 9, 5);
      expect(close.snapshot.content.surfaces.board.visible).toBe(true);
      expect(close.presentation.clipped).toEqual([]);
      if (!variant) expect(close.presentation.unreadableText).toEqual([]);
      const navigation = root.locator('.ve-chapter-navigation .ve-select-trigger');
      await expect(navigation).toBeVisible();
      await navigation.click();
      await navigation.press('End');
      await navigation.press('Enter');
      await expect(root).toHaveAttribute('data-presentation', 'explanation');
      await expect(navigation).toBeFocused();
      await command([{ type: 'cue', id: 'experiment.change', progress: 0.8 }]);
      await expect(root).toHaveAttribute('data-presentation', 'explanation');
      await expect(root).toHaveAttribute('data-paper', 'true');
      await expect(sheet.locator('.ve-heading')).toBeVisible();
      const explanationControls = variant
        ? root.getByRole('dialog', { name: 'Условия объяснения' })
        : sheet;
      await expect(explanationControls.locator('.ve-scene-toolbar')).toHaveCount(1);
      await expect(explanationControls.locator('.ve-parameters')).toHaveCount(1);
      await navigation.click();
      await navigation.press('Home');
      await navigation.press('Enter');
      await expect(root).toHaveAttribute('data-presentation', 'stage');
      await expect(navigation).toBeFocused();
      const rewind = await command([{ type: 'cue', id: 'workshop.explain', progress: 0.65 }]);
      expect(rewind.snapshot).toEqual(close.snapshot);
      await expect(root).toHaveAttribute('data-presentation', 'stage');
      expect(
        await page.evaluate(
          () => document.querySelector('.ve-player') === (window as any).originalPlayer,
        ),
      ).toBe(true);
      await expect(page.locator('.ve-player')).toHaveCount(1);
      if (!variant)
        await page
          .locator('[data-scene-frame]')
          .screenshot({ path: `artifacts/frame-consistency/${name}-stage.png` });
      for (const progress of [0.4, 0.8]) {
        const idea = await command([{ type: 'cue', id: 'workshop.idea', progress }]);
        const { bounds, camera } = idea.snapshot.content;
        // The complete discovery gesture, including the bulb above the head, stays in frame.
        expect(bounds.hero.x).toBeGreaterThanOrEqual(camera.x);
        expect(bounds.hero.y).toBeGreaterThanOrEqual(camera.y);
        expect(bounds.hero.x + bounds.hero.width).toBeLessThanOrEqual(camera.x + camera.width);
        expect(bounds.hero.y + bounds.hero.height).toBeLessThanOrEqual(camera.y + camera.height);
        if (!variant) expect(idea.presentation.unreadableText).toEqual([]);
      }
      const paper = await command([
        { type: 'parameters', values: { chapter: 'experiment', sceneTime: 1, ...values } },
      ]);
      expect(paper.mode).toBe('explore');
      const measurementGrid = page.locator('[data-chapter="experiment"] .vs-grid');
      const grid = () =>
        measurementGrid.locator('path').evaluateAll((paths) =>
          paths.map((path) => ({
            shape: path.getAttribute('d'),
            transform: path.getAttribute('transform'),
          })),
        );
      const paperGrid = await grid();
      expect(paperGrid.length).toBeGreaterThan(0);
      // The drawing owns its grid and units; the shell does not add a second grid behind it.
      await expect(measurementGrid).toBeVisible();
      await expect(sheet).toHaveCSS('background-image', 'none');
      for (const theme of ['dark', 'light']) {
        const inspection = await command([{ type: 'theme', value: theme }]);
        expect(inspection.presentation.clipped).toEqual([]);
        expect(
          inspection.presentation.frame.width / inspection.presentation.frame.height,
        ).toBeCloseTo(16 / 9, 4);
        if (!variant) expect(inspection.presentation.unreadableText).toEqual([]);
        await expect(measurementGrid).toBeVisible();
        await expect(sheet).toHaveCSS('background-image', 'none');
        expect(await grid()).toEqual(paperGrid);
      }
      if (variant) {
        // Expanding the same fixed composition restores reading size without changing its model.
        await page.setViewportSize({ width: 1040, height: 800 });
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        const expanded = await command([{ type: 'pause' }]);
        expect(expanded.snapshot).toEqual(paper.snapshot);
        expect(expanded.presentation.unreadableText).toEqual([]);
        await page.setViewportSize({ width: 375, height: 800 });
      }
      if (name === 'chapters') {
        expect(paper.snapshot.content.closed).toBe(false);
        await page
          .getByRole('button', { name: 'Замкнуть или разомкнуть цепь' })
          .filter({ visible: true })
          .press('Enter');
        expect((await command([{ type: 'pause' }])).snapshot.content.closed).toBe(true);
      }
      expect(errors).toEqual([]);
    });
  }

test('an interactive control on the world plane edits the same parameter as its paper page', async ({
  page,
}) => {
  await openFixture(page, 'chapters');
  await page.evaluate(() => window.galleryReady);
  await page.evaluate(async () => {
    const s = (document.querySelector('#story') as any).scene;
    await s.control([{ type: 'cue', id: 'workshop.explain', progress: 0.7 }]);
  });
  const switchButton = page
    .getByRole('button', { name: 'Замкнуть или разомкнуть цепь' })
    .filter({ visible: true });
  await expect(switchButton).toHaveAttribute('aria-pressed', 'false');
  await switchButton.click();
  await expect(switchButton).toHaveAttribute('aria-pressed', 'true');
  const state = await page.evaluate(() =>
    (document.querySelector('#story') as any).scene.inspect(),
  );
  expect(state.mode).toBe('explore');
  expect(state.parameters.find((p: any) => p.key === 'closed').value).toBe(true);
});
