import { mkdtemp, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, extname, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { renderer } from './render.mjs';
import { analyzeMotionFrames } from './motion-frames.mjs';
import { writeMotionReport } from './motion-report.mjs';

const run = promisify(execFile);

async function videoFrames(input, from, count) {
  const temporary = await mkdtemp(join(tmpdir(), 'visual-motion-'));
  try {
    // showinfo and PNGs come from the same decode pass; no fps filter or frame synthesis.
    const { stderr } = await run(
      'ffmpeg',
      [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'info',
        '-copyts',
        '-seek_timestamp',
        '1',
        '-ss',
        String(from),
        // Discard by absolute PTS below, including containers with non-zero start_time.
        '-noaccurate_seek',
        '-i',
        input,
        '-map',
        '0:v:0',
        '-an',
        '-sn',
        '-dn',
        '-vf',
        `select=gte(t\\,${from}),showinfo`,
        '-frames:v',
        String(count),
        '-fps_mode',
        'passthrough',
        join(temporary, '%03d.png'),
      ],
      { maxBuffer: 8 * 1024 * 1024 },
    );
    const times = [...stderr.matchAll(/\bn:\s*\d+\s+pts:.*?\bpts_time:([\d.e+\-]+)/g)].map((m) =>
      Number(m[1]),
    );
    const files = (await readdir(temporary)).filter((name) => name.endsWith('.png')).sort();
    if (files.length < 2 || times.length < files.length)
      throw new Error('Video interval needs at least two decoded frames with PTS');
    return await Promise.all(
      files.map(async (file, i) => ({
        time: times[i],
        png: await readFile(join(temporary, file)),
      })),
    );
  } finally {
    // Awaited decoding and reads finish before cleanup.
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function reviewMotion({
  input,
  out,
  from,
  frames = 12,
  fps,
  width = 960,
  theme = 'light',
  reduced = false,
  crop,
  cue,
  threshold,
  maxSize,
}) {
  const started = performance.now();
  if (
    (from !== undefined && (!Number.isFinite(from) || from < 0)) ||
    !Number.isInteger(frames) ||
    frames < 2 ||
    frames > 32
  )
    throw new Error('Choose --from >= 0 and --frames between 2 and 32');
  input = await realpath(input);
  out = resolve(out);
  // Resolve an existing ancestor too, so an output symlink cannot hide a collision.
  async function canonical(path) {
    try {
      return await realpath(path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return join(await canonical(dirname(path)), basename(path));
    }
  }
  out = await canonical(out);
  const outputs = new Set(
    await Promise.all(
      ['index.html', 'motion.png', 'motion.json'].map((name) => canonical(join(out, name))),
    ),
  );
  const protect = (path) => {
    if (path === out || outputs.has(path))
      throw new Error(
        'Review output would overwrite its input; choose a separate output directory',
      );
  };
  protect(input);
  let capture;
  try {
    let samples, source;
    const isDirectory = (await stat(input)).isDirectory();
    if (isDirectory || ['.html', '.htm', '.svg'].includes(extname(input).toLowerCase())) {
      if (!isDirectory && dirname(input) === out)
        throw new Error('Scene review needs a separate output directory');
      fps ??= 60;
      if (!Number.isFinite(fps) || fps < 1 || fps > 240)
        throw new Error('Scene --fps must be between 1 and 240');
      capture = await renderer({
        directory: isDirectory ? input : dirname(input),
        entry: isDirectory ? 'index.html' : basename(input),
        width,
        theme,
        reduced,
      });
      if (!capture.info.seekable)
        throw new Error(
          'This scene has no seekable timeline; review a recording of the interaction',
        );
      let selectedCue;
      if (cue) {
        const review = await capture.capture.evaluate((scene) => scene.review());
        selectedCue = review.cues.find((item) => item.id === cue);
        if (!selectedCue)
          throw new Error(
            `Unknown motion cue: ${cue}. Available: ${review.cues.map((item) => item.id).join(', ')}`,
          );
        from ??= Math.max(
          selectedCue.start,
          (selectedCue.start + selectedCue.end - (frames - 1) / fps) / 2,
        );
      }
      from ??= 0;
      const end = selectedCue
        ? Math.min(selectedCue.end, capture.info.duration)
        : capture.info.duration;
      samples = [];
      for (let i = 0; i < frames && from + i / fps <= end + 1e-9; i++) {
        const time = from + i / fps;
        await capture.seek(time);
        samples.push({ time, png: await capture.png() });
      }
      source = {
        kind: 'scene-seek',
        path: input,
        duration: capture.info.duration,
        fps,
        theme,
        reduced,
        ...(selectedCue
          ? { cue: { id: cue, start: selectedCue.start, end: selectedCue.end } }
          : {}),
      };
    } else {
      from ??= 0;
      if (cue) throw new Error('--cue applies to scenes; choose recording time with --from');
      if (fps !== undefined)
        throw new Error(
          '--fps applies to scene sampling; recordings and manifests keep their own times',
        );
      if (extname(input).toLowerCase() === '.json') {
        const manifest = JSON.parse(await readFile(input, 'utf8'));
        if (!Array.isArray(manifest.frames))
          throw new Error('Manifest needs frames: [{ file, time }] in capture order');
        // Validate the whole order before selecting a window, without sorting away defects.
        for (let i = 0; i < manifest.frames.length; i++)
          if (
            typeof manifest.frames[i].file !== 'string' ||
            !Number.isFinite(manifest.frames[i].time) ||
            (i && manifest.frames[i].time <= manifest.frames[i - 1].time)
          )
            throw new Error(
              'Manifest needs PNG file paths and strictly increasing times in seconds',
            );
        const paths = await Promise.all(
          manifest.frames.map((frame) => realpath(resolve(dirname(input), frame.file))),
        );
        paths.forEach(protect);
        samples = await Promise.all(
          manifest.frames
            .filter((f) => f.time >= from)
            .slice(0, frames)
            .map(async (f) => ({
              time: f.time,
              png: await readFile(resolve(dirname(input), f.file)),
            })),
        );
        source = { kind: 'frame-manifest', path: input };
      } else {
        samples = await videoFrames(input, from, frames);
        source = { kind: 'video', path: input };
      }
    }
    if (samples.length < 2)
      throw new Error(
        'This window contains fewer than two frames; choose an earlier --from or a longer cue',
      );
    const captured = performance.now();
    const report = {
      ...(await analyzeMotionFrames(samples, { crop, threshold, maxSize })),
      title: basename(input),
      source,
      sampling: source.kind === 'frame-manifest' ? 'provided-order' : 'consecutive',
    };
    const analyzed = performance.now();
    const result = await writeMotionReport(report, out, { context: capture?.page.context() });
    return {
      ...result,
      timingMs: {
        capture: Math.round(captured - started),
        analysis: Math.round(analyzed - captured),
        report: Math.round(performance.now() - analyzed),
        total: Math.round(performance.now() - started),
      },
    };
  } finally {
    await capture?.close();
  }
}
