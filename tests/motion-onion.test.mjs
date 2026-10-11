import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { chromium } from 'playwright';
import { onionLayers, composeChange, temporalChangeStrength } from '../tools/motion/onion.mjs';
import { analyzeMotionFrames } from '../tools/motion/frames.mjs';
import { selectDetail } from '../tools/motion/timeline.mjs';
import { writeMotionReport } from '../tools/motion/report.mjs';

function samples({ alpha = 255, opaque = false } = {}) {
  return [0, 0.5, 1, 1.5, 2].map((time, i) => {
    const png = new PNG({ width: 80, height: 40 });
    if (opaque) png.data.fill(255);
    for (let y = 16; y < 24; y++)
      for (let x = 4 + i * 14; x < 12 + i * 14; x++) {
        const p = (y * png.width + x) * 4;
        png.data.set([34, 60, 88, alpha], p);
      }
    return { time, png: PNG.sync.write(png) };
  });
}

test('onion weights follow actual elapsed time, retain the requested center and stay bounded', () => {
  const frames = [0, 0.25, 0.8, 1, 1.2, 1.75, 2].map((time) => ({ time }));
  const view = onionLayers(frames, { at: 1.01, radius: 1 });
  assert.equal(view.time, 1);
  assert.equal(view.requestedTime, 1.01);
  assert.equal(view.layers.at(-1).opacity, 1);
  const weight = (time) => view.layers.find((layer) => layer.time === time)?.opacity;
  assert.equal(weight(0.25), 0.125);
  assert.equal(weight(0.8), 0.4);
  assert.equal(weight(1.2), 0.4);
  assert.equal(weight(1.75), 0.125);
  assert.equal(weight(0), undefined);
  assert.equal(weight(2), undefined);
  const dense = Array.from({ length: 10_001 }, (_, i) => ({ time: i / 1000 }));
  assert(onionLayers(dense, { at: 5, radius: 5 }).layers.length <= 9);
  assert(onionLayers(dense, { at: 0 }).layers.every((layer) => layer.offset >= 0));
  assert(onionLayers(dense, { at: 10 }).layers.every((layer) => layer.offset <= 0));
  assert(selectDetail(dense, { at: 5.005, count: 12 }).some((frame) => frame.time === 5.005));
  assert.equal(
    onionLayers(
      [0, 1, 2, 3, 4].map((time) => ({ time })),
      { at: 2, radius: 100 },
    ).layers.length,
    5,
  );
});

test('the composite preserves source transparency, fixed positions and the clear present', async () => {
  const report = await analyzeMotionFrames(samples({ alpha: 128 }), { at: 1, radius: 1.5 });
  const png = PNG.sync.read(Buffer.from(report.onion.image.split(',')[1], 'base64'));
  const pixel = (x) => [
    ...png.data.subarray((20 * png.width + x) * 4, (20 * png.width + x) * 4 + 4),
  ];
  assert.equal(pixel(2)[3], 0, 'empty space stays transparent');
  assert.equal(pixel(35)[3], 128, 'the present keeps its source alpha');
  assert.equal(pixel(21)[3], pixel(49)[3], 'equal time distances have equal weights');
  assert(pixel(7)[3] < pixel(21)[3] && pixel(21)[3] < pixel(35)[3]);
  assert(pixel(21)[2] > pixel(21)[0], 'past differences are blue');
  assert(pixel(49)[0] > pixel(49)[2], 'future differences are red');
  assert(
    pixel(35)
      .slice(0, 3)
      .every((v, i) => Math.abs(v - [34, 60, 88][i]) <= 2),
  );
});

test('green change strength distinguishes smooth transitions while retaining unchanged detail', () => {
  const before = new Uint8ClampedArray([12, 18, 24, 255, 0, 0, 0, 0, 34, 60, 88, 255]);
  const after = new Uint8ClampedArray([12, 18, 24, 255, 0, 0, 0, 0, 230, 240, 250, 255]);
  const smooth = composeChange(before, after, 3, 1, temporalChangeStrength({ magnitude: 1 }));
  const jump = composeChange(before, after, 3, 1, temporalChangeStrength({ magnitude: 8 }));
  assert.deepEqual([...jump.slice(0, 8)], [...after.slice(0, 8)]);
  assert.equal(jump[11], 255);
  assert(jump[9] - jump[8] > smooth[9] - smooth[8], 'a jump has a stronger green tint');
  assert(jump[8] > 150, 'the changed after-frame retains readable light detail');
});

