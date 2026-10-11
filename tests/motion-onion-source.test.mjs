import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { captureWriter, loadCapture } from '../tools/motion/session.mjs';
import { reviewMotion } from '../tools/motion/review.mjs';
import { renderOnionFrames } from '../tools/motion/frames.mjs';
import { onionLayers } from '../tools/motion/onion.mjs';
import { sceneCheckpoints } from '../tools/motion/scene-checkpoints.mjs';
import { previewReport } from '../tools/motion/preview.mjs';

function frame(i) {
  const png = new PNG({ width: 80, height: 40 });
  for (let y = 12; y < 28; y++)
    for (let x = 12 + (i % 48); x < 18 + (i % 48); x++)
      png.data.set([36, 76, 116, 255], (y * png.width + x) * 4);
  return PNG.sync.write(png);
}

test('saved capture onion and player share full-timeline states and source crop', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'onion-source-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'source');
  const output = join(directory, 'review');
  const writer = await captureWriter(source);
  await writer.begin({ source: { kind: 'frame-manifest', theme: 'light' } });
  for (let i = 0; i <= 60; i++) await writer.append({ time: i / 10, png: frame(i) });
  await writer.finish();
  const crop = { x: 10, y: 8, width: 60, height: 24 };
  const result = await reviewMotion({
    input: source,
    out: output,
    at: 3,
    radius: 2,
    crop,
    maxSize: 0,
  });
  const captured = await loadCapture(output);
  const plan = onionLayers(captured.samples, { at: 3, radius: 2 });
  assert.equal(captured.samples.length, 41);
  assert(plan.layers.length <= 9);
  assert.deepEqual(result.onion.layers, plan.layers);
  const data = JSON.parse(await readFile(join(output, 'motion.json'), 'utf8'));
  assert.equal(data.frames.length, 12, 'the detail strip remains independently bounded');
  assert(plan.layers.some((layer) => layer.time < data.frames[0].time));
  assert(plan.layers.some((layer) => layer.time > data.frames.at(-1).time));
  assert.deepEqual(result.onion.crop, crop);
  assert.equal(result.onion.width, crop.width);
  assert.equal(result.onion.height, crop.height);
  assert.equal(result.onion.scale, 1);

  const browser = await chromium.launch(chromiumLaunchOptions());
  t.after(() => browser.close());
  const preview = await previewReport(output);
  t.after(() => preview.close());
  const page = await browser.newPage();
  await page.goto(preview.url);
  await page.locator('.motion-play').evaluate((root) => {
    root.open = true;
    root.dispatchEvent(new CustomEvent('motionseek', { detail: { time: 3 } }));
  });
  await page.locator('[data-onion]').click();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('[data-onion-canvas]');
    return !canvas.hidden && canvas.dataset.time === '3';
  });
  const actual = await page.locator('[data-onion-canvas]').evaluate((canvas) => ({
    width: canvas.width,
    height: canvas.height,
    pixels: [...canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data],
  }));
  const expected = PNG.sync.read(await readFile(result.onionImage));
  assert.equal(actual.width, expected.width);
  assert.equal(actual.height, expected.height);
  // Compare displayed colour contributions; unpremultiplying faint pixels magnifies rounding.
  let error = 0;
  for (let p = 0; p < actual.pixels.length; p += 4) {
    error = Math.max(error, Math.abs(actual.pixels[p + 3] - expected.data[p + 3]));
    for (let c = 0; c < 3; c++)
      error = Math.max(
        error,
        Math.abs(
          (actual.pixels[p + c] * actual.pixels[p + 3]) / 255 -
            (expected.data[p + c] * expected.data[p + 3]) / 255,
        ),
      );
  }
  assert(error <= 1, `cropped player and source PNG differ visibly by ${error}/255`);
  await page.locator('[data-onion-canvas]').click();
  await page.waitForFunction(() => {
    const data = JSON.parse(document.querySelector('[data-inspection-data]').textContent || '{}');
    return data.requested?.point?.length === 2;
  });
  const point = await page
    .locator('[data-inspection-data]')
    .evaluate((n) => JSON.parse(n.textContent).requested.point);
  assert(
    Math.abs(point[0] - 40) < 1 && Math.abs(point[1] - 20) < 1,
    'inspection uses source coordinates after cropping',
  );
});

test('onion source decoding is bounded and preserves indices while scaling the crop', async () => {
  const full = Array.from({ length: 1001 }, (_, i) => ({ time: i / 100 }));
  const plan = onionLayers(full, { at: 5, radius: 2 });
  // Unselected sources deliberately have no raster: reading all sources would fail.
  for (const layer of plan.layers) full[layer.index].png = frame(layer.index);
  const crop = { x: 10, y: 8, width: 60, height: 24 };
  const onion = await renderOnionFrames(full, { at: 5, radius: 2, crop, maxSize: 30 });
  assert.deepEqual(onion.layers, plan.layers);
  assert.equal(onion.index, 500);
  assert.equal(onion.scale, 0.5);
  assert.equal(onion.width, 30);
  assert.equal(onion.height, 12);
  assert.equal(onion.sourceWidth, crop.width);
  assert.equal(onion.sourceHeight, crop.height);
});

test('an even scene sweep observes the requested onion center exactly', () => {
  const { times } = sceneCheckpoints({ duration: 10, from: 3, seconds: 4, at: 5, frames: 12 });
  assert.equal(times[0], 3);
  assert.equal(times.at(-1), 7);
  assert(times.includes(5), 'the scene capture must seek and observe the exact requested state');
  const onion = onionLayers(
    times.map((time) => ({ time })),
    { at: 5, radius: 2 },
  );
  assert.equal(onion.time, 5);
  assert.equal(onion.layers.at(-1).time, 5);
  assert.throws(
    () => sceneCheckpoints({ duration: 4, from: 3, seconds: 4, at: 5, frames: 12 }),
    /inside the selected scene interval/,
  );
});

test('CLI review rejects cue combined with an exact time before accessing the scene', async () => {
  await assert.rejects(
    reviewMotion({ input: '/unread-scene', out: '/unused-output', cue: 'move', at: 5, radius: 2 }),
    /Choose --cue or --at/,
  );
});
