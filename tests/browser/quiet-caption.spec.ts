import { expect, test } from '@playwright/test';

test('a quiet character story keeps the complete caption readable through narrow seeking', async ({
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
  const readable = async (text: string) => {
    await expect(caption).toHaveCount(1);
    await expect(caption).toBeVisible();
    await expect(caption).toHaveAttribute('role', 'status');
    await expect(caption).toHaveText(text);
    const geometry = await caption.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const frame = document.querySelector('[data-scene-frame]')!.getBoundingClientRect();
      const glyph = document.createRange();
      glyph.setStart(element.firstChild!, 0);
      glyph.setEnd(element.firstChild!, 1);
      return {
        glyphHeight: glyph.getBoundingClientRect().height,
        top: box.top,
        frameBottom: frame.bottom,
        left: box.left,
        right: box.right,
        width: innerWidth,
        clipped: element.scrollWidth > element.clientWidth,
      };
    });
    expect(geometry.glyphHeight).toBeGreaterThanOrEqual(18);
    expect(geometry.top).toBeGreaterThanOrEqual(geometry.frameBottom);
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.width);
    expect(geometry.clipped).toBe(false);
  };

  const open = 'Разомкнём цепь. Путь прервался, и лампа погасла.';
  const start =
    'Проследим путь энергии. Источник создаёт напряжение, а замкнутая цепь позволяет току идти через лампу.';
  await seek('workshop.explain');
  await readable(open);
  await seek('workshop.approach');
  await readable(start);
  await page.emulateMedia({ colorScheme: 'dark' });
  await seek('workshop.explain');
  await readable(open);
  await page.setViewportSize({ width: 820, height: 960 });
  await readable(open);
  expect(errors).toEqual([]);
});
