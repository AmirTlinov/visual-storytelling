import { test, expect } from '@playwright/test';
import { build } from 'esbuild';

test('review ignores hidden SVG and measures lettering after real perspective projection', async ({
  page,
}) => {
  const bundle = await build({
    entryPoints: ['dist/scene-frame.js'],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'FrameUnderTest',
  });
  await page.setContent(`<main style="position:absolute;left:0;top:0;width:300px;height:200px;overflow:hidden">
    <div style="transform-origin:0 0;transform:matrix3d(1,0,0,0,0,1,0,.005,0,0,1,0,0,0,0,1)">
      <svg width="300" height="200">
        <g style="display:none"><text x="900" y="700" font-size="8">Hidden</text></g>
        <g opacity="0"><text x="900" y="700" font-size="8">Transparent</text></g>
        <text data-review-id="far-label" x="20" y="100" font-size="20">Дальний край</text>
      </svg>
    </div></main>`);
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
  const inspect = () =>
    page.evaluate(() =>
      (window as any).FrameUnderTest.inspectPresentation(document.querySelector('main')),
    );
  const projected = await inspect();
  expect(projected.clipped).toEqual([]);
  expect(projected.unreadableText).toHaveLength(1);
  expect(projected.unreadableText[0].id).toBe('far-label');
  expect(projected.unreadableText[0].pixels).toBeGreaterThan(9);
  expect(projected.unreadableText[0].pixels).toBeLessThan(12);
  await page.locator('main > div').evaluate((element: HTMLElement) => {
    element.style.transform = 'none';
  });
  const flat = await inspect();
  expect(flat.clipped).toEqual([]);
  expect(flat.unreadableText).toEqual([]);
  expect(await page.locator('svg g').count()).toBe(2);
});
