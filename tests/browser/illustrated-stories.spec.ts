import { test, expect } from '@playwright/test';

for (const [name, values] of [
  ['tesla-circuit', { closed: false }],
  ['thermostat-story', { temperature: 22, target: 22 }],
] as const)
  for (const variant of [false, true]) {
    test(`${name}: character chapter and live drawing share state, framing and rewind ${variant ? 'compact alternate set' : 'wide'}`, async ({
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
      const grid = page.locator('[data-chapter="experiment"] .vs-grid path').first();
      await expect(grid).toBeVisible();
      const gridLines = await grid.getAttribute('d');
      for (const theme of ['dark', 'light']) {
        const inspection = await command([{ type: 'theme', value: theme }]);
        expect(inspection.presentation.clipped).toEqual([]);
        expect(inspection.presentation.unreadableText).toEqual([]);
        const numbers = (value: string) =>
          [...value.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
        const expected = numbers(gridLines!),
          actual = numbers((await grid.getAttribute('d'))!);
        expect(actual).toHaveLength(expected.length);
        actual.forEach((number, index) => expect(number).toBeCloseTo(expected[index]!, 3));
      }
      const paperBounds = await grid.evaluate((path: SVGGraphicsElement) => {
        const drawing = path.ownerSVGElement!,
          grid = path.getBBox(),
          viewport = drawing.viewBox.baseVal;
        return {
          gaps: [
            grid.x - viewport.x,
            grid.y - viewport.y,
            viewport.x + viewport.width - grid.x - grid.width,
            viewport.y + viewport.height - grid.y - grid.height,
          ],
          ratio: viewport.width / viewport.height,
          visibleRatio: drawing.clientWidth / drawing.clientHeight,
          fill: getComputedStyle(path).fill,
          background: getComputedStyle(drawing).backgroundColor,
        };
      });
      expect(Math.max(...paperBounds.gaps)).toBeLessThan(1);
      expect(paperBounds.ratio).toBeCloseTo(paperBounds.visibleRatio, 4);
      expect(paperBounds.fill).toBe('none');
      expect(paperBounds.background).toBe('rgba(0, 0, 0, 0)');
      if (name === 'tesla-circuit') {
        expect(paper.snapshot.content.closed).toBe(false);
        await page
          .getByRole('button', { name: 'Замкнуть или разомкнуть цепь' })
          .filter({ visible: true })
          .press('Enter');
        expect((await command([{ type: 'pause' }])).snapshot.content.closed).toBe(true);
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

for (const theme of ['light', 'dark'] as const)
  test(`quiet lesson records a prediction before revealing feedback: ${theme}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 390, height: 850 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/area-lesson/index.html');
    await page.evaluate(() => window.galleryReady);
    await page.evaluate(async (theme) => {
      const scene = (document.querySelector('.ve-scene') as any).scene;
      await scene.control([
        { type: 'theme', value: theme },
        { type: 'cue', id: 'prediction', progress: 0.5 },
      ]);
    }, theme);
    const trial = page.locator('.ve-prediction');
    const run = trial.getByRole('button', { name: 'Удвоить ширину и проверить' });
    await expect(trial).toBeVisible();
    await expect(run).toBeDisabled();
    await expect(trial.getByRole('status')).not.toContainText('Получилось');
    expect(
      await page.evaluate(
        () => (document.querySelector('.ve-scene') as any).scene.snapshot().content.area,
      ),
    ).toBe(6);
    const choice = trial.getByRole('button', { name: '24 см²', exact: true });
    await choice.focus();
    await choice.press('Enter');
    await expect(choice).toHaveAttribute('aria-pressed', 'true');
    await expect(run).toBeEnabled();
    await expect(trial.getByRole('status')).not.toContainText('Получилось');
    await run.focus();
    await run.press('Enter');
    await expect(trial.getByRole('status')).toContainText('Ваш прогноз: 24 см². Получилось 12 см²');
    await expect(trial.getByRole('status')).toBeFocused();
    const state = await page.evaluate(() =>
      (document.querySelector('.ve-scene') as any).scene.inspect(),
    );
    expect(state.snapshot.content.area).toBe(12);
    await page.getByRole('button', { name: 'Отменить условие', exact: true }).click();
    await expect(run).toBeEnabled();
    await expect(choice).toHaveAttribute('aria-pressed', 'true');
    await expect(trial.getByRole('status')).not.toContainText('Получилось');
    expect(
      await page.evaluate(
        () => (document.querySelector('.ve-scene') as any).scene.snapshot().content.area,
      ),
    ).toBe(6);
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(trial.getByRole('status')).toContainText('Получилось 12 см²');
    const detail = page.locator('.ve-disclosure');
    await detail.locator('summary').focus();
    await detail.locator('summary').press('Enter');
    await expect(detail).toHaveAttribute('open', '');
    await expect(page.locator('[data-area-addition]')).toHaveText('6 + 6 = 6 × 2 = 12 см²');
    await page.getByRole('button', { name: 'Отменить условие', exact: true }).click();
    await expect(detail).not.toHaveAttribute('open', '');
    await page.getByRole('button', { name: 'Попробовать свои стороны' }).click();
    await expect(trial).toBeHidden();
    const height = page.getByRole('slider', { name: 'Высота, см', exact: true });
    for (const value of ['4', '1', '3', '5']) await height.fill(value);
    await expect
      .poll(() =>
        page.evaluate(
          () => (document.querySelector('.ve-scene') as any).scene.snapshot().content.area,
        ),
      )
      .toBe(30);
    await page.evaluate(async () =>
      (document.querySelector('.ve-scene') as any).scene.control([
        { type: 'cue', id: 'prediction', progress: 0.5 },
      ]),
    );
    await expect(trial).toBeVisible();
    await expect(run).toBeDisabled();
    await expect(trial.getByRole('status')).not.toContainText('Получилось');
    await expect(detail).not.toHaveAttribute('open', '');
    await expect(page.locator('[data-area-reading]')).toContainText('только ширину');
    expect(errors).toEqual([]);
  });
