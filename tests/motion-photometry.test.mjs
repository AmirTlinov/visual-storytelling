import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { scanTimeline } from '../tools/motion/timeline.mjs';
import { parseSlice } from '../tools/motion/photometry.mjs';
import { brightnessSpectrum } from '../tools/motion/spectrum.mjs';

const linear = (value) => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const close = (actual, expected, tolerance = 1e-6) =>
  assert(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);

async function raster(width, height, pixel) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  return sharp(data, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

async function decoded(uri) {
  return sharp(Buffer.from(uri.split(',')[1], 'base64'))
    .raw()
    .toBuffer({ resolveWithObject: true });
}
const pixelAt = ({ data, info }, x, y) => [
  ...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3),
];
const samples = (pngs, times = pngs.map((_, i) => i / 20)) =>
  pngs.map((png, i) => ({ png, time: times[i] }));

test('photometry measures linear sRGB and alpha without exposing hidden RGB', async () => {
  const gray = await raster(2, 2, () => [128, 128, 128, 255]);
  const grayResult = (await scanTimeline(samples([gray, gray]))).photometry;
  close(grayResult.points[0].luminance, linear(128) * 100);
  close(grayResult.points[0].red, 128);
  close(grayResult.points[0].saturation, 0);
  assert.equal(grayResult.reference.time, 0);
  assert.deepEqual(pixelAt(await decoded(grayResult.reference.image), 0, 0), [128, 128, 128]);

  const hidden = await Promise.all([
    raster(2, 2, () => [255, 0, 100, 0]),
    raster(2, 2, () => [0, 180, 255, 0]),
  ]);
  for (const [theme, expected] of [
    ['light', 100],
    ['dark', 0],
  ]) {
    const result = await scanTimeline(samples(hidden), 8, { source: { theme } });
    assert(result.intervals[0].duplicate);
    result.photometry.points.forEach((point) => {
      close(point.luminance, expected);
      close(point.alpha, 0);
      close(point.saturation, 0);
    });
    assert.deepEqual(
      pixelAt(await decoded(result.photometry.reference.image), 0, 0),
      new Array(3).fill(theme === 'light' ? 255 : 0),
    );
  }
  const translucent = await raster(2, 2, () => [255, 0, 0, 128]);
  for (const [theme, matte] of [
    ['light', 1],
    ['dark', 0],
  ]) {
    const result = await scanTimeline(samples([translucent, translucent]), 8, {
      source: { theme },
    });
    close(
      result.photometry.points[0].luminance,
      ((0.2126 * 128) / 255 + matte * (1 - 128 / 255)) * 100,
    );
    close(result.photometry.points[0].alpha, (128 / 255) * 100);
    const point = result.photometry.points[0];
    assert.deepEqual(
      pixelAt(await decoded(result.photometry.reference.image), 0, 0),
      [point.red, point.green, point.blue].map(Math.round),
    );
  }
  const rangeFrames = await Promise.all([
    raster(2, 2, () => [255, 0, 0, 255]),
    raster(2, 2, () => [0, 0, 255, 255]),
  ]);
  const ranged = (await scanTimeline(samples([...rangeFrames, hidden[0]]))).photometry;
  const expectedRanges = {
    luminance: [7.22, 100],
    red: [0, 255],
    green: [0, 255],
    blue: [0, 255],
    saturation: [0, 100],
    alpha: [0, 100],
  };
  assert.deepEqual(Object.keys(ranged.ranges), Object.keys(expectedRanges));
  for (const [key, range] of Object.entries(expectedRanges))
    range.forEach((value, i) => close(ranged.ranges[key][i], value));
});

test('shared downsampling preserves light energy and tiny frames retain their real area', async () => {
  const checker = await raster(480, 4, (x) => [...new Array(3).fill(x % 2 ? 255 : 0), 255]);
  const result = await scanTimeline(samples([checker, checker]));
  assert.deepEqual(result.photometry.raster, { width: 240, height: 2 });
  close(result.photometry.points[0].luminance, 50, 0.6);
  assert.equal(result.photometry.roi.width, 480);

  const black = await raster(1, 1, () => [0, 0, 0, 255]);
  const white = await raster(1, 1, () => [255, 255, 255, 255]);
  const tiny = await scanTimeline(samples([black, white, black]));
  assert.equal(tiny.intervals[0].changedPercent, 100);
  assert(tiny.signals.some((signal) => signal.kind === 'brief-reversal'));
  assert.equal(tiny.photometry.points[0].regions.filter((v) => v === null).length, 11);
  assert.deepEqual(
    tiny.photometry.regions.empty,
    Array.from({ length: 11 }, (_, i) => i + 1),
  );
  assert.equal(tiny.photometry.kymograph.gapColumns, 0);
  const regionMap = await decoded(tiny.photometry.regions.image);
  assert.notEqual(
    pixelAt(regionMap, 0, 1)[0],
    pixelAt(regionMap, 0, 1)[1],
    'empty cells have a coloured marker',
  );
  assert.notDeepEqual(
    pixelAt(regionMap, 0, 1),
    pixelAt(regionMap, 4, 1),
    'unknown cells are hatched',
  );

  const almostBlack = await raster(1, 1, () => [1, 1, 1, 255]);
  const dark = (await scanTimeline(samples([almostBlack, almostBlack]))).photometry;
  assert.deepEqual(pixelAt(await decoded(dark.kymograph.image), 0, 0), [1, 1, 1]);
});

