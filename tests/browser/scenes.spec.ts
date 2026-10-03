import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import catalog from '../../examples/catalog.json' with { type: 'json' };

async function ready(page: Page, path: string) {
  await page.goto(path);
  await page.waitForFunction(
    () =>
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
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 375, height: 950 });
  for (const [scene, item] of Object.entries(catalog))
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      if (item.page.endsWith('.svg')) continue; // Native SVG is covered by the pixel reference capture.
      await ready(page, `/${scene}/${item.page}`);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        scene,
      ).toBeLessThanOrEqual(375);
      const player = page.locator('.ve-player').first();
      if (await player.isVisible()) {
        const mids = await player.evaluate((el) =>
          [...el.children]
            .filter((c) => getComputedStyle(c).display !== 'none')
            .map((c) => {
              const r = c.getBoundingClientRect();
              return r.top + r.height / 2;
            }),
        );
        expect(Math.max(...mids) - Math.min(...mids), scene).toBeLessThan(3);
      }
    }
  expect(errors).toEqual([]);
});
test('audio controls play, pause, seek backwards and keep the exact area model', async ({
  page,
}) => {
  await ready(page, '/area-story/index.html');
  const play = page.locator('[data-play]'),
    seek = page.locator('[data-seek]');
  await seek.fill('4.3');
  await play.click();
  await expect.poll(() => seek.inputValue().then(Number)).toBeGreaterThan(4.4);
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Воспроизвести');
  const ending = (Number(await seek.getAttribute('max')) - 0.1).toFixed(2);
  await seek.fill(ending);
  await expect(page.locator('[data-square]')).toHaveCount(20);
  const complete = await page.locator('[data-drawing]').innerHTML();
  await seek.fill('0');
  await seek.fill(ending);
  expect(await page.locator('[data-drawing]').innerHTML()).toBe(complete);
  await page.locator('[data-formulas]').click();
  await expect(page.locator('[data-formulas]')).toHaveAttribute('aria-pressed', 'true');
  for (let i = 0; i < 4; i++) await play.click();
  const paused = await seek.inputValue();
  await page.waitForTimeout(150);
  expect(await seek.inputValue()).toBe(paused);
  await page.locator('[data-mute]').click();
  expect(await page.locator('audio').evaluate((a: HTMLAudioElement) => a.muted)).toBe(true);
  await play.focus();
  await expect(play).toBeFocused();
});
test('shell changes mode, pauses the voice and restores the story after manual input', async ({
  page,
}) => {
  await ready(page, '/explorer-svg/index.html');
  await page.locator('[data-mode=story]').click();
  await page.locator('[data-seek]').fill('15');
  await page.locator('[data-play]').click();
  await page.locator('[data-mode=explore]').click();
  expect(await page.locator('audio').evaluate((a: HTMLAudioElement) => a.paused)).toBe(true);
  const field = page.getByRole('slider', { name: 'По горизонтали' });
  await field.fill('-2');
  await expect(field).toHaveValue('-2');
  await page.reload();
  await page.evaluate(() => window.galleryReady);
  await expect(page.locator('#ve-scene')).toHaveAttribute('data-scene-mode', 'explore');
  await expect(field).toHaveValue('-2');
  for (const width of [375, 960]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() =>
        page.locator('#displacements').evaluate((svg) => {
          const grid = svg.querySelector('.vs-grid') as SVGGraphicsElement;
          return Math.abs(grid.getBBox().width - svg.parentElement!.clientWidth);
        }),
      )
      .toBeLessThan(1);
  }
  await page.locator('[data-mode=story]').click();
  await expect(page.locator('#ve-scene')).toHaveAttribute('data-scene-mode', 'story');
  await page.locator('[data-seek]').fill('15');
  await page.locator('[data-mode=explore]').click();
  expect(Number(await field.inputValue())).not.toBe(-2);
});
test('typed stories use the same shell and preserve model state through mode changes', async ({
  page,
}) => {
  await ready(page, '/vector/index.html');
  await page.waitForFunction(() => !!window.explainer);
  await page.evaluate(() => window.explainer.seek(10));
  const original = await page.evaluate(() => window.explainer.snapshot());
  await page.locator('[data-mode=explore]').click();
  await page.getByRole('slider', { name: 'Масштаб x', exact: true }).fill('-1.4');
  expect(await page.evaluate(() => window.explainer.snapshot())).toMatchObject({
    input: { a: -1.4 },
  });
  await page.locator('[data-mode=story]').click();
  expect(await page.evaluate(() => window.explainer.snapshot())).toEqual(original);
  for (const time of [0, 5, 10, 16]) {
    await page.evaluate((t) => window.explainer.seek(t), time);
    const state = await page.evaluate(() => window.explainer.snapshot());
    await page.evaluate(() => {
      window.explainer.seek(18);
      window.explainer.seek(0);
    });
    await page.evaluate((t) => window.explainer.seek(t), time);
    expect(await page.evaluate(() => window.explainer.snapshot())).toEqual(state);
  }
});
test('controls preserve pointer targets, keyboard editing and undo/redo', async ({ page }) => {
  await ready(page, '/controls/index.html');
  const width = page.getByRole('slider', { name: 'Ширина', exact: true });
  await width.fill('7');
  await expect(width).toHaveValue('7');
  await page.getByRole('radio', { name: 'Фиолетовый', exact: true }).click();
  const vertex = page.locator('[data-handle]').first();
  const before = await vertex.getAttribute('transform');
  await vertex.focus();
  await page.keyboard.press('ArrowRight');
  expect(await vertex.getAttribute('transform')).not.toBe(before);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await vertex.getAttribute('transform')).toBe(before);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  expect(await vertex.getAttribute('transform')).not.toBe(before);
});
test('vector: intermediate displayed products distinguish approximation from equality', async ({
  page,
}) => {
  await ready(page, '/vector/index.html');
  const relation = page.locator('[data-object="horizontal:eq"] .vs-lettering');
  for (const [time, sign] of [
    [13, '≈'],
    [16, '='],
    [13, '≈'],
  ] as const) {
    await page.evaluate((time) => window.explainer.seek(time), time);
    await expect(relation).toHaveAttribute('aria-label', sign);
  }
});
test('all BERT tokens can be selected at their center and edges', async ({ page }) => {
  await ready(page, '/parameter-cube/preview.html');
  const frame = page.frames().find((f) => f.url().includes('tensor-cube.svg'))!;
  const tokens = frame.locator('#tokens [data-token]');
  await expect(tokens).toHaveCount(4);
  for (let i = 0; i < 4; i++)
    for (const edge of [false, true]) {
      const token = tokens.nth(i);
      await token.scrollIntoViewIfNeeded();
      const box = await token.boundingBox();
      expect(box).not.toBeNull();
      await page.mouse.click(box!.x + (edge ? 4 : box!.width / 2), box!.y + box!.height / 2);
      await expect(token).toHaveAttribute('aria-selected', 'true');
    }
});
test('LC player owns native SVG time, including reverse seek and reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page, '/lc-oscillator/preview.html');
  const seek = page.locator('[data-seek]');
  await expect(seek).toBeEnabled();
  for (const time of [0.75, 1.5, 2.25, 0]) {
    await seek.fill(String(time));
    const state = await page.locator('object').evaluate((o: HTMLObjectElement) => {
      const s = o.contentDocument!.documentElement as unknown as SVGSVGElement;
      return { paused: s.animationsPaused(), time: s.getCurrentTime() };
    });
    expect(state.paused).toBe(true);
    expect(state.time).toBeCloseTo(time, 2);
  }
});

