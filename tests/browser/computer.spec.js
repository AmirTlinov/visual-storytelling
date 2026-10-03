import { packDirectory } from '../../tools/standalone.mjs';
import { test, expect } from '@playwright/test';
import { at } from '../support/computer.mjs';
async function ready(page, name = 'computer-explorer/index.html') {
  await page.goto('/' + name);
  await page.evaluate(async () => {
    await window.galleryReady;
    await document.fonts.ready;
  });
}
const state = (page) => page.evaluate(() => document.querySelector('.ve-scene').scene.snapshot());
const restore = (page, saved) => page.evaluate((saved) => document.querySelector('.ve-scene').scene.restore(saved), saved);
const idle = (page) =>
  page.waitForFunction(
    () => document.querySelector('#computer-explorer').dataset.moving === 'false',
  );
async function go(page, key) {
  await page.locator(`[data-hit-key="${key}"]`).press('Enter');
  await idle(page);
}
async function open(page, stage) {
  await page.locator(`[data-job-open="${stage}"]`).click();
  await idle(page);
}

test('computer: byte edits follow shared/discrete memory, deep paths restore, LCD waits for scanout', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  for (const architecture of ['discrete', 'unified']) {
    await restore(page, at(architecture, 'dispatch'));
    await open(page, 'ram');
    await go(page, 'byte-0');
    await go(page, 'bit-5');
    await go(page, 'capacitor');
    await page.locator('[data-value="charge"]').click();
    const changed = await state(page);
    expect(changed.imageJob.ram[0]).toBe(0);
    expect(changed.imageJob.upload[0]).toBe(architecture === 'discrete' ? 32 : null);
    await restore(page, changed);
    expect(await page.locator('#computer-explorer').getAttribute('data-scene')).toBe('capacitor');
    await expect(page.locator('[data-value="charge"]')).toHaveAttribute('aria-pressed', 'false');
    await open(page, 'gpu');
    await go(page, 'lane-0');
    await expect(page.locator('.explorer-canvas')).toContainText(
      architecture === 'unified' ? '0 · HEX 00' : '32 · HEX 20',
    );
  }
  await restore(page, at('discrete', 'done'));
  await open(page, 'ssd');
  await go(page, 'byte-0');
  await go(page, 'bit-4');
  await expect(page.locator('[data-nand-status]')).toContainText('BL4: 1');
  await page.locator('[data-nand-program]').click();
  await open(page, 'ssd');
  await expect(page.locator('[data-hit-key="byte-0"]')).toHaveAttribute('aria-label', /= 0$/);
  const computed = at('unified', 'fence');
  await restore(page, computed);
  await open(page, 'monitor');
  const before = (await state(page)).display.panel;
  await page.locator('[data-job-step]').click();
  expect((await state(page)).display.panel).toEqual(before);
});

test('computer: player completes without redrawing the static board, saves, pauses and releases its lifetime', async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page);
  await restore(page, at('unified', 'queued'));
  await page.locator('[data-job-play]').click();
  await page.waitForFunction(() => document.querySelector('.image-job').dataset.phase === 'cpu');
  await page.evaluate(() => {
    window.redraws = 0;
    window.observer = new MutationObserver((r) => (window.redraws += r.length));
    window.observer.observe(document.querySelector('[data-camera-world]'), { childList: true });
  });
  await page.waitForTimeout(350);
  expect(
    await page.evaluate(() => {
      window.observer.disconnect();
      return window.redraws;
    }),
  ).toBe(0);
  await open(page, 'cpu');
  await expect(page.locator('[data-job-player]')).toHaveAttribute('data-playing', 'false');
  const paused = await state(page);
  await page.waitForTimeout(180);
  expect(await state(page)).toEqual(paused);
  await page.evaluate(() => document.querySelector('.ve-scene').scene.home());
  await page.locator('[data-job-play]').click();
  await page.waitForFunction(
    () => document.querySelector('.image-job').dataset.phase === 'done',
    null,
    { timeout: 45000 },
  );
  const done = await state(page);
  expect(done.imageJob.cpu.instructions).toBe(224);
  expect(done.imageJob.gpu.written).toBe(32);
  expect(done.display.panel).toEqual(done.display.vram);
  await page.reload();
  await page.evaluate(() => window.galleryReady);
  expect((await state(page)).imageJob.phase).toBe('done');
  await page.locator('[data-job-play]').click();
  await page.evaluate(() => document.querySelector('.ve-scene').scene.dispose());
  const disposed = await state(page);
  await page.waitForTimeout(220);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('openai:set_globals', {
        detail: {
          globals: {
            widgetState: {
              privateContent: { computerExplorer: { version: 2, architecture: 'discrete' } },
            },
          },
        },
      }),
    ),
  );
  expect(await state(page)).toEqual(disposed);
  expect(errors).toEqual([]);
});

