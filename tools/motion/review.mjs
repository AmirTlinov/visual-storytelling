import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, join, dirname, extname, basename } from 'node:path';
import { analyzeMotionFrames } from './frames.mjs';
import { assertMotionOutput, writeMotionReport } from './report.mjs';
import { videoFrames, saveCapture } from './media.mjs';
import { captureBrowser } from './browser.mjs';
import { captureScene } from './scene-capture.mjs';
import { scanTimeline, selectDetail, overviewSamples } from './timeline.mjs';
import { summarizeRuntime } from './runtime.mjs';
import { compareMotion } from './comparison.mjs';
import { loadCapture, saveSession } from './session.mjs';
import { queryEvidence } from './inspection.mjs';
import { buildEpisodes, selectEpisode } from './episodes.mjs';

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
  episode,
  at,
  radius = 0.3,
  threshold,
  maxSize,
  capture: captureOptions,
  baseline,
  loop = false,
  seconds,
  slice,
  target,
  point,
}) {
  const started = performance.now();
  if (
    (from !== undefined && (!Number.isFinite(from) || from < 0)) ||
    !Number.isInteger(frames) ||
    frames < 2 ||
    frames > 32
  )
    throw new Error('Choose --from >= 0 and --frames between 2 and 32');
  if (seconds !== undefined && (!Number.isFinite(seconds) || seconds <= 0))
    throw new Error('--seconds must be positive');
  if (
    at !== undefined &&
    (!Number.isFinite(at) || at < 0 || !Number.isFinite(radius) || radius <= 0)
  )
    throw new Error('--at must be non-negative and --radius positive');
  if (fps !== undefined && (!Number.isFinite(fps) || fps < 1 || fps > 240))
    throw new Error('--fps must be between 1 and 240');
  if (threshold !== undefined && (!Number.isFinite(threshold) || threshold < 0 || threshold > 255))
    throw new Error('--threshold must be between 0 and 255');
  if (maxSize !== undefined && (!Number.isInteger(maxSize) || maxSize < 0))
    throw new Error('--max-size must be a non-negative integer');
  let replay, manifest;
  const native = captureOptions?.window !== undefined;
  const isURL = /^https?:\/\//i.test(input);
  let isDirectory = false,
    saved = false;
  if (!isURL && !native) {
    input = await realpath(input);
    isDirectory = (await stat(input)).isDirectory();
    if (isDirectory) {
      try {
        manifest = JSON.parse(await readFile(join(input, 'session.json'), 'utf8'));
        saved = manifest.kind === 'visual-review-session';
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        saved =
          (await stat(join(input, 'capture/frames.json')).then(
            () => true,
            () => false,
          )) ||
          (await stat(join(input, 'capture/frames.jsonl')).then(
            () => true,
            () => false,
          ));
      }
    } else if (extname(input).toLowerCase() === '.json') {
      manifest = JSON.parse(await readFile(input, 'utf8'));
      if (manifest.kind === 'motion-capture') replay = manifest;
      else saved = true;
    }
  }
  // An authored project owns source and dist; review its existing build without changing it.
  if (isDirectory && !saved && !captureOptions) {
    const packageFile = join(input, 'package.json');
    const project = await readFile(packageFile, 'utf8').then(JSON.parse, (e) => {
      if (e.code === 'ENOENT') return undefined;
      throw e;
    });
    if (project?.dependencies?.['@visual-storytelling/core']) {
      const built = join(input, 'dist');
      if (
        !(await stat(join(built, 'index.html')).then(
          () => true,
          () => false,
        ))
      )
        throw new Error(
          'This scene project has no dist/index.html. Build it first with visual-story build PROJECT, then review its dist directory.',
        );
      input = await realpath(built);
    }
  }
  async function canonical(path) {
    try {
      return await realpath(path);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      return join(await canonical(dirname(path)), basename(path));
    }
  }
  out = await canonical(resolve(out));
  const layout = await assertMotionOutput(out);
  const protect = (path) => {
    if (
      path === out ||
      layout.files.includes(path) ||
      layout.folders.some((f) => path === f || path.startsWith(f + '/'))
    )
      throw new Error(
        'Review output would overwrite its input; choose a separate output directory',
      );
  };
  protect(input);
  if (baseline && (await canonical(resolve(baseline))) === out)
    throw new Error('Baseline and output must be separate directories');
  let samples, source, telemetry, context, captureManifest, replayPath, parent;
  const live = !saved && (isURL || replay || captureOptions);
  if (saved) {
    const loaded = await loadCapture(input);
    ({ samples, source, telemetry, context, captureManifest } = loaded);
    parent = loaded.session?.id;
    source ??= { kind: 'frame-manifest', path: input, theme };
    for (const sample of samples) protect(await realpath(sample.file));
    if (context?.audio)
      context = { ...context, audio: resolve(dirname(captureManifest), '..', context.audio) };
  } else if (native) {
    const { captureWindow } = await import('./native.mjs');
    ({ samples, source, captureManifest } = await captureWindow(captureOptions, out));
  } else if (live) {
    if (fps !== undefined || cue)
      throw new Error(
        '--cue and --fps apply to scene states; record browser actions or inspect a saved episode',
      );
    const options = { ...replay, url: replay?.url ?? input, ...captureOptions };
    if (!/^https?:\/\//i.test(options.url)) {
      options.url = await realpath(options.url);
      protect(options.url);
      if ((await stat(options.url)).isDirectory())
        protect(await canonical(join(options.url, 'index.html')));
    }
    ({ samples, source, telemetry, context, captureManifest } = await captureBrowser(options, out));
    replayPath = join(out, 'replay.json');
  } else if (isDirectory || ['.html', '.htm', '.svg'].includes(extname(input).toLowerCase())) {
    if (!isDirectory && dirname(input) === out)
      throw new Error('Scene review needs a separate output directory');
    ({ samples, source, context, captureManifest } = await captureScene({
      input,
      directory: isDirectory,
      out,
      cue,
      from,
      seconds,
      frames,
      fps,
      width,
      theme,
      reduced,
    }));
  } else {
    if (cue || fps !== undefined)
      throw new Error(
        '--cue and --fps apply only to scene states; recordings keep their own times',
      );
    samples = await videoFrames(input, from ?? 0, undefined, seconds, out);
    source = { kind: 'video', path: input, clock: 'source PTS', theme };
    captureManifest = await saveCapture(samples, source, out);
  }
  source.theme ??= theme;
  if (samples.length < 2) throw new Error('Selected interval contains fewer than two frames');
  samples.forEach((s, i) => (s.id ??= `frame:${i}`));
  const all = samples;
  const requestedEpisode = episode ?? (saved ? cue : undefined);
  if (requestedEpisode) {
    const chosen = selectEpisode(buildEpisodes(samples, { context, telemetry }), requestedEpisode);
    from = Math.max(samples[0].time, chosen.start - 0.15);
    seconds = Math.min(samples.at(-1).time, chosen.end + 0.15) - from;
  }
  if (at !== undefined) {
    from = Math.max(samples[0].time, at - radius);
    seconds = at + radius - from;
  }
  if (saved && (from !== undefined || seconds !== undefined)) {
    const lo = from ?? samples[0].time,
      hi = seconds === undefined ? samples.at(-1).time : lo + seconds;
    samples = samples.filter((s) => s.time >= lo && s.time <= hi);
    // Keep measured bracketing states when the requested interval falls between sparse checkpoints.
    if (samples.length < 2) {
      const a = all.findLastIndex((s) => s.time <= lo);
      const b = all.findIndex((s) => s.time >= hi);
      samples = all.slice(Math.max(0, a), b < 0 ? undefined : b + 1);
    }
  }
  if (samples.length < 2) throw new Error('Selected interval contains fewer than two frames');
  if ((target || point) && !crop) {
    const evidence = queryEvidence(
      { frames: samples, telemetry, source },
      {
        object: target,
        point,
        at: at ?? (samples[0].time + samples.at(-1).time) / 2,
        from: samples[0].time,
        to: samples.at(-1).time,
      },
    );
    target = evidence.requested.object;
    const box = evidence.bounds;
    if (!box)
      throw new Error(
        `No observed bounds for ${target ?? 'this point'}; inspect the session objects or select --crop x,y,w,h`,
      );
    const sharp = (await import('sharp')).default;
    const size = await sharp(samples[0].png ?? samples[0].file).metadata();
    const x = Math.max(0, Math.floor(box.x - 12)),
      y = Math.max(0, Math.floor(box.y - 12));
    crop = {
      x,
      y,
      width: Math.min(size.width - x, Math.ceil(box.x + box.width + 12) - x),
      height: Math.min(size.height - y, Math.ceil(box.y + box.height + 12) - y),
    };
    if (crop.width <= 0 || crop.height <= 0)
      throw new Error('The selected object is outside the captured image');
  }
  if (saved) captureManifest = await saveCapture(samples, source, out, telemetry, context);
  const captured = performance.now();
  const scanned = await scanTimeline(samples, threshold, { crop, slice, source });
  const { photometry, ...timeline } = scanned;
  const runtime = telemetry ? summarizeRuntime(telemetry, source.viewport) : undefined;
  const episodes = buildEpisodes(samples, { context, telemetry, timeline });
  const selected = selectDetail(samples, {
    count: frames,
    from: at === undefined ? undefined : Math.max(samples[0].time, at - radius / 2),
    timeline,
    telemetry,
    runtime,
  });
  const detail = selected.length >= 2 ? selected : samples.slice(-2);
  const overview = await analyzeMotionFrames(overviewSamples(samples), {
    crop,
    threshold,
    maxSize,
  });
  const session = await saveSession(out, {
    captureManifest,
    source,
    samples,
    context,
    telemetry,
    episodes,
    replayPath,
    parent,
  });
  const report = {
    ...(await analyzeMotionFrames(detail, { crop, threshold, maxSize })),
    title: source.app ?? basename(source.path ?? input),
    source,
    sampling: source.kind === 'scene-seek' ? 'model-checkpoints' : 'captured-window',
    timeline,
    photometry,
    runtime,
    overview,
    captureManifest,
    replayPath,
    session,
    context,
    samples,
    telemetry,
    target,
  };
  if (loop) {
    const seam = await analyzeMotionFrames(
      [
        { ...samples.at(-1), time: 0 },
        { ...samples[0], time: 1 },
      ],
      { crop, threshold, maxSize },
    );
    report.loop = {
      changedPercent: seam.intervals[0].changedPercent,
      meanAbsoluteDelta: seam.intervals[0].meanAbsoluteDelta,
      images: seam.frames.map((f) => f.image),
      note: 'End/start appearance; inspect the recording across the boundary for speed.',
    };
  }
  if (baseline) report.comparison = await compareMotion(report, baseline, out);
  const analyzed = performance.now();
  const result = await writeMotionReport(report, out);
  return {
    ...result,
    session: join(out, 'session.json'),
    coverage: session.coverage,
    episodes: episodes.slice(0, 12).map(({ frames, ...e }) => e),
    episodeCount: episodes.length,
    inspect: `visual-story review inspect '${out}'`,
    timingMs: {
      capture: Math.round(captured - started),
      analysis: Math.round(analyzed - captured),
      report: Math.round(performance.now() - analyzed),
      total: Math.round(performance.now() - started),
    },
  };
}