test('saved player shares the PNG weights, seeks in both directions and restores the original frame', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'onion-player-'));
  const browser = await chromium.launch(chromiumLaunchOptions());
  t.after(async () => {
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  });
  const context = await browser.newContext();
  const report = {
    ...(await analyzeMotionFrames(samples({ opaque: true }), {
      at: 1,
      radius: 1.5,
      crop: { x: 0, y: 8, width: 80, height: 24 },
    })),
    source: { kind: 'frame-manifest' },
  };
  const result = await writeMotionReport(report, directory, { context });
  const png = PNG.sync.read(await readFile(result.onionImage));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(pathToFileURL(result.path).href);
  await page.locator('.motion-play').evaluate((root) => {
    root.open = true;
    root.dispatchEvent(new CustomEvent('motionseek', { detail: { time: 1 } }));
  });
  await page.locator('[data-onion]').click();
  await page.waitForFunction(() => {
    const c = document.querySelector('[data-onion-canvas]');
    return !c.hidden && c.dataset.time === '1';
  });
  const pixels = await page
    .locator('[data-onion-canvas]')
    .evaluate((canvas) => [
      ...canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data,
    ]);
  const error = Math.max(...pixels.map((v, i) => Math.abs(v - png.data[i])));
  assert(error <= 3, `browser and static PNG differ by ${error}/255`);
  const corner = [...png.data.subarray(0, 3)];
  assert.deepEqual(corner, [255, 255, 255], 'unchanged background retains its colours');
  await page.getByLabel('Перейти ко времени, секунды').fill('0.9');
  await page.getByLabel('Перейти ко времени, секунды').press('Tab');
  assert.equal(await page.getByLabel('Перейти ко времени, секунды').inputValue(), '1');
  await page.locator('.motion-play').evaluate((root) => {
    for (const time of [2, 0, 1.5, 0.5])
      root.dispatchEvent(new CustomEvent('motionseek', { detail: { time } }));
  });
  await page.waitForFunction(() => {
    const c = document.querySelector('[data-onion-canvas]');
    return !c.hidden && c.dataset.time === '0.5';
  });
  assert.equal(
    await page.getByLabel('Время записи', { exact: true }).getAttribute('aria-valuenow'),
    '0.5',
  );
  await page.getByLabel('Радиус наложения, секунды').fill('0.1');
  await page.getByLabel('Радиус наложения, секунды').press('Tab');
  await page.waitForFunction(() =>
    document.querySelector('[data-onion-status]').textContent.includes('кадров: 1'),
  );
  await page.getByLabel('Радиус наложения, секунды').fill('0.105');
  await page.getByLabel('Радиус наложения, секунды').press('Tab');
  assert(
    await page.getByLabel('Радиус наложения, секунды').evaluate((input) => input.validity.valid),
  );
  await page.locator('[data-onion]').click();
  assert(await page.locator('.motion-play img').isVisible());
  assert.equal(await page.locator('.motion-play img').getAttribute('src'), report.frames[1].image);
  const chart = page.getByRole('slider', { name: 'Время записи' });
  await chart.focus();
  await chart.press('ArrowRight');
  assert.equal(await chart.getAttribute('aria-valuenow'), '1');
  assert(await chart.evaluate((element) => element === document.activeElement));
  assert.equal(await page.locator('.motion-play').getAttribute('data-mode'), 'frame');
  assert(await page.locator('.motion-play img').isVisible());
  assert.equal(await page.locator('.motion-play img').getAttribute('src'), report.frames[2].image);
  await page.getByRole('button', { name: 'Следующий кадр', exact: true }).click();
  assert.equal(await chart.getAttribute('aria-valuenow'), '1.5');
  await page.getByRole('button', { name: 'Предыдущий кадр', exact: true }).click();
  assert.equal(await chart.getAttribute('aria-valuenow'), '1');
  for (const mode of ['frame', 'onion', 'change']) {
    await page.locator(`[data-view="${mode}"]`).click();
    const box = await chart.boundingBox();
    await page.mouse.click(box.x + box.width * 0.7, box.y + box.height / 2);
    assert.equal(await page.locator('.motion-play').getAttribute('data-mode'), mode);
    await chart.press('Home');
    assert.equal(await chart.getAttribute('aria-valuenow'), '0');
    assert.equal(await page.locator('.motion-play').getAttribute('data-mode'), mode);
    await page.getByRole('button', { name: 'Следующий кадр', exact: true }).click();
    assert.equal(await chart.getAttribute('aria-valuenow'), '0.5');
    assert.equal(await page.locator('.motion-play').getAttribute('data-mode'), mode);
    await chart.focus();
    await chart.press('ArrowRight');
    assert.equal(await chart.getAttribute('aria-valuenow'), '1');
    assert.equal(await page.locator('.motion-play').getAttribute('data-mode'), mode);
  }
  await page.waitForFunction(() => {
    const canvas = document.querySelector('[data-onion-canvas]');
    return !canvas.hidden && canvas.dataset.time === '1';
  });
  assert.equal(await page.locator('[data-view="change"]').getAttribute('aria-pressed'), 'true');
  await page.getByLabel('Перейти ко времени, секунды').fill('');
  await page.getByLabel('Перейти ко времени, секунды').press('Tab');
  assert.equal(await page.getByLabel('Перейти ко времени, секунды').inputValue(), '1');
  await page.locator('.motion-play').evaluate((root) => {
    root.dispatchEvent(new CustomEvent('motionrange', { detail: { from: 0, to: 0.5 } }));
    root.dispatchEvent(new CustomEvent('motionseek', { detail: { time: 1.5 } }));
    root.querySelector('[data-play]').click();
  });
  assert.equal(
    await chart.getAttribute('aria-valuenow'),
    '1.5',
    'manual seek clears the old episode range',
  );
  await page.locator('[data-play]').click();
  await page.locator('[data-view="frame"]').click();
  assert(await page.locator('.motion-play img').isVisible());
  await page.setViewportSize({ width: 800, height: 600 });
  await page.locator('[data-onion]').click();
  await page.waitForFunction(() => {
    const root = document.querySelector('.motion-play');
    return (
      !root.querySelector('[data-onion-canvas]').hidden &&
      root.getBoundingClientRect().height <= innerHeight - 31
    );
  });
  assert(
    await page
      .locator('.motion-play button')
      .evaluateAll((buttons) =>
        buttons.every((button) => button.getBoundingClientRect().height >= 44),
      ),
    'fitting the frame preserves the controls touch targets',
  );
  await page.setViewportSize({ width: 375, height: 800 });
  assert(await page.locator('[data-onion]').isVisible());
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
});
