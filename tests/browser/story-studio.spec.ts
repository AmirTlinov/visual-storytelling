import { test, expect } from '@playwright/test';

test('the measured Ink chapter keeps its grid and readable labels through input, theme and resize', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await page.goto('/tlinov-book/index.html');
  await page.evaluate(() => window.galleryReady);
  await page.locator('[data-mode=explore]').click();
  const active = page.locator('[data-chapter]:not([hidden])');
  await page.getByRole('slider', { name: 'Ширина, см', exact: true }).fill('6');
  await page.getByRole('slider', { name: 'Высота, см', exact: true }).fill('5');
  const grid = active.locator('.vs-grid path');
  await expect(grid).toHaveCount(1);
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
});

for (const variant of ['', '?variant=mira'])
  test(`portable interaction and physics rewind retain their own state ${variant}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/interaction-studio/index.html' + variant);
    await page.evaluate(() => window.galleryReady);
    const sample = (time: number) =>
      page.evaluate((t) => {
        const scene = (document.querySelector('.ve-scene') as any).scene;
        scene.seek(t);
        return { state: scene.snapshot(), presentation: scene.presentation() };
      }, time);
    const contact = await sample(10.3);
    expect(contact.state.chapter).toBe('letter');
    expect(contact.state.content.world.objects.meter).toBe(1);
    expect(contact.state.content.world.items.hero.id).toBe('letter');
    expect(contact.presentation.clipped).toEqual([]);
    const pullback = await sample(12.35);
    expect(pullback.state.content.framing.changingShot).toBe(true);
    expect(pullback.presentation.clipped).toEqual([]);
    const wide = await sample(12.7);
    expect(wide.state.content.framing.changingShot).toBe(false);
    expect(wide.state.content.framing.clipped).toEqual([]);
    expect(wide.presentation.clipped).toEqual([]);
    const seated = await sample(20.1);
    expect(seated.state.content.world.actors.hero.seated).toBeGreaterThan(0.98);
    expect(seated.state.content.world.actors.friend.seated).toBeGreaterThan(0.98);
    expect(
      Math.abs(
        seated.state.content.world.actors.hero.at.x - seated.state.content.world.actors.friend.at.x,
      ),
    ).toBeGreaterThan(1);
    const first = await sample(30.8);
    expect(first.state.chapter).toBe('experiment');
    await sample(33.8);
    const rewound = await sample(30.8);
    expect(rewound.state.content).toEqual(first.state.content);
    expect((await sample(10.3)).state).toEqual(contact.state);
    expect(errors).toEqual([]);
  });
