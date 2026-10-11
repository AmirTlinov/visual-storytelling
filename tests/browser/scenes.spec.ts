import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openFixture } from '../support/fixture.mjs';
import { readCatalog } from '../../tools/catalog.mjs';
const catalog = await readCatalog();

async function ready(page: Page, path: string) {
  await page.goto(path);
  await page.waitForFunction(
    () =>
      !!document.querySelector<HTMLElement>('.ve-scene')?.scene ||
      !!document.querySelector('svg.canvas,svg.vs-canvas,canvas') ||
      document.querySelector('object')?.contentDocument?.documentElement.tagName === 'svg',
  );
  await page.evaluate(async () => {
    await document.fonts.ready;
    await window.galleryReady;
  });
}
test('all examples load in both themes at a narrow width without script errors or overflow', async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 375, height: 950 });
  for (const [scene, item] of Object.entries(catalog))
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await ready(page, `/${scene}/${item.page}`);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        scene,
      ).toBeLessThanOrEqual(375);
      const composition = await page.evaluate(() => {
        const root = document.querySelector<HTMLElement>('.ve-scene');
        if (!root?.scene) return null;
        const controls = root.scene
          .inspect()
          .capabilities.filter((capability) => !['theme', 'reduced'].includes(capability));
        if (!controls.length) return null; // Static illustrations keep their authored paper size.
        const frame =
          root.querySelector('[data-scene-frame]') ?? (root instanceof SVGSVGElement ? root : null);
        if (!frame) return { width: 0, height: 1 };
        const { width, height } = frame.getBoundingClientRect();
        return { width, height };
      });
      if (composition)
        expect(composition.width / composition.height, `${scene}: complete frame`).toBeCloseTo(
          16 / 9,
          3,
        );
      const player = page.locator('.ve-player').first();
      if (await player.isVisible()) {
        // A narrow player wraps into rows while retaining actual CSS-pixel targets.
        await expect(page.locator('.ve-player:visible'), scene).toHaveCount(1);
        const controls = await player.evaluate((el) => ({
          insideFrame: !!el.closest('[data-scene-frame]'),
          boxes: [...el.querySelectorAll('button,input,select')]
            .filter((control) => control.checkVisibility())
            .map((control) => control.getBoundingClientRect().toJSON()),
          timeSize: parseFloat(getComputedStyle(el.querySelector('[data-time]')!).fontSize),
        }));
        expect(controls.insideFrame, scene).toBe(false);
        expect(controls.timeSize, scene).toBeGreaterThanOrEqual(16);
        for (const box of controls.boxes) {
          expect(box.width, `${scene}: target width`).toBeGreaterThanOrEqual(43.9);
          expect(box.height, `${scene}: target height`).toBeGreaterThanOrEqual(43.9);
          expect(box.left, scene).toBeGreaterThanOrEqual(-0.5);
          expect(box.right, scene).toBeLessThanOrEqual(375.5);
        }
      }
    }
  expect(errors).toEqual([]);
});
test('one audio clock drives play, pause, reverse seek and deterministic drawing', async ({
  page,
}) => {
  await openFixture(page, 'scene-shell', 'media.html');
  const play = page.locator('[data-play]'),
    seek = page.locator('[data-seek]');
  await seek.fill('4.3');
  await play.click();
  await expect.poll(() => seek.inputValue().then(Number)).toBeGreaterThan(4.4);
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Воспроизвести');
  await seek.fill('19');
  const complete = await page.locator('#shell-subject').innerHTML();
  await seek.fill('0');
  await seek.fill('19');
  expect(await page.locator('#shell-subject').innerHTML()).toBe(complete);
  for (let i = 0; i < 4; i++) await play.click();
  const paused = await seek.inputValue();
  await page.waitForTimeout(150);
  expect(await seek.inputValue()).toBe(paused);
  await play.focus();
  await expect(play).toBeFocused();
});

