import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
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
  from = 0,
  frames = 12,
  fps,
  width = 960,
  theme = 'light',
  reduced = false,
  crop,
}) {
  if (!Number.isFinite(from) || from < 0 || !Number.isInteger(frames) || frames < 2 || frames > 32)
    throw new Error('Choose --from >= 0 and --frames between 2 and 32');
  input = resolve(input);
  out = resolve(out);
  if (input === out) throw new Error('Review output must be separate from its input');
  let capture;
  try {
    let samples, source;
    if ((await stat(input)).isDirectory()) {
      fps ??= 60;
      if (!Number.isFinite(fps) || fps < 1 || fps > 240)
        throw new Error('Scene --fps must be between 1 and 240');
      capture = await renderer({ directory: input, width, theme });
      if (!capture.info.seekable)
        throw new Error(
          'This scene has no seekable timeline; review a recording of the interaction',
        );
      await capture.page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
      samples = [];
      for (let i = 0; i < frames && from + i / fps <= capture.info.duration; i++) {
        const time = from + i / fps;
        await capture.seek(time);
        samples.push({ time, png: await capture.png() });
      }
      source = { kind: 'scene-seek', path: input, fps, theme, reduced };
    } else {
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
    const report = {
      ...analyzeMotionFrames(samples, { crop }),
      title: basename(input),
      source,
      sampling: 'consecutive',
    };
    return await writeMotionReport(report, out, { context: capture?.page.context() });
  } finally {
    await capture?.close();
  }
}
