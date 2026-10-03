import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';
import { analyzeMotionFrames } from '../tools/motion-frames.mjs';
import { reviewMotion } from '../tools/motion-review.mjs';

function square(x, { flash = false, height = 40 } = {}) {
  const image = new PNG({ width: 80, height });
  image.data.fill(255);
  for (let y = 10; y < 22; y++)
    for (let px = x; px < x + 8; px++) {
      const i = (y * image.width + px) * 4;
      image.data[i] = 20;
      image.data[i + 1] = 70;
      image.data[i + 2] = 120;
    }
  if (flash) for (let p = 0; p < 80; p++) image.data.fill(0, p * 4, p * 4 + 3);
  return PNG.sync.write(image);
}

test('motion pixels retain a hold, its catch-up jump and irregular frame times', () => {
  const positions = [2, 6, 10, 10, 10, 22, 26, 30];
  const times = [0, 0.02, 0.04, 0.06, 0.12, 0.14, 0.16, 0.18];
  const result = analyzeMotionFrames(positions.map((x, i) => ({ time: times[i], png: square(x) })));
  assert.equal(result.frames.length, 8);
  assert(result.motionBounds.x <= 2 && result.motionBounds.x + result.motionBounds.width >= 38);
  assert.deepEqual(
    result.frames.map((f) => f.time),
    times,
  );
  assert.deepEqual(
    result.intervals.filter((v) => v.duplicate).map((v) => v.to),
    [3, 4],
  );
  assert.equal(result.intervals[3].dtMs, 60);
  assert(result.intervals[4].changedPercent > result.intervals[0].changedPercent);
  assert.equal(result.intervals[2].changedPercent, 0);
  const smooth = analyzeMotionFrames(
    positions.map((_, i) => ({ time: times[i], png: square(2 + i * 4) })),
  );
  assert(
    smooth.intervals.every(
      (v) => v.changedPercent === smooth.intervals[0].changedPercent && !v.duplicate,
    ),
  );
  const overlay = PNG.sync.read(Buffer.from(result.overlay.split(',')[1], 'base64'));
  const first = (21 * 80 + 2) * 4,
    last = (21 * 80 + 30) * 4;
  assert(overlay.data[first + 2] > overlay.data[first], 'early contour must be blue');
  assert(overlay.data[last] > overlay.data[last + 2], 'late contour must be orange');
});

test('crop ignores outside changes, preserves scale and rejects invalid evidence', () => {
  const samples = [
    { time: 0, png: square(8) },
    { time: 0.02, png: square(8, { flash: true, height: 60 }) },
  ];
  const whole = analyzeMotionFrames(samples);
  assert.equal(whole.height, 60);
  assert.equal(whole.sizeChanged, true);
  assert(whole.intervals[0].changedPercent > 0);
  const crop = analyzeMotionFrames(samples, { crop: { x: 0, y: 8, width: 30, height: 20 } });
  assert.equal(crop.intervals[0].duplicate, true);
  assert.equal(crop.width, 30);
  assert.throws(
    () => analyzeMotionFrames(samples, { crop: { x: 70, y: 0, width: 20, height: 10 } }),
    /fit inside/,
  );
  assert.throws(() => analyzeMotionFrames([samples[0], samples[0]]), /strictly increasing/);
});

test('PNG manifest and VFR video produce the same ordered evidence without removing duplicates', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'motion-media-'));
  try {
    const positions = [2, 6, 6, 18, 22];
    const times = [0, 0.04, 0.16, 0.2, 0.24];
    const frames = [];
    for (let i = 0; i < positions.length; i++) {
      const file = `frame-${i}.png`;
      await writeFile(join(directory, file), square(positions[i]));
      frames.push({ file, time: times[i] });
    }
    const manifest = join(directory, 'motion<example>.json');
    await writeFile(manifest, JSON.stringify({ frames }));
    const jsonResult = await reviewMotion({
      input: manifest,
      out: join(directory, 'json-review'),
      frames: 5,
    });
    const json = JSON.parse(await readFile(jsonResult.data, 'utf8'));
    assert.deepEqual(
      json.frames.map((f) => f.time),
      times,
    );
    assert(json.intervals[1].duplicate);
    assert(!JSON.stringify(json).includes('base64'));
    const png = PNG.sync.read(await readFile(jsonResult.image));
    assert.equal(png.width, 1320);
    const html = await readFile(jsonResult.path, 'utf8');
    assert(html.includes('motion&lt;example&gt;.json'));
    const list = frames
      .map(
        (f, i) =>
          `file '${f.file}'\nduration ${i + 1 < times.length ? times[i + 1] - times[i] : 0.04}`,
      )
      .join('\n');
    await writeFile(join(directory, 'frames.txt'), list);
    const video = join(directory, 'recording.mkv');
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      join(directory, 'frames.txt'),
      '-fps_mode',
      'vfr',
      '-c:v',
      'ffv1',
      video,
    ]);
    const videoResult = await reviewMotion({
      input: video,
      out: join(directory, 'video-review'),
      frames: 5,
    });
    const recording = JSON.parse(await readFile(videoResult.data, 'utf8'));
    assert.deepEqual(
      recording.frames.map((f) => f.time),
      times,
    );
    assert.deepEqual(
      recording.intervals.map((v) => v.duplicate),
      json.intervals.map((v) => v.duplicate),
    );
    const windowResult = await reviewMotion({
      input: video,
      out: join(directory, 'window-review'),
      from: 0.1,
      frames: 2,
    });
    const window = JSON.parse(await readFile(windowResult.data, 'utf8'));
    assert.deepEqual(
      window.frames.map((f) => f.time),
      [0.16, 0.2],
    );
    await assert.rejects(
      reviewMotion({ input: video, out: join(directory, 'invalid'), fps: 30 }),
      /keep their own times/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('scene motion uses the existing seek owner and labels its clock as model time', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'motion-scene-'));
  try {
    await writeFile(
      join(directory, 'index.html'),
      `<!doctype html><main class="ve-scene"><svg width="200" height="100"><circle cx="20" cy="50" r="10"/></svg></main><script>
      document.querySelector('main').scene = {duration:1, pause(){}, seek(t){document.querySelector('circle').setAttribute('cx', 20 + 100 * t)}};
      </script>`,
    );
    const result = await reviewMotion({
      input: directory,
      out: join(directory, 'review'),
      from: 0.2,
      frames: 4,
      fps: 50,
    });
    const report = JSON.parse(await readFile(result.data, 'utf8'));
    assert.equal(report.source.kind, 'scene-seek');
    assert.deepEqual(
      report.frames.map((f) => Number(f.time.toFixed(2))),
      [0.2, 0.22, 0.24, 0.26],
    );
    assert(report.intervals.every((v) => v.changedPercent > 0));
    assert((await readFile(result.path, 'utf8')).includes('время модели'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
