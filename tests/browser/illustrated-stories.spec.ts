import { test, expect } from '@playwright/test';
import sharp from 'sharp';

for (const { name, cue, world } of [
  { name: 'tesla-circuit', cue: 'experiment', world: true },
  { name: 'interaction-studio', cue: 'measure', world: true },
  { name: 'tlinov-book', cue: 'book-open', world: false },
])
  test(`${name}: the story establishes a room and enters its opaque notebook page`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/${name}/index.html`);
    await page.evaluate(() => window.galleryReady);
    const seek = (time: number) =>
      page.evaluate(async (time) => {
        await (document.querySelector('.ve-scene') as any).scene.control([
          { type: 'pause' },
          { type: 'seek', time },
        ]);
      }, time);
    const frame = page.locator('.ve-frame');
    const pixels = async () => {
      const box = (await frame.boundingBox())!;
      // Exclude the outer CSS-scaled aperture's subpixel antialiasing, not page content.
      return page.screenshot({
        clip: { x: box.x + 2, y: box.y + 2, width: box.width - 4, height: box.height - 4 },
      });
    };
    const active = page.locator('[data-chapter]:not([hidden])');
    const opening = page.locator('[data-book-transition]');
    const start = await page.evaluate(async (cue) => {
      const scene = (document.querySelector('.ve-scene') as any).scene;
      await scene.control([{ type: 'pause' }, { type: 'cue', id: cue, progress: 0 }]);
      return scene.inspect().time;
    }, cue);
    if (world) {
      await seek(0);
      await expect(opening).toBeHidden();
      await expect(active).not.toHaveAttribute('inert');
    }
    for (const time of [0, 1.8, 3.9]) {
      await seek(start + time);
      await expect(opening).toBeVisible();
      await expect(opening).toHaveAttribute('data-book-phase', 'enter');
      await expect(active).toHaveAttribute('inert', '');
      const visibleChapter = await pixels();
      await active.evaluate((element: HTMLElement) => {
        element.style.visibility = 'hidden';
      });
      const hiddenChapter = await pixels();
      await active.evaluate((element: HTMLElement) => {
        element.style.visibility = '';
      });
      // Changing what is behind the notebook cannot change any opening-shot pixel.
      if (!hiddenChapter.equals(visibleChapter)) {
        await testInfo.attach(`visible-${time}`, {
          body: visibleChapter,
          contentType: 'image/png',
        });
        await testInfo.attach(`hidden-${time}`, { body: hiddenChapter, contentType: 'image/png' });
      }
      expect(hiddenChapter.equals(visibleChapter), `opaque page at ${time}s`).toBe(true);
    }
    await seek(start + 4.2 - 0.000001);
    const arrived = await pixels();
    await seek(start + 4.2);
    await expect(opening).toBeHidden();
    await expect(active).not.toHaveAttribute('inert');
    const live = await pixels();
    const [a, b] = await Promise.all([
      sharp(arrived).removeAlpha().raw().toBuffer(),
      sharp(live).removeAlpha().raw().toBuffer(),
    ]);
    const error = a.reduce((sum, channel, i) => sum + Math.abs(channel - b[i]!), 0) / a.length;
    if (error >= 2) {
      await testInfo.attach('page-arrival', { body: arrived, contentType: 'image/png' });
      await testInfo.attach('page-live', { body: live, contentType: 'image/png' });
    }
    // Raster antialiasing may differ; the drawing and grid must not move at handoff.
    expect(error, 'notebook-to-live pixel registration').toBeLessThan(2);
    await seek(start + 1.8);
    await page.locator('[data-mode=explore]').click();
    await expect(opening).toBeHidden();
    await expect(active).not.toHaveAttribute('inert');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seek(start + 1.8);
    await expect(opening).toBeHidden();
    await page.evaluate(async () => {
      await (document.querySelector('.ve-scene') as any).scene.control([
        { type: 'reduced', value: false },
      ]);
    });
    await seek(start + 1.8);
    const overridden = await pixels();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await seek(start + 1.8);
    const restored = await pixels();
    if (!restored.equals(overridden)) {
      await testInfo.attach('overridden', { body: overridden, contentType: 'image/png' });
      await testInfo.attach('restored', { body: restored, contentType: 'image/png' });
    }
    expect(restored.equals(overridden)).toBe(true);
  });

test('book transitions suspend page input and restore it for explore, rewind and reduced motion', async ({
  page,
}) => {
  await page.goto('/tesla-circuit/index.html');
  await page.evaluate(() => window.galleryReady);
  const control = (commands: unknown[]) =>
    page.evaluate(async (commands) => {
      await (document.querySelector('#story') as any).scene.control(commands);
    }, commands);
  const active = page.locator('[data-chapter]:not([hidden])');
  const switchButton = page.getByRole('button', { name: 'Замкнуть или разомкнуть цепь' });
  const coveredInput = async () => {
    // Browser input and focus honor inert; a DOM role query still finds the covered SVG.
    const pressed = await switchButton.getAttribute('aria-pressed');
    expect(
      await switchButton.evaluate((element: SVGElement) => {
        element.focus();
        return document.activeElement === element;
      }),
    ).toBe(false);
    const box = (await switchButton.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(switchButton).toHaveAttribute('aria-pressed', pressed!);
  };
  await control([{ type: 'pause' }, { type: 'seek', time: 0 }]);
  await expect(active).not.toHaveAttribute('inert');
  await control([{ type: 'cue', id: 'workshop.explain', progress: 0.7 }]);
  await expect(active).not.toHaveAttribute('inert');
  await expect(switchButton).toHaveCount(1);
  await switchButton.focus();
  await control([{ type: 'cue', id: 'experiment', progress: 0 }]);
  await expect(active).toHaveAttribute('inert', '');
  await coveredInput();
  await page.locator('[data-mode=explore]').click();
  await expect(active).not.toHaveAttribute('inert');
  await expect(switchButton).toHaveCount(1);
  const before = await switchButton.getAttribute('aria-pressed');
  await switchButton.press('Enter');
  await expect(switchButton).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');
  await control([{ type: 'seek', time: 0 }]);
  await expect(active).not.toHaveAttribute('inert');
  await control([{ type: 'cue', id: 'experiment', progress: 0 }]);
  await expect(active).toHaveAttribute('inert', '');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await control([{ type: 'cue', id: 'experiment', progress: 0 }]);
  await expect(active).not.toHaveAttribute('inert');
  await expect(switchButton).toHaveCount(1);
});

test('page curl keeps its perspective after rewinding through different notebook zooms', async ({
  page,
}) => {
  await page.goto('/interaction-studio/index.html');
  await page.evaluate(() => window.galleryReady);
  const times = await page.evaluate(() =>
    Object.fromEntries(
      (document.querySelector('.ve-scene') as any).scene
        .review()
        .cues.map((cue: any) => [cue.id, cue.start]),
    ),
  );
  const seek = (time: number) =>
    page.evaluate(async (time) => {
      await (document.querySelector('.ve-scene') as any).scene.control([
        { type: 'pause' },
        { type: 'seek', time },
      ]);
    }, time);
  await seek(times.measure + 1.8);
  await seek(times.experiment + 0.36);
  const first = await page.locator('.ve-frame').screenshot();
  await seek(times.measure + 4.199);
  await seek(times.experiment + 0.36);
  expect((await page.locator('.ve-frame').screenshot()).equals(first)).toBe(true);
});

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
      const grid = page.locator('[data-chapter="experiment"] .vs-grid path');
      await expect(grid).toBeVisible();
      const gridLines = await grid.getAttribute('d');
      for (const theme of ['dark', 'light']) {
        const inspection = await command([{ type: 'theme', value: theme }]);
        expect(inspection.presentation.clipped).toEqual([]);
        expect(inspection.presentation.unreadableText).toEqual([]);
        await expect(grid).toHaveAttribute('d', gridLines!);
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
