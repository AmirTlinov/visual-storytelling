import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, join, dirname, extname, basename } from 'node:path';
import { renderer } from '../render.mjs';
import { analyzeMotionFrames } from './frames.mjs';
import { assertMotionOutput, writeMotionReport } from './report.mjs';
import { videoFrames, saveCapture } from './media.mjs';
import { captureBrowser } from './browser.mjs';
import { scanTimeline, selectDetail, overviewSamples } from './timeline.mjs';
import { summarizeRuntime } from './runtime.mjs';
import { compareMotion } from './comparison.mjs';

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
  capture: captureOptions,
  baseline,
  loop = false,
  seconds,
}) {
  const started = performance.now();
  if (
    (from !== undefined && (!Number.isFinite(from) || from < 0)) ||
    !Number.isInteger(frames) ||
    frames < 2 ||
    frames > 32
  )
    throw new Error('Choose --from >= 0 and --frames between 2 and 32');
  if (seconds !== undefined && (!Number.isFinite(seconds) || seconds < 0.1 || seconds > 15))
    throw new Error('--seconds must be between 0.1 and 15');
  if (threshold !== undefined && (!Number.isFinite(threshold) || threshold < 0 || threshold > 255))
    throw new Error('--threshold must be between 0 and 255');
  if (maxSize !== undefined && (!Number.isInteger(maxSize) || maxSize < 0))
    throw new Error('--max-size must be a non-negative integer');
  let replay, manifest;
  const native = captureOptions?.window !== undefined;
  const isURL = /^https?:\/\//i.test(input);
  if (!isURL && !native) {
    input = await realpath(input);
    if (extname(input).toLowerCase() === '.json') {
      manifest = JSON.parse(await readFile(input, 'utf8'));
      if (manifest.kind === 'motion-capture') replay = manifest;
    }
  }
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
  const layout = await assertMotionOutput(out);
  const outputs = new Set(layout.files);
  const protect = (path) => {
    if (
      path === out ||
      outputs.has(path) ||
      layout.folders.some((folder) => path === folder || path.startsWith(folder + '/'))
    )
      throw new Error(
        'Review output would overwrite its input; choose a separate output directory',
      );
  };
  protect(input);
  if (baseline) {
    const path = await canonical(resolve(baseline));
    if (((await stat(path)).isDirectory() ? path : dirname(path)) === out)
      throw new Error('Baseline and output must be separate directories');
  }
  let capture;
  try {
    let samples, source, telemetry, captureManifest, replayPath;
    const live = isURL || replay || captureOptions;
    let scan = Boolean(live);
    const isDirectory = !isURL && !native && (await stat(input)).isDirectory();
    if (native) {
      if (cue || fps !== undefined)
        throw new Error('--cue and --fps apply only to seekable scenes');
      const { captureWindow } = await import('./native.mjs');
      ({ samples, source, captureManifest } = await captureWindow(captureOptions, out));
    } else if (live) {
      if (cue || fps !== undefined)
        throw new Error('--cue and --fps apply only to seekable scenes');
      if (!isURL && isDirectory && input === out)
        throw new Error('Capture output must be separate from source');
      const options = { ...replay, url: replay?.url ?? input, ...captureOptions };
      if (!/^https?:\/\//i.test(options.url)) {
        options.url = await realpath(options.url);
        protect(options.url);
        if ((await stat(options.url)).isDirectory())
          protect(await canonical(join(options.url, 'index.html')));
      }
      const recorded = await captureBrowser(options, out);
      ({ samples, source, telemetry, captureManifest } = recorded);
      replayPath = join(out, 'replay.json');
    } else if (isDirectory || ['.html', '.htm', '.svg'].includes(extname(input).toLowerCase())) {
      if (!isDirectory && dirname(input) === out)
        throw new Error('Scene review needs a separate output directory');
      if (seconds !== undefined)
        throw new Error('Use --capture --seconds for live HTML, or --from/--frames for scene time');
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
      if (cue) throw new Error('--cue applies to scenes; choose recording time with --from');
      if (fps !== undefined)
        throw new Error(
          '--fps applies to scene sampling; recordings and manifests keep their own times',
        );
      if (extname(input).toLowerCase() === '.json') {
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
        scan = Boolean(manifest.source);
        if (scan && manifest.frames.length > 600)
          throw new Error('Saved capture exceeds 600 frames; choose a shorter manifest');
        samples = await Promise.all(
          (scan
            ? manifest.frames
            : manifest.frames.filter((f) => f.time >= (from ?? 0)).slice(0, frames)
          ).map(async (f) => ({
            ...f,
            png: await readFile(resolve(dirname(input), f.file)),
          })),
        );
        source = scan
          ? { ...manifest.source, importedFrom: input }
          : { kind: 'frame-manifest', path: input };
        if (scan) {
          if (manifest.telemetry) {
            protect(await realpath(resolve(dirname(input), manifest.telemetry)));
            telemetry = JSON.parse(
              await readFile(resolve(dirname(input), manifest.telemetry), 'utf8'),
            );
          }
          captureManifest = await saveCapture(samples, source, out, telemetry);
        }
      } else {
        scan = seconds !== undefined;
        samples = await videoFrames(input, from ?? 0, scan ? 600 : frames, seconds);
        source = { kind: 'video', path: input };
        if (scan) {
          if (samples.length === 600)
            source.warning = 'Analysis reached 600 frames; shorten --seconds for full coverage.';
          captureManifest = await saveCapture(samples, source, out);
        }
      }
    }
    if (samples.length < 2)
      throw new Error(
        'This window contains fewer than two frames; choose an earlier --from or a longer cue',
      );
    const captured = performance.now();
    const timeline = scan ? await scanTimeline(samples, threshold) : undefined;
    const runtime = telemetry ? summarizeRuntime(telemetry, source.viewport) : undefined;
    const selected = scan
      ? selectDetail(samples, {
          count: frames,
          from: source.kind === 'video' && seconds ? undefined : from,
          timeline,
          telemetry,
          runtime,
        })
      : samples;
    if (selected.length < 2)
      throw new Error('Selected window has fewer than two frames; choose an earlier --from');
    const overview =
      scan && samples.length > frames
        ? await analyzeMotionFrames(overviewSamples(samples), { crop, threshold, maxSize })
        : undefined;
    const report = {
      ...(await analyzeMotionFrames(selected, { crop, threshold, maxSize })),
      title: source.app ?? basename(source.path ?? input),
      source,
      sampling: scan
        ? 'captured-window'
        : source.kind === 'frame-manifest'
          ? 'provided-order'
          : 'consecutive',
      timeline,
      runtime,
      overview,
      captureManifest,
      replayPath,
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
        images: [seam.frames[0].image, seam.frames[1].image],
        note: 'End/start appearance only; compare direction and speed on a recording spanning the wrap',
      };
    }
    if (baseline) report.comparison = await compareMotion(report, baseline);
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
