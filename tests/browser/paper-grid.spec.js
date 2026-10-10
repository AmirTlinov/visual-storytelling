import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';

test('paper remains visible in small frames in both themes while measuring grids own their surface', async ({
  page,
}) => {
  for (const viewport of [
    { width: 375, height: 1000 },
    { width: 980, height: 400 },
  ]) {
    await page.setViewportSize(viewport);
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await page.goto('/memory-register/index.html');
      await page.evaluate(() => window.galleryReady);
      // This blank part of the real composition contains only the paper material.
      let coverage = 0;
      await expect
        .poll(
          async () => {
            const clip = await page.locator('.ve-scene-content').evaluate((content) => {
              const box = content.getBoundingClientRect();
              const scale = box.width / content.offsetWidth;
              return {
                x: Math.round(box.x + 800 * scale),
                y: Math.round(box.y + 560 * scale),
                width: Math.floor(430 * scale),
                height: Math.floor(130 * scale),
              };
            });
            const png = PNG.sync.read(await page.screenshot({ clip }));
            const colors = new Map();
            for (let i = 0; i < png.data.length; i += 4) {
              const rgb = [...png.data.subarray(i, i + 3)].join(',');
              colors.set(rgb, (colors.get(rgb) ?? 0) + 1);
            }
            const background = [...colors.entries()]
              .sort((a, b) => b[1] - a[1])[0][0]
              .split(',')
              .map(Number);
            let gridPixels = 0;
            for (let i = 0; i < png.data.length; i += 4) {
              if (
                background.some((channel, offset) => Math.abs(png.data[i + offset] - channel) >= 6)
              )
                gridPixels++;
            }
            coverage = gridPixels / (png.width * png.height);
            return coverage;
          },
          { message: `${viewport.width}px ${colorScheme}: visible paper lines` },
        )
        .toBeGreaterThan(0.15);
      expect(coverage, 'the paper retains open space between its lines').toBeLessThan(0.75);

      await page.goto('/explorer-svg/index.html');
      await page.evaluate(() => window.galleryReady);
      await expect(page.locator('.ve-scene-content')).toHaveCSS('background-image', 'none');
      await expect(page.locator('.vs-grid > path').first()).toBeVisible();
    }
  }
});