test('ICC-tagged browser frames retain their colour and visible changes after cropping', async () => {
  for (const profile of ['srgb', 'p3']) {
    const pngs = await Promise.all(
      [128, 192].map(async (gray) =>
        sharp(await raster(480, 320, () => [gray, gray, gray, 255]))
          .withIccProfile(profile)
          .png()
          .toBuffer(),
      ),
    );
    const result = await scanTimeline(samples(pngs), 8, {
      crop: { x: 80, y: 40, width: 320, height: 200 },
    });
    assert.equal(result.intervals[0].changedPercent, 100);
    assert.equal(result.intervals[0].duplicate, false);
    for (const [i, gray] of [128, 192].entries()) {
      close(result.photometry.points[i].luminance, linear(gray) * 100, 0.5);
      close(result.photometry.points[i].red, gray, 1);
    }
    assert.deepEqual(
      pixelAt(await decoded(result.photometry.reference.image), 0, 0),
      [128, 128, 128],
    );
  }
});

test('kymograph follows horizontal and vertical motion and honours an explicit strip', async () => {
  for (const axis of ['x', 'y']) {
    const positions = [2, 8, 14];
    const pngs = await Promise.all(
      positions.map((position) =>
        raster(24, 24, (x, y) => {
          const moving =
            axis === 'x'
              ? x >= position && x < position + 2 && y >= 6 && y < 10
              : y >= position && y < position + 2 && x >= 6 && x < 10;
          return moving ? [0, 0, 0, 255] : [255, 255, 255, 255];
        }),
      ),
    );
    const result = (await scanTimeline(samples(pngs))).photometry;
    assert.equal(result.kymograph.axis, axis);
    assert(result.kymograph.automatic);
    const image = await decoded(result.kymograph.image);
    const darkest = (x) =>
      Array.from({ length: image.info.height }, (_, y) => pixelAt(image, x, y)[0]).reduce(
        (best, value, y, values) => (value < values[best] ? y : best),
        0,
      );
    assert.equal(darkest(0), 2);
    assert.equal(darkest(image.info.width - 1), 14);

    const outside = (
      await scanTimeline(samples(pngs), 8, {
        slice: { axis, position: 0, thickness: 1 },
      })
    ).photometry;
    assert.equal(outside.kymograph.automatic, false);
    assert((await decoded(outside.kymograph.image)).data.every((v) => v === 255));
  }
});

test('linear time axes show long gaps without fabricating intermediate pixels', async () => {
  const pngs = await Promise.all(
    [0, 255, 0].map((gray) => raster(4, 3, () => [gray, gray, gray, 255])),
  );
  const result = (await scanTimeline(samples(pngs, [0, 0.1, 2]))).photometry;
  const kymo = await decoded(result.kymograph.image);
  const regions = await decoded(result.regions.image);
  const middle = Math.floor(kymo.info.width / 2);
  assert.notEqual(
    pixelAt(kymo, middle, 0)[0],
    pixelAt(kymo, middle, 0)[1],
    'gaps cannot be mistaken for real gray',
  );
  assert.notDeepEqual(pixelAt(kymo, middle, 0), pixelAt(kymo, middle + 4, 0), 'gaps are hatched');
  assert.deepEqual(pixelAt(regions, middle, 0), pixelAt(kymo, middle, 0));
  const markedColumns = Array.from({ length: kymo.info.width }, (_, x) =>
    pixelAt(kymo, x, 0),
  ).filter(([r, g]) => r !== g).length;
  assert.equal(result.kymograph.gapColumns, markedColumns);
  assert(result.kymograph.gapColumns > 0);
  assert.deepEqual(result.regions.empty, []);
  assert.deepEqual(pixelAt(kymo, 0, 0), [0, 0, 0]);
  assert.deepEqual(
    pixelAt(kymo, Math.round(((kymo.info.width - 1) * 0.1) / 2), 0),
    [255, 255, 255],
  );
  assert.deepEqual(
    result.points.map((point) => point.time),
    [0, 0.1, 2],
  );
});