test('computer: rapid navigation, touch, contour focus, wheel position and architecture restoration', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await go(page, 'ram');
  await go(page, 'chip-0');
  await go(page, 'bank-0');
  await go(page, 'array-0');
  await go(page, 'cell-0-0');
  await go(page, 'capacitor');
  await page.locator('.explorer-back').press('Enter');
  await idle(page);
  await expect(page.locator('[data-hit-key="capacitor"]')).toBeFocused();
  expect(
    await page.locator('[data-contour] [data-contour-world]').locator('*').count(),
  ).toBeGreaterThan(0);
  await page.setViewportSize({ width: 375, height: 900 });
  await expect(page.locator('[data-hit-key="capacitor"]')).toBeFocused();
  await page.evaluate(() => document.querySelector('.ve-scene').scene.home());
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('[data-hit-key="gpu"]').click();
  await page.locator('[data-architecture="unified"]').click();
  await page.waitForTimeout(450);
  expect((await state(page)).keys).toEqual([]);
  expect(await page.locator('[data-child-scene]').count()).toBe(0);
  const box = await page.locator('.explorer-viewport').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -60);
  await page.waitForTimeout(220);
  const pose = (await state(page)).view;
  await page.reload();
  await page.evaluate(() => window.galleryReady);
  expect((await state(page)).view).toEqual(pose);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('[data-camera-reset]').click();
  const cdp = await page.context().newCDPSession(page);
  const start = (await state(page)).view;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const fingers = (distance) => [
    { id: 1, x: center.x - distance, y: center.y },
    { id: 2, x: center.x + distance, y: center.y },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(25) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(50) });
  expect((await state(page)).view.s).toBeGreaterThan(start.s);
  const parked = await state(page);
  await restore(page, parked);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(70) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect((await state(page)).view).toEqual(parked.view);
  expect((await state(page)).keys).toEqual([]);
  await cdp.detach();
  await page.locator('[data-camera-reset]').click();
  const target = page.locator('[data-hit-key="cpu"]'),
    b = await target.boundingBox();
  const pointer = {
    pointerId: 11,
    pointerType: 'touch',
    clientX: b.x + b.width / 2,
    clientY: b.y + b.height / 2,
    button: 0,
    bubbles: true,
  };
  await target.dispatchEvent('pointerdown', pointer);
  await target.dispatchEvent('pointerup', pointer);
  await idle(page);
  expect((await state(page)).keys).toEqual(['cpu']);
  expect(errors).toEqual([]);
});

test('computer and neuron: both themes, narrow layouts and shared navigation controls', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [375, 800])
    for (const colorScheme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme });
      await ready(page);
      for (const stage of ['ssd', 'ram', 'cpu', 'gpu', 'monitor']) {
        await restore(page, at('unified', 'gpu'));
        await open(page, stage);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width,
        );
        const clipped = await page.evaluate(() => {
          const r = document.querySelector('.explorer-viewport').getBoundingClientRect();
          return [...document.querySelectorAll('[data-camera-world] text')]
            .filter((n) => {
              const b = n.getBoundingClientRect();
              return (
                b.width &&
                (b.left < r.left - 1 ||
                  b.right > r.right + 1 ||
                  b.top < r.top - 1 ||
                  b.bottom > r.bottom + 1)
              );
            })
            .map((n) => n.textContent);
        });
        expect(clipped).toEqual([]);
      }
      await page.evaluate(() => localStorage.removeItem('visual-story:neuron-explorer'));
      await ready(page, 'neuron-explorer/index.html');
      await page.locator('[data-hit-key="sum"]').press('Enter');
      await page.locator('[data-hit-key="term-0"]').press('Enter');
      await expect(page.locator('.ve-view-actions .caption')).toContainText('2 + 2 + 2 = 6');
      await page.getByRole('slider', { name: 'Вход A', exact: true }).fill('4');
      await expect(page.locator('.ve-view-actions .caption')).toContainText('4 + 4 + 4 = 12');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page.locator('.explorer-back').press('Enter');
      await expect(page.locator('[data-hit-key="term-0"]')).toBeFocused();
    }
  expect(errors).toEqual([]);
});