test('manual input pauses audio, undo restores its condition and the narrative owns a new seek', async ({
  page,
}) => {
  await openFixture(page, 'scene-shell', 'media.html');
  await page.locator('[data-seek]').fill('15');
  const original = await page.evaluate(() =>
    document.querySelector<HTMLElement>('.ve-scene')!.scene!.snapshot(),
  );
  await page.locator('[data-play]').click();
  await page.locator('[data-mode=explore]').click();
  const field = page.getByRole('slider', { name: 'По горизонтали' });
  await field.fill('-2');
  expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(
    true,
  );
  await page.evaluate(() =>
    document.querySelector<HTMLElement>('.ve-scene')!.scene!.control([{ type: 'undoExperiment' }]),
  );
  expect(Number(await field.inputValue())).toBe(3);
  await page.locator('[data-mode=story]').click();
  await page.locator('[data-seek]').fill('15');
  expect(
    await page.evaluate(() => document.querySelector<HTMLElement>('.ve-scene')!.scene!.snapshot()),
  ).toEqual(original);
  await expect(page.locator('.ve-player:visible')).toHaveCount(1);
});

test('native SMIL time follows the common player through reverse seek and reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openFixture(page, 'smil');
  const seek = page.locator('[data-seek]');
  await expect(seek).toBeEnabled();
  for (const time of [0.75, 1.5, 2.25, 0]) {
    await seek.fill(String(time));
    const state = await page.locator('object').evaluate((object: HTMLObjectElement) => {
      const svg = object.contentDocument!.querySelector('svg')!;
      return { paused: svg.animationsPaused(), time: svg.getCurrentTime() };
    });
    expect(state.paused).toBe(true);
    expect(state.time).toBeCloseTo(time, 2);
  }
  const box = await page.locator('[data-scene-frame]').boundingBox();
  expect(box!.width / box!.height).toBeCloseTo(16 / 9, 3);
});

test('disposing a playing scene releases its audio, camera, frame and controls exactly once', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openFixture(page, 'scene-shell', 'media.html');
  await page.locator('[data-play]').click();
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused))
    .toBe(false);
  expect(
    await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('.ve-scene')!,
        audio = root.querySelector('audio')!,
        scene = root.scene!;
      scene.dispose();
      scene.dispose();
      return audio.paused && !root.scene;
    }),
  ).toBe(true);
  await page.setViewportSize({ width: 500, height: 800 });
  await expect(page.locator('.ve-scene')).toBeEmpty();
  expect(errors).toEqual([]);
});

test('a second click cancels pending audio playback without reporting an error', async ({
  page,
}) => {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function () {
      return new Promise((_resolve, reject) =>
        this.addEventListener(
          'cancel-play',
          () => reject(new DOMException('Interrupted', 'AbortError')),
          { once: true },
        ),
      );
    };
    HTMLMediaElement.prototype.pause = function () {
      this.dispatchEvent(new Event('cancel-play'));
    };
  });
  await openFixture(page, 'scene-shell', 'media.html');
  const button = page.locator('[data-play]');
  await button.click();
  await expect(button).toHaveAttribute('aria-label', 'Пауза');
  await button.click();
  await expect(button).toHaveAttribute('aria-label', 'Воспроизвести');
  await expect(page.locator('[data-caption]')).toHaveAttribute('role', 'status');
});

test('manual camera changes preserve audio playback and model conditions', async ({ page }) => {
  await openFixture(page, 'scene-shell', 'media.html');
  await page.locator('[data-play]').click();
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime))
    .toBeGreaterThan(0.1);
  const drawing = page.locator('#shell-subject');
  await drawing.focus();
  await drawing.press('ArrowRight');
  expect(
    await page.evaluate(
      () => (document.querySelector('.ve-scene') as any).scene.capture().view.following,
    ),
  ).toBe(false);
  const seek = page.locator('[data-seek]'),
    before = Number(await seek.inputValue());
  await expect.poll(() => seek.inputValue().then(Number)).toBeGreaterThan(before + 0.1);
  await page.locator('[data-play]').click();
  for (const time of [12, 19, 0, 12]) await seek.fill(String(time));
  expect(
    await page.evaluate(() => document.querySelector<HTMLElement>('.ve-scene')!.scene!.snapshot()),
  ).toEqual({ x: 3, y: 2 });
  await expect(drawing).toHaveCSS('overflow', 'hidden');
});
