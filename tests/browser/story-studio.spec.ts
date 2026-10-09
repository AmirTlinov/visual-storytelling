import { test, expect } from '@playwright/test';

test('the area lesson keeps its measure and nearby reasoning through chapters, theme and resize', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await page.goto('/area-lesson/index.html');
  await page.evaluate(() => window.galleryReady);
  const sample = (id: string, progress = 0.6) =>
    page.evaluate(
      async ({ id, progress }) => {
        const scene = (document.querySelector('.ve-scene') as any).scene;
        await scene.control([{ type: 'cue', id, progress }]);
        return scene.snapshot();
      },
      { id, progress },
    );
  const unit = await sample('unit', 0);
  expect(unit.content.area).toBe(1);
  expect(unit.content.visibleUnits).toBe(1);
  expect(unit.content.pixelsPerCm).toBeGreaterThan(100);
  await expect(page.locator('[data-area-reading]')).toContainText('один см²');
  const firstRow = await sample('rows.row');
  expect(firstRow.content.rowUnits).toEqual([3, 3]);
  expect(firstRow.content.visibleUnits).toBe(3);
  const repeated = await sample('rows.repeat', 0.9);
  expect(repeated.content.visibleUnits).toBe(6);
  await sample('rows.rule');
  await expect(page.locator('[data-area-reading]')).toContainText('2 ряда');
  await page.evaluate(async () =>
    (document.querySelector('.ve-scene') as any).scene.control([
      { type: 'cue', id: 'experiment', progress: 1 },
      { type: 'mode', value: 'explore' },
    ]),
  );
  const active = page.locator('[data-chapter]:not([hidden])');
  await page.getByRole('slider', { name: 'Ширина, см', exact: true }).fill('6');
  await page.getByRole('slider', { name: 'Высота, см', exact: true }).fill('5');
  const grid = active.locator('.vs-grid path').first();
  const lines = await grid.getAttribute('d');
  for (const theme of ['dark', 'light', 'dark']) {
    const state = await page.evaluate(async (theme) => {
      const scene = (document.querySelector('.ve-scene') as any).scene;
      await scene.setTheme(theme);
      return { snapshot: scene.snapshot(), presentation: scene.presentation() };
    }, theme);
    expect(state.snapshot.content.area).toBe(30);
    expect(state.snapshot.content.gridStep * 2).toBe(state.snapshot.content.pixelsPerCm);
    expect(state.presentation.unreadableText).toEqual([]);
    expect(state.presentation.clipped).toEqual([]);
    await expect(grid).toHaveAttribute('d', lines!);
  }
  await page.setViewportSize({ width: 1000, height: 850 });
  await expect.poll(async () => (await grid.getAttribute('d')) !== lines).toBe(true);
  const wide = await page.evaluate(() =>
    (document.querySelector('.ve-scene') as any).scene.presentation(),
  );
  expect(wide.unreadableText).toEqual([]);
  expect(wide.clipped).toEqual([]);
  const layout = await page.locator('.ve-explanation').evaluate((element) => {
    const figure = element.querySelector('.ve-explanation-figure')!.getBoundingClientRect(),
      notes = element.querySelector('.ve-explanation-notes')!.getBoundingClientRect();
    return {
      figureRight: figure.right,
      notesLeft: notes.left,
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  expect(layout.notesLeft).toBeGreaterThan(layout.figureRight);
  expect(layout.overflow).toBe(false);
  const returned = await sample('unit', 0);
  expect(returned.content.area).toBe(unit.content.area);
  expect(returned.content.visibleUnits).toBe(unit.content.visibleUnits);
});

for (const variant of ['', '?variant=mira'])
  test(`portable interaction and physics rewind retain their own state ${variant}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/character-lesson/index.html' + variant);
    await page.evaluate(() => window.galleryReady);
    const cues = await page.evaluate(() => {
      const scene = (document.querySelector('.ve-scene') as any).scene;
      return Object.fromEntries(scene.review().cues.map((cue: any) => [cue.id, cue]));
    });
    const sample = (time: number) =>
      page.evaluate(async (t) => {
        const scene = (document.querySelector('.ve-scene') as any).scene;
        await scene.control([{ type: 'seek', time: t }]);
        return { state: scene.snapshot(), presentation: scene.presentation() };
      }, time);
    const contact = await page.evaluate(async () => {
      const scene = (document.querySelector('.ve-scene') as any).scene;
      const cue = scene.review().cues.find((cue: { id: string }) => cue.id === 'letter.switch');
      // Route length determines approach time. Observe activation during real hand contact.
      for (let step = 1; step < 24; step++) {
        const time = cue.start + ((cue.end - cue.start) * step) / 24;
        await scene.control([{ type: 'seek', time }]);
        const state = scene.snapshot();
        const press = state.content.world.actors.hero.contacts.find(
          (c: { kind: string }) => c.kind === 'press',
        );
        if (state.content.world.objects.meter === 1 && press?.error < 0.01)
          return { time, state, presentation: scene.presentation() };
      }
      throw new Error('The device never activated during hand contact');
    });
    expect(contact.state.chapter).toBe('letter');
    expect(contact.state.content.world.objects.meter).toBe(1);
    expect(contact.state.content.world.items.hero.id).toBe('letter');
    expect(contact.presentation.clipped).toEqual([]);
    const pullback = await sample(cues['letter.put'].start + 0.15);
    expect(pullback.state.content.framing.changingShot).toBe(true);
    expect(pullback.presentation.clipped).toEqual([]);
    const wide = await sample(cues['letter.put'].start + 0.5);
    expect(wide.state.content.framing.changingShot).toBe(false);
    expect(wide.state.content.framing.clipped).toEqual([]);
    expect(wide.presentation.clipped).toEqual([]);
    const seated = await sample(cues['letter.sit'].end - 0.1);
    expect(seated.state.content.world.actors.hero.seated).toBeGreaterThan(0.98);
    expect(seated.state.content.world.actors.friend.seated).toBeGreaterThan(0.98);
    expect(
      Math.abs(
        seated.state.content.world.actors.hero.at.x - seated.state.content.world.actors.friend.at.x,
      ),
    ).toBeGreaterThan(1);
    const sampleTime = cues.experiment.start + (cues.experiment.end - cues.experiment.start) * 0.4;
    const first = await sample(sampleTime);
    expect(first.state.chapter).toBe('experiment');
    await sample(cues.experiment.start + (cues.experiment.end - cues.experiment.start) * 0.8);
    const rewound = await sample(sampleTime);
    expect(rewound.state.content).toEqual(first.state.content);
    expect((await sample(contact.time)).state).toEqual(contact.state);
    expect(errors).toEqual([]);
  });