test('computer catalog keeps all figures, internal views and portable SVG export', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page, 'computer-explorer/catalog.html');
  for (const family of ['hardware', 'memory', 'logic']) {
    await page.locator(`[data-family="${family}"]`).click();
    const kinds = await page
      .locator('[data-kind]')
      .evaluateAll((nodes) => nodes.map((n) => n.dataset.kind));
    for (const kind of kinds) {
      await page.locator(`[data-kind="${kind}"]`).click();
      await expect(page.locator('.parts-hero g.part-symbol')).toBeVisible();
      if (await page.locator('.parts-view').isVisible()) {
        await page.locator('.parts-view').click();
        await expect(page.locator('.parts-hero g.part-symbol')).toBeVisible();
      }
    }
  }
  const svg = await page.evaluate(() => document.querySelector('.ve-scene').scene.exportSVG());
  expect(svg).toContain('<svg');
  expect(svg).not.toContain('var(--');
  expect(errors).toEqual([]);
});

test('monitor preserves individual pixel editing and collapses timing cross-links to the same panel', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await go(page, 'monitor');
  await expect(page.locator('[data-hit-key^="pixel-"]')).toHaveCount(288);
  for (const pixel of ['pixel-0-0', 'pixel-0-23', 'pixel-11-0', 'pixel-11-23']) {
    await go(page, pixel);
    expect((await state(page)).keys).toEqual(['monitor', pixel]);
    await page.locator('.explorer-back').press('Enter');
    await idle(page);
  }
  await go(page, 'pixel-1-2');
  await page.locator('[data-display-channel="0"]').press('End');
  await page.locator('[data-display-channel="1"]').press('End');
  await page.locator('[data-display-channel="2"]').press('Home');
  const edited = (await state(page)).display;
  expect(edited.vram.slice(78, 81)).toEqual([255, 255, 0]);
  expect(edited.panel.slice(78, 81)).toEqual([234, 102, 0]);
  await page.locator('[data-display-frame]').click();
  expect((await state(page)).display.panel.slice(78, 81)).toEqual([255, 255, 0]);
  await page.locator('.explorer-back').press('Enter');
  await idle(page);
  await expect(page.locator('[data-part="pixel-1-2"] rect')).toHaveAttribute(
    'fill',
    'rgb(255 255 0)',
  );
  await go(page, 'pixels');
  for (let cycle = 0; cycle < 5; cycle++) {
    await go(page, 'timing');
    await go(page, 'panel');
    expect((await state(page)).keys).toEqual(['monitor', 'pixels']);
  }
  const saved = await state(page);
  await restore(page, { ...saved, keys: [...saved.keys, 'timing', 'panel', 'timing', 'panel'] });
  expect((await state(page)).keys).toEqual(['monitor', 'pixels']);
});

test('computer inline delivery preserves SVG titles in markup and source strings', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const fragment = await packDirectory('site/computer-explorer', 'index.html', { inline: true });
  expect(Buffer.byteLength(fragment)).toBeLessThan(1_000_000);
  await page.goto('/');
  await page.setContent(fragment);
  await page.evaluate(() => window.galleryReady);
  await expect(page.locator('.explorer-canvas title')).toHaveText('Плата');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await go(page, 'cpu');
  await go(page, 'die');
  await go(page, 'core-0');
  await page.locator('[data-clock-step]').click();
  expect((await state(page)).cpuCycle.time).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
