#!/usr/bin/env node
import { cancellableCommand } from './cancellable-command.mjs';
import { parseArgs } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportVideo } from './video-export.mjs';
import { captionTrack } from '../dist/story/captions.js';
import { captionSource } from './caption-source.mjs';
import { renderer } from './render.mjs';
import { selectEpisode, storyEpisodes } from './motion/episodes.mjs';
import { standalone, packDirectory } from './standalone.mjs';

export async function runExport(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      scene: { type: 'string', default: 'area-story' },
      directory: { type: 'string' },
      format: { type: 'string', default: 'png' },
      theme: { type: 'string' },
      out: { type: 'string' },
      time: { type: 'string' },
      cue: { type: 'string' },
      progress: { type: 'string' },
      width: { type: 'string', default: '960' },
      height: { type: 'string' },
      fps: { type: 'string', default: '30' },
      from: { type: 'string', default: '0' },
      to: { type: 'string' },
      jobs: { type: 'string', default: '2' },
    },
  });
  if (values.help) {
    console.log(`visual-story export DIST --format png|svg|html|mp4|srt|vtt [--out FILE]
visual-story export --scene NAME --format png|svg|html|mp4 [--out FILE]

Still image: --time SECONDS or --cue ID [--progress 0..1], --width 960 [--height 1200]
             --height sets the browser viewport; PNG captures the complete scene.
             --theme light|dark
Video:       --from SECONDS --to SECONDS --fps 30 --width 960 [--height PIXELS] [--jobs 2]
Captions:    --format srt|vtt reads the mounted story (Chromium), or an audio-only timeline
HTML:        --theme auto|light|dark; embeds code, fonts and audio for offline use

From a created scene: npm run export -- --format png --time 4
Video uses the scene's media timeline and narration. PNG/MP4 need Chromium; MP4 also needs FFmpeg.`);
    return;
  }
  if (positionals.length > 1 || (positionals.length && values.directory))
    throw new Error('Choose one scene directory: export DIST, or --directory DIST');
  values.directory ??= positionals[0];
  const { scene, format } = values;
  if (values.cue && values.time !== undefined)
    throw new Error('Choose --cue or --time for the still image');
  if (values.progress !== undefined && !values.cue) throw new Error('--progress needs --cue');
  if (values.cue && !['png', 'svg'].includes(format))
    throw new Error('--cue selects a PNG or SVG frame');
  if (values.height !== undefined && !['png', 'svg', 'mp4'].includes(format))
    throw new Error('--height sets the viewport for PNG/SVG or the MP4 frame height');
  const cueProgress = Number(values.progress ?? 0);
  if (!Number.isFinite(cueProgress) || cueProgress < 0 || cueProgress > 1)
    throw new Error('--progress must be between 0 and 1');
  const theme = values.theme ?? (format === 'html' ? 'auto' : 'light');
  if (!['png', 'svg', 'html', 'mp4', 'srt', 'vtt'].includes(format))
    throw new Error('Format must be png, svg, html, mp4, srt or vtt');
  if (!(format === 'html' ? ['auto', 'light', 'dark'] : ['light', 'dark']).includes(theme))
    throw new Error('Choose light or dark; interactive HTML also supports auto');
  const width = Number(values.width),
    height = values.height === undefined ? undefined : Number(values.height),
    fps = Number(values.fps),
    from = Number(values.from),
    time = Number(values.time ?? 0);
  if (
    !Number.isInteger(width) ||
    width < 320 ||
    width > 3840 ||
    (height !== undefined && (!Number.isInteger(height) || height < 240 || height > 3840)) ||
    !Number.isInteger(fps) ||
    fps < 1 ||
    fps > 60 ||
    ![from, time].every(Number.isFinite) ||
    from < 0 ||
    time < 0
  )
    throw new Error('Invalid export dimensions or time');
  const output = values.out ?? `artifacts/${scene}.${format}`;
  await mkdir(dirname(output), { recursive: true });
  await cancellableCommand('Export', async (signal) => {
    if (format === 'srt' || format === 'vtt') {
      if (!values.directory) throw new Error('Caption export needs a scene directory');
      const script = await captionSource(values.directory, { signal });
      await writeFile(output, captionTrack(script).serialize(format));
      console.log(output);
    } else if (format === 'mp4') {
      await exportVideo({
        output,
        scene,
        theme,
        width,
        directory: values.directory,
        height,
        fps,
        from,
        to: values.to === undefined ? undefined : Number(values.to),
        jobs: Number(values.jobs),
        signal,
        onProgress: (done, total) => console.log(`${done}/${total} frames`),
      });
      console.log(output);
    } else if (format === 'html') {
      await writeFile(
        output,
        values.directory
          ? await packDirectory(values.directory, 'index.html', { theme, signal })
          : await standalone(scene, theme, { signal }),
      );
      console.log(output);
    } else {
      const render = await renderer({
        scene,
        theme,
        width,
        height,
        directory: values.directory,
        signal,
      });
      try {
        let at = time;
        if (values.cue) {
          const review = await render.capture.evaluate((scene) => scene.review());
          if (!review) throw new Error('This scene has no semantic cues');
          const cue = selectEpisode(storyEpisodes(review), values.cue);
          at = cue.start + (cue.end - cue.start) * cueProgress;
        }
        await render.seek(at);
        if (format === 'png') {
          await writeFile(output, await render.png());
        }
        if (format === 'svg') {
          const source = await render.svg();
          await writeFile(output, source);
        }
        console.log(output);
      } finally {
        await render.close();
      }
    }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await runExport();
