import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';
import { analyzeMotionFrames, parseCrop } from '../tools/motion/frames.mjs';
import { reviewMotion } from '../tools/motion/review.mjs';
import { compareMotion } from '../tools/motion/comparison.mjs';
import { writeMotionReport } from '../tools/motion/report.mjs';

test('replays and linked capture folders cannot overwrite their source evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'motion-source-protection-'));
  try {
    const source = join(directory, 'source');
    const out = join(directory, 'report');
    await mkdir(source);
    await mkdir(out);
    const png = square(4);
    await writeFile(join(source, '0000.png'), png);
    await writeFile(join(source, '0001.png'), square(8));
    const manifest = join(source, 'frames.json');
    await writeFile(
      manifest,
      JSON.stringify({
        source: { kind: 'frame-manifest', path: manifest },
        frames: [
          { file: '0000.png', time: 0 },
          { file: '0001.png', time: 0.02 },
        ],
      }),
    );
    await symlink(source, join(out, 'capture'));
    await assert.rejects(reviewMotion({ input: manifest, out }), /overwrite/);
    assert.deepEqual(await readFile(join(source, '0000.png')), png);
    await rm(join(out, 'capture'));

    const html = '<!doctype html><button>Keep source</button>';
    const page = join(out, 'index.html');
    await writeFile(page, html);
    const replay = join(directory, 'replay.json');
    await writeFile(replay, JSON.stringify({ kind: 'motion-capture', url: page }));
    await assert.rejects(reviewMotion({ input: replay, out }), /overwrite/);
    assert.equal(await readFile(page, 'utf8'), html);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('managed output symlinks are refused before any source frame is overwritten', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'motion-output-links-'));
  try {
    const a = square(4),
      b = square(8);
    await writeFile(join(directory, 'a.png'), a);
    await writeFile(join(directory, 'b.png'), b);
    const manifest = join(directory, 'frames.json');
    await writeFile(
      manifest,
      JSON.stringify({
        source: { kind: 'frame-manifest', path: manifest },
        frames: [
          { file: 'a.png', time: 0 },
          { file: 'b.png', time: 0.02 },
        ],
      }),
    );
    for (const leaf of [
      'capture/0000.png',
      'capture/frames.json',
      'analysis/000.png',
      'index.html',
      'motion.png',
      'motion.json',
      'replay.json',
      'telemetry.json',
      'recording.mp4',
      'capture',
      'analysis',
    ]) {
      const out = join(directory, `report-${leaf.replaceAll('/', '-')}`);
      const path = join(out, leaf);
      await mkdir(join(path, '..'), { recursive: true });
      await symlink(join(directory, 'b.png'), path);
      await assert.rejects(reviewMotion({ input: manifest, out }), /overwrite symbolic link/);
      assert.deepEqual(await readFile(join(directory, 'b.png')), b, `${leaf} changed the source`);
    }
    // Narrated reviews enter the report writer directly and follow the same rule.
    const out = join(directory, 'direct-report');
    await mkdir(join(out, 'analysis'), { recursive: true });
    await symlink(join(directory, 'b.png'), join(out, 'analysis', '000.png'));
    await assert.rejects(writeMotionReport({}, out), /overwrite symbolic link/);
    assert.deepEqual(await readFile(join(directory, 'b.png')), b);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('baseline comparison rejects different source sizes hidden by downscaling', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'motion-baseline-size-'));
  try {
    const current = await analyzeMotionFrames(
      [
        { time: 0, png: square(4) },
        { time: 0.02, png: square(8) },
      ],
      { maxSize: 40 },
    );
    current.source = { kind: 'frame-manifest' };
    const previous = { ...current, sourceWidth: 160, sourceHeight: 80, scale: 0.25 };
    const file = join(directory, 'motion.json');
    await writeFile(file, JSON.stringify(previous));
    const comparison = await compareMotion(current, file);
    assert.match(comparison.warning, /Source size/);
    assert.equal(comparison.pairs.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

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

test('motion pixels retain a hold, its catch-up jump and irregular frame times', async () => {
  const positions = [2, 6, 10, 10, 10, 22, 26, 30];
  const times = [0, 0.02, 0.04, 0.06, 0.12, 0.14, 0.16, 0.18];
  const result = await analyzeMotionFrames(
    positions.map((x, i) => ({ time: times[i], png: square(x) })),
  );
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
  const smooth = await analyzeMotionFrames(
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

test('crop ignores outside changes, preserves scale and rejects invalid evidence', async () => {
  const samples = [
    { time: 0, png: square(8) },
    { time: 0.02, png: square(8, { flash: true, height: 60 }) },
  ];
  const whole = await analyzeMotionFrames(samples);
  assert.equal(whole.height, 60);
  assert.equal(whole.sizeChanged, true);
  assert.equal(whole.suggestedCrop, null);
  assert(whole.intervals[0].changedPercent > 0);
  const crop = await analyzeMotionFrames(samples, { crop: { x: 0, y: 8, width: 30, height: 20 } });
  assert.equal(crop.intervals[0].duplicate, true);
  assert.equal(crop.width, 30);
  await assert.rejects(
    () => analyzeMotionFrames(samples, { crop: { x: 70, y: 0, width: 20, height: 10 } }),
    /fit inside/,
  );
  await assert.rejects(() => analyzeMotionFrames([samples[0], samples[0]]), /strictly increasing/);
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

    const offsetVideo = join(directory, 'offset.mkv');
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-itsoffset',
      '5',
      '-i',
      video,
      '-c',
      'copy',
      offsetVideo,
    ]);
    const offsetResult = await reviewMotion({
      input: offsetVideo,
      out: join(directory, 'offset-review'),
      from: 5.1,
      frames: 2,
    });
    const offset = JSON.parse(await readFile(offsetResult.data, 'utf8'));
    assert.deepEqual(
      offset.frames.map((f) => f.time),
      [5.16, 5.2],
    );
    const scannedOffset = await reviewMotion({
      input: offsetVideo,
      out: join(directory, 'offset-scan'),
      from: 5.1,
      seconds: 0.15,
    });
    assert.equal(scannedOffset.recording.frames, 3);
    assert.equal(scannedOffset.recording.from, 5.16);
    assert.equal(scannedOffset.recording.to, 5.24);
    const collision = join(directory, 'motion.json');
    await writeFile(collision, JSON.stringify({ frames }));
    await assert.rejects(reviewMotion({ input: collision, out: directory }), /overwrite/);
    const imageCollision = join(directory, 'motion.png');
    await writeFile(imageCollision, square(2));
    const sourceManifest = join(directory, 'frames.json');
    await writeFile(
      sourceManifest,
      JSON.stringify({
        frames: [
          { file: 'motion.png', time: 0 },
          { file: 'frame-1.png', time: 0.04 },
        ],
      }),
    );
    await assert.rejects(reviewMotion({ input: sourceManifest, out: directory }), /overwrite/);
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
      const reducedAtStartup = matchMedia('(prefers-reduced-motion: reduce)').matches;
      document.querySelector('main').scene = {duration:1, pause(){}, seek(t){document.querySelector('circle').setAttribute('cx', reducedAtStartup ? 20 : 20 + 100 * t)}, review(){return {cues:[{id:'move',start:0.4,end:0.6}]}}};
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
    const selected = await reviewMotion({
      input: join(directory, 'index.html'),
      out: join(directory, 'cue-review'),
      cue: 'move',
      frames: 4,
      fps: 50,
    });
    assert.equal(selected.source.cue.id, 'move');
    assert(Math.abs(selected.window.from - 0.47) < 1e-9);
    assert(Math.abs(selected.window.to - 0.53) < 1e-9);
    assert(selected.timingMs.total > selected.timingMs.analysis);
    const reducedResult = await reviewMotion({
      input: directory,
      out: join(directory, 'reduced-review'),
      from: 0.2,
      frames: 3,
      reduced: true,
    });
    assert.equal(reducedResult.repeatedIntervals, 2);
    assert(reducedResult.notes.some((note) => note.includes('No change above threshold')));
    const svg = join(directory, 'animated.svg');
    await writeFile(
      svg,
      `<svg class="ve-scene" xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><circle cx="20" cy="50" r="10"/><script><![CDATA[
      document.querySelector('svg').scene = {duration:1,pause(){},seek(t){document.querySelector('circle').setAttribute('cx',20+100*t)}};
    ]]></script></svg>`,
    );
    const vectorResult = await reviewMotion({
      input: svg,
      out: join(directory, 'svg-review'),
      from: 0.2,
      frames: 3,
    });
    assert.equal(vectorResult.source.kind, 'scene-seek');
    assert.equal(vectorResult.repeatedIntervals, 0);
    await assert.rejects(
      reviewMotion({ input: join(directory, 'index.html'), out: directory }),
      /overwrite|separate/,
    );
    await assert.rejects(
      reviewMotion({ input: directory, out: join(directory, 'late'), from: 2 }),
      /fewer than two/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('alpha motion survives any sprite colour; hidden RGB noise is ignored', async () => {
  for (const value of [0, 229, 255]) {
    const frames = [5, 20].map((x, i) => {
      const image = new PNG({ width: 40, height: 30 });
      // Different invisible RGB is irrelevant to displayed motion.
      for (let p = 0; p < 1200; p++) image.data.fill(i * 50, p * 4, p * 4 + 3);
      for (let y = 10; y < 20; y++)
        for (let px = x; px < x + 8; px++) {
          const p = (y * 40 + px) * 4;
          image.data.fill(value, p, p + 3);
          image.data[p + 3] = 255;
        }
      return { time: i / 60, png: PNG.sync.write(image) };
    });
    const report = await analyzeMotionFrames(frames);
    assert(report.hasTransparency);
    assert(report.motionBounds);
    assert(!report.intervals[0].duplicate);
    assert.equal(report.intervals[0].changedPercent, (160 / 1200) * 100);
  }
  const a = new PNG({ width: 10, height: 10 }),
    b = new PNG({ width: 10, height: 10 });
  for (let p = 0; p < 100; p++) b.data.fill(100, p * 4, p * 4 + 3);
  const hidden = await analyzeMotionFrames([
    { time: 0, png: PNG.sync.write(a) },
    { time: 0.02, png: PNG.sync.write(b) },
  ]);
  assert(hidden.intervals[0].duplicate);
});

test('bounded overview retains native ROI coordinates and a source-resolution escape', async () => {
  const frames = [
    { time: 0, png: square(8) },
    { time: 0.02, png: square(12) },
  ];
  const overview = await analyzeMotionFrames(frames, { maxSize: 40 });
  assert.equal(overview.width, 40);
  assert.equal(overview.height, 20);
  assert.equal(overview.scale, 0.5);
  assert(overview.suggestedCrop.x <= 8);
  assert(overview.suggestedCrop.x + overview.suggestedCrop.width >= 20);
  const detail = await analyzeMotionFrames(frames, { crop: overview.suggestedCrop, maxSize: 0 });
  assert.equal(detail.scale, 1);
  assert(detail.intervals[0].changedPercent > 0);
  assert.throws(() => parseCrop(',,20,20'), /source pixels/);
  await assert.rejects(analyzeMotionFrames(frames, { maxSize: -1 }), /max-size/);
  await assert.rejects(analyzeMotionFrames(frames, { threshold: NaN }), /threshold/);
});
