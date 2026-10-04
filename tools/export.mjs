#!/usr/bin/env node
import { cancellableCommand } from './cancellable-command.mjs';
import { parseArgs } from 'node:util';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportVideo } from './video-export.mjs';
import { captionTrack } from '../dist/story/captions.js';
import { renderer } from './render.mjs';
import { standalone, packDirectory } from './standalone.mjs';

export async function runExport(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      help: { type: 'boolean', short: 'h' },
      scene: { type: 'string', default: 'area-story' },
      directory: { type: 'string' },
      format: { type: 'string', default: 'png' },
      theme: { type: 'string' },
      out: { type: 'string' },
      time: { type: 'string', default: '0' },
      width: { type: 'string', default: '960' },
      height: { type: 'string' },
      fps: { type: 'string', default: '30' },
      from: { type: 'string', default: '0' },
      to: { type: 'string' },
      jobs: { type: 'string', default: '2' },
    },
  });
  if (values.help) {
    console.log(`visual-story export --directory DIST --format png|svg|html|mp4|srt|vtt [--out FILE]
visual-story export --scene NAME --format png|svg|html|mp4 [--out FILE]

Still image: --time SECONDS --width 960 --theme light|dark
Video:       --from SECONDS --to SECONDS --fps 30 --width 960 [--height PIXELS] [--jobs 2]
Captions:    --format srt|vtt reads the built timeline; presentation stays opt-in
HTML:        --theme auto|light|dark; embeds code, fonts and audio for offline use

From a created scene: npm run export -- --format png --time 4
Video uses the scene's media timeline and narration. PNG/MP4 need Chromium; MP4 also needs FFmpeg.`);
    return;
  }
  const { scene, format } = values;
  if (values.height !== undefined && format !== 'mp4')
    throw new Error('--height sets the MP4 frame. PNG captures the complete scene at --width.');
  const theme = values.theme ?? (format === 'html' ? 'auto' : 'light');
  if (!['png', 'svg', 'html', 'mp4', 'srt', 'vtt'].includes(format))
    throw new Error('Format must be png, svg, html, mp4, srt or vtt');
  if (!(format === 'html' ? ['auto', 'light', 'dark'] : ['light', 'dark']).includes(theme))
    throw new Error('Choose light or dark; interactive HTML also supports auto');
  const width = Number(values.width),
    height = values.height === undefined ? undefined : Number(values.height),
    fps = Number(values.fps),
    from = Number(values.from),
    time = Number(values.time);
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
      if (!values.directory) throw new Error('Caption export needs --directory DIST');
      const script = JSON.parse(await readFile(join(values.directory, 'timeline.json'), 'utf8'));
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
      const render = await renderer({ scene, theme, width, directory: values.directory });
      try {
        if (format === 'png') {
          await render.seek(time);
          await writeFile(output, await render.png());
        }
        if (format === 'svg') {
          await render.seek(time);
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