for (const name of ['area-story', 'remainder-story'])
  test(`${name}: removing a playing scene releases its audio and controls`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await ready(page, `/${name}/index.html`);
    await page.locator('[data-play]').click();
    await expect
      .poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.paused))
      .toBe(false);
    expect(
      await page.evaluate(() => {
        const root = document.querySelector('.ve-scene') as HTMLElement & {
          scene: { dispose(): void };
        };
        const audio = root.querySelector('audio')!;
        root.scene.dispose();
        return audio.paused;
      }),
    ).toBe(true);
    await page.setViewportSize({ width: 500, height: 800 });
    await expect(page.locator('.ve-scene')).toBeEmpty();
    expect(errors).toEqual([]);
  });

test('audio: a second click cancels pending playback without reporting an error', async ({
  page,
}) => {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function () {
      return new Promise((_resolve, reject) => {
        this.addEventListener(
          'cancel-play',
          () => reject(new DOMException('Interrupted', 'AbortError')),
          { once: true },
        );
      });
    };
    HTMLMediaElement.prototype.pause = function () {
      this.dispatchEvent(new Event('cancel-play'));
    };
  });
  await ready(page, '/area-story/index.html');
  const button = page.locator('[data-play]');
  await button.click();
  await expect(button).toHaveAttribute('aria-label', 'Пауза');
  await button.click();
  await expect(button).toHaveAttribute('aria-label', 'Воспроизвести');
  await expect(page.locator('[data-caption]')).toHaveAttribute('role', 'status');
});

for (const name of ['explorer-svg', 'explorer-3d'])
  test(`${name}: manual camera keeps real audio running, seeking restores its authored pose`, async ({
    page,
  }) => {
    await ready(page, `/${name}/index.html`);
    const play = page.locator('[data-play]'),
      seek = page.locator('[data-seek]');
    await play.click();
    await expect
      .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime))
      .toBeGreaterThan(0.1);
    const canvas = page.locator(name === 'explorer-svg' ? '#displacements' : '.ve-stage > canvas');
    await canvas.focus();
    await page.keyboard.press('ArrowRight');
    expect(
      await page.evaluate(() => {
        const scene = (document.querySelector('.ve-scene') as any).scene;
        return (scene.camera ?? scene.view).following;
      }),
    ).toBe(false);
    const before = Number(await seek.inputValue());
    await expect.poll(() => seek.inputValue().then(Number)).toBeGreaterThan(before + 0.1);
    await play.click();
    await seek.fill('12');
    const pose = () =>
      page.evaluate(() => {
        const scene = (document.querySelector('.ve-scene') as any).scene;
        const camera = scene.camera ?? scene.view;
        return {
          following: camera.following,
          pose: camera.pose ?? camera.camera.position.toArray(),
        };
      });
    const expected = await pose();
    expect(expected.following).toBe(true);
    await seek.fill('25');
    await seek.fill('0');
    await seek.fill('12');
    expect(await pose()).toEqual(expected);
    await page.getByRole('combobox', { name: 'Глава' }).click();
    await page.getByRole('option').last().click();
    expect(Number(await seek.inputValue())).toBeGreaterThan(12);
    await expect(page.locator('[data-caption]')).not.toBeEmpty();
    if (name === 'explorer-svg') await expect(canvas).toHaveCSS('overflow', 'hidden');
    await page.locator('[data-mode=explore]').click();
    const field = page.locator('.ve-parameters input[type=range]').first();
    await field.fill((await field.getAttribute('min')) ?? '0');
    expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(
      true,
    );
    await page.locator('[data-mode=story]').click();
    await expect(page.locator('.ve-scene')).toHaveAttribute('data-scene-mode', 'story');
    await page.evaluate(() => (document.querySelector('.ve-scene') as any).scene.dispose());
    await expect(page.locator('.ve-scene')).toBeEmpty();
  });
