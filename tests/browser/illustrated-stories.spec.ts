import { test, expect } from '@playwright/test';

for (const [name, values] of [
  ['tesla-circuit', { closed: false }],
  ['area-notebook', { width: 6, height: 5 }],
  ['thermostat-story', { temperature: 22, target: 22 }],
] as const)
  for (const variant of [false, true]) {
    test(`${name}: narrated world and live page share state, framing and rewind ${variant ? 'compact alternate set' : 'wide'}`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.setViewportSize({ width: variant ? 375 : 1000, height: 800 });
      await page.goto(`/${name}/index.html${variant ? '?variant' : ''}`);
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
      expect(close.snapshot.content.surfaces.board.visible).toBe(true);
      expect(close.presentation.clipped).toEqual([]);
      expect(close.presentation.unreadableText).toEqual([]);
      await command([{ type: 'cue', id: 'experiment.change', progress: 0.8 }]);
      const rewind = await command([{ type: 'cue', id: 'workshop.explain', progress: 0.65 }]);
      expect(rewind.snapshot).toEqual(close.snapshot);
      for (const progress of [0.4, 0.8]) {
        const idea = await command([{ type: 'cue', id: 'workshop.idea', progress }]);
        const { bounds, camera } = idea.snapshot.content;
        // The complete discovery gesture, including the bulb above the head, stays in frame.
        expect(bounds.hero.x).toBeGreaterThanOrEqual(camera.x);
        expect(bounds.hero.y).toBeGreaterThanOrEqual(camera.y);
        expect(bounds.hero.x + bounds.hero.width).toBeLessThanOrEqual(camera.x + camera.width);
        expect(bounds.hero.y + bounds.hero.height).toBeLessThanOrEqual(camera.y + camera.height);
        expect(idea.presentation.unreadableText).toEqual([]);
      }
      const paper = await command([
        { type: 'parameters', values: { chapter: 'experiment', sceneTime: 1, ...values } },
      ]);
      expect(paper.mode).toBe('explore');
      for (const theme of ['dark', 'light']) {
        const inspection = await command([{ type: 'theme', value: theme }]);
        expect(inspection.presentation.clipped).toEqual([]);
        expect(inspection.presentation.unreadableText).toEqual([]);
      }
      if (name === 'tesla-circuit') {
        expect(paper.snapshot.content.closed).toBe(false);
        await page
          .getByRole('button', { name: 'Замкнуть или разомкнуть цепь' })
          .filter({ visible: true })
          .press('Enter');
        expect((await command([{ type: 'pause' }])).snapshot.content.closed).toBe(true);
      }
      if (name === 'area-notebook') {
        expect(paper.snapshot.content.area).toBe(30);
        expect(paper.snapshot.content.gridStep * 2).toBe(paper.snapshot.content.pixelsPerCm);
      }
      if (name === 'thermostat-story')
        expect(paper.snapshot.content.conclusion).toBe('Нагрев выключен');
      expect(errors).toEqual([]);
    });
  }

test('an interactive control on the world plane edits the same parameter as its paper page', async ({
  page,
}) => {
  await page.goto('/tesla-circuit/index.html');
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
