import { test, expect } from '@playwright/test';
import { build } from 'esbuild';

test('3D lettering is rasterized at the displayed frame density through resize', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/connected-diagram/index.html');
  await page.evaluate(() => window.galleryReady);
  await page.locator('[data-seek]').fill('6');
  const canvas = page.locator('.ve-stage > canvas');
  for (const width of [1440, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() =>
        canvas.evaluate((node: HTMLCanvasElement) =>
          Math.abs(node.width - node.getBoundingClientRect().width * Math.min(devicePixelRatio, 2)),
        ),
      )
      .toBeLessThan(2);
    expect(Number(await page.locator('[data-seek]').inputValue())).toBe(6);
  }
});

test('independently bundled SVG and HTML share one host connection', async ({ page }) => {
  const bundle = async (name: string) =>
    (
      await build({
        entryPoints: ['dist/host/adapter.js'],
        bundle: true,
        write: false,
        format: 'iife',
        globalName: name,
      })
    ).outputFiles[0]!.text;
  await page.setContent('<main></main>');
  await page.addScriptTag({ content: await bundle('SVGHost') });
  await page.addScriptTag({ content: await bundle('HTMLHost') });
  expect(
    await page.evaluate(() => {
      const w = window as any;
      let changed = 0;
      const stop = w.HTMLHost.watchSceneHost(() => changed++);
      const first = { widgetState: { read: () => ({ privateContent: 'first' }) } };
      const second = { widgetState: { read: () => ({ privateContent: 'second' }) } };
      const disconnectFirst = w.SVGHost.connectSceneHost(first);
      const shared = w.HTMLHost.sceneHost() === first;
      const disconnectSecond = w.HTMLHost.connectSceneHost(second);
      disconnectFirst();
      const retained = w.SVGHost.sceneHost() === second;
      disconnectSecond();
      stop();
      return { shared, retained, changed, empty: !w.SVGHost.sceneHost() };
    }),
  ).toEqual({ shared: true, retained: true, changed: 3, empty: true });
});

test('playback remains readable outside the drawing at every surface width', async ({ page }) => {
  for (const width of [375, 390, 820, 1440])
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await page.goto('/explorer-svg/index.html');
      await page.evaluate(() => window.galleryReady);
      const result = await page.evaluate(() => {
        const frame = document.querySelector('[data-scene-frame]')!;
        const player = document.querySelector('.ve-player')!;
        const box = frame.getBoundingClientRect();
        return {
          ratio: box.width / box.height,
          outside: !frame.contains(player),
          players: document.querySelectorAll('.ve-player').length,
          controls: [...player.querySelectorAll('button,input,select')]
            .filter((n) => n.checkVisibility())
            .map((n) => ({
              height: n.getBoundingClientRect().height,
              width: n.getBoundingClientRect().width,
            })),
          type: [...player.querySelectorAll('output,select')].map((n) =>
            parseFloat(getComputedStyle(n).fontSize),
          ),
          scrollWidth: document.documentElement.scrollWidth,
        };
      });
      expect(result.ratio).toBeCloseTo(16 / 9, 5);
      expect(result.outside).toBe(true);
      expect(result.players).toBe(1);
      for (const control of result.controls) {
        expect(control.height).toBeGreaterThanOrEqual(44);
        expect(control.width).toBeGreaterThanOrEqual(44);
      }
      expect(result.type.every((size) => size >= 16)).toBe(true);
      expect(result.scrollWidth).toBeLessThanOrEqual(width);
    }
});

test('the measuring grid covers the aperture after camera movement and reverse seek', async ({
  page,
}) => {
  await page.goto('/explorer-svg/index.html');
  await page.evaluate(() => window.galleryReady);
  for (const time of [23, 8, 0, 23]) {
    await page.locator('[data-seek]').fill(String(time));
    const svg = page.locator('svg.vs-canvas');
    await svg.focus();
    await svg.press('ArrowRight');
    expect(
      await svg.evaluate((node) => {
        const line = node.querySelector('.vs-grid path') as SVGPathElement;
        const numbers = line
          .getAttribute('d')!
          .match(/-?[\d.]+/g)!
          .slice(0, 4)
          .map(Number);
        const matrix = line.getScreenCTM()!;
        const a = new DOMPoint(numbers[0], numbers[1]).matrixTransform(matrix);
        const b = new DOMPoint(numbers[2], numbers[3]).matrixTransform(matrix);
        const frame = node.getBoundingClientRect();
        return (
          getComputedStyle(line).display !== 'none' &&
          Math.min(a.y, b.y) <= frame.top + 1 &&
          Math.max(a.y, b.y) >= frame.bottom - 1
        );
      }),
    ).toBe(true);
    await svg.press('Home');
  }
});

test('reading keeps a logical attention point through a larger non-scrollable aperture', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/graph-lab/index.html');
  await page.evaluate(() => window.galleryReady);
  await page.getByRole('button', { name: 'Читать крупнее', exact: true }).click();
  const frame = page.locator('[data-scene-frame]').first();
  const center = () =>
    frame.evaluate((n: HTMLElement) => ({
      x: (n.scrollLeft + n.clientWidth / 2) / Number(n.dataset.frameScale),
      y: (n.scrollTop + n.clientHeight / 2) / Number(n.dataset.frameScale),
    }));
  await frame.evaluate((n) => {
    n.scrollLeft = 300;
    n.scrollTop = 220;
  });
  await expect.poll(async () => (await center()).x).toBeGreaterThan(400);
  const before = await center();
  await page.setViewportSize({ width: 1800, height: 1400 });
  await expect.poll(() => frame.evaluate((n) => n.clientWidth)).toBeGreaterThan(1280);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => frame.evaluate((n) => n.clientWidth)).toBeLessThan(390);
  await expect.poll(async () => Math.abs((await center()).x - before.x)).toBeLessThan(2);
  await expect.poll(async () => Math.abs((await center()).y - before.y)).toBeLessThan(2);
});
