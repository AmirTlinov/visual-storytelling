import { expect, test } from '@playwright/test';

test('a quiet character story explains on its drawing and retains an accessible transcript', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tesla-circuit/index.html');
  await page.evaluate(() => (window as any).galleryReady);
  const caption = page.locator('[data-caption]');
  const seek = (id: string) =>
    page.evaluate(
      (id) =>
        (document.querySelector('.ve-scene') as any).scene.control([
          { type: 'cue', id, progress: 0.7 },
        ]),
      id,
    );
  const explained = async (text: string, closed: boolean) => {
    await expect(caption).toHaveCount(1);
    await expect(caption).toHaveClass(/sr-only/);
    await expect(caption).toHaveAttribute('role', 'status');
    await expect(caption).toHaveText(text);
    await expect(page.locator('.ve-captions')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Замкнуть или разомкнуть цепь' }).filter({ visible: true }),
    ).toHaveAttribute('aria-pressed', String(closed));
    const state = await page.evaluate(() => {
      const frame = document.querySelector('[data-scene-frame]')!.getBoundingClientRect();
      const scene = (document.querySelector('.ve-scene') as any).scene;
      return {
        ratio: frame.width / frame.height,
        closed: scene.inspect().parameters.find((p: any) => p.key === 'closed').value,
        clipped: scene.presentation().clipped,
      };
    });
    expect(state.ratio).toBeCloseTo(16 / 9, 3);
    expect(state.closed).toBe(closed);
    expect(state.clipped).toEqual([]);
  };

  const open = 'Разомкнём цепь. Путь прервался, и лампа погасла.';
  const start =
    'Проследим путь энергии. Источник создаёт напряжение, а замкнутая цепь позволяет току идти через лампу.';
  await seek('workshop.explain');
  await explained(open, false);
  await seek('workshop.approach');
  await explained(start, true);
  await page.emulateMedia({ colorScheme: 'dark' });
  await seek('workshop.explain');
  await explained(open, false);
  await page.setViewportSize({ width: 820, height: 960 });
  await explained(open, false);
  expect(errors).toEqual([]);
});