test('crop fixes source coordinates and image-size changes require a common ROI', async () => {
  const crop = { x: 8, y: 6, width: 12, height: 8 };
  const first = await raster(24, 20, (x, y) =>
    x >= 8 && x < 20 && y >= 6 && y < 14 ? [128, 128, 128, 255] : [0, 0, 0, 255],
  );
  const second = await raster(32, 24, (x, y) =>
    x >= 8 && x < 20 && y >= 6 && y < 14 ? [128, 128, 128, 255] : [255, 255, 255, 255],
  );
  const cropped = await scanTimeline(samples([first, second]), 8, {
    crop,
    slice: parseSlice('x,8,1'),
  });
  assert(cropped.intervals[0].duplicate);
  assert.deepEqual(cropped.photometry.roi, crop);
  assert.equal(cropped.photometry.kymograph.from, 8);
  assert.equal(cropped.photometry.kymograph.to, 20);
  close(cropped.photometry.kymograph.position, 8.5);
  const uncropped = await scanTimeline(samples([first, second]));
  assert.equal(uncropped.photometry.status, 'skipped');
  await assert.rejects(
    scanTimeline(samples([first, second]), 8, { crop: { x: 0, y: 0, width: 25, height: 20 } }),
    /Crop must fit/,
  );
  await assert.rejects(
    scanTimeline(samples([first, first]), 8, { crop, slice: parseSlice('x,2,1') }),
    /slice must lie/,
  );
  for (const invalid of ['x,,3', 'z,0,3', 'x,0,0', 'x,0,1,2'])
    assert.throws(() => parseSlice(invalid), /slice/);
});

const periodicPoints = (length = 256, rate = 64, frequency = 8) =>
  Array.from({ length }, (_, i) => ({
    time: i / rate,
    luminance: 50 + 20 * Math.sin((2 * Math.PI * frequency * i) / rate),
    regions: new Array(12).fill(null),
  }));

test('STFT identifies a known regional periodicity without treating empty cells as data', () => {
  const points = periodicPoints();
  const spectrum = brightnessSpectrum(points);
  assert.equal(spectrum.status, 'available');
  close(spectrum.frequencyHz, 8);
  assert.equal(spectrum.region, 'Вся область');
  assert(spectrum.persistent > 0.9);
  assert(spectrum.power.every((column) => column.every(Number.isFinite)));
  assert(spectrum.times[0] > points[0].time && spectrum.times.at(-1) < points.at(-1).time);
  const regional = points.map((point) => ({
    ...point,
    luminance: 50,
    regions: [point.luminance, 100 - point.luminance, ...new Array(10).fill(null)],
  }));
  const local = brightnessSpectrum(regional);
  assert.equal(local.status, 'available');
  close(local.frequencyHz, 8);
  assert.match(local.region, /^Область [12]$/);
  const incomplete = points.map((point, i) => ({
    ...point,
    luminance: 50,
    regions: [i % 2 ? null : point.luminance],
  }));
  assert.equal(brightnessSpectrum(incomplete).status, 'skipped');
});

test('STFT declines short, sparse, uneven and unresolved signals instead of inventing frequencies', () => {
  const points = periodicPoints();
  for (const [input, options] of [
    [points.slice(0, 63), {}],
    [periodicPoints(64, 120), {}],
    [points, { sparse: true }],
    [points, { sizeChanged: true }],
    [points.map((point, i) => ({ ...point, time: point.time + (i === 70 ? 0.004 : 0) })), {}],
    [points.map((point, i) => ({ ...point, time: i === 70 ? NaN : point.time })), {}],
    [points.map((point, i) => ({ ...point, time: i === 70 ? points[69].time : point.time })), {}],
    [points.map((point, i) => ({ ...point, luminance: i / 4 })), {}],
    [periodicPoints(65, 64, 2), {}],
  ]) {
    const result = brightnessSpectrum(input, options);
    assert.equal(result.status, 'skipped');
    assert.equal(result.frequencyHz, undefined);
  }
});

test('external frame timestamps must be finite and strictly increasing before decoding', async () => {
  for (const times of [
    [0, 0],
    [0.1, 0],
    [0, NaN],
    [0, Infinity],
  ]) {
    await assert.rejects(
      scanTimeline(times.map((time) => ({ time, png: Buffer.alloc(0) }))),
      /strictly increasing/,
    );
  }
  await assert.rejects(scanTimeline([]), /at least two frames/);
});
