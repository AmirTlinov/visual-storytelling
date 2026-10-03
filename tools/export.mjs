#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { renderer } from './render.mjs';
import { standalone, packDirectory } from './standalone.mjs';

const { values } = parseArgs({
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
  },
});
if (values.help) {
  console.log(`visual-story-export --directory DIST --format png|svg|html|mp4 [--out FILE]
visual-story-export --scene NAME --format png|svg|html|mp4 [--out FILE]

Still image: --time SECONDS --width 960 --theme light|dark
Video:       --from SECONDS --to SECONDS --fps 30 --width 960 [--height PIXELS]
HTML:        --theme auto|light|dark; embeds code, fonts and audio for offline use

From a created scene: npm run export -- --format png --time 4
Video uses the scene's media timeline and narration. PNG/MP4 need Chromium; MP4 also needs FFmpeg.`);
  process.exit(0);
}
const { scene, format } = values;
if (values.height !== undefined && format !== 'mp4')
  throw new Error('--height sets the MP4 frame. PNG captures the complete scene at --width.');
const theme = values.theme ?? (format === 'html' ? 'auto' : 'light');
if (!['png', 'svg', 'html', 'mp4'].includes(format))
  throw new Error('Format must be png, svg, html or mp4');
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
if (format === 'html') {
  await writeFile(
    output,
    values.directory
      ? await packDirectory(values.directory, 'index.html', { theme })
      : await standalone(scene, theme),
  );
  console.log(output);
} else {
  const render = await renderer({ scene, theme, width, directory: values.directory });
  let temporary;
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
    if (format === 'mp4') {
      const end = values.to === undefined ? render.info.duration : Number(values.to);
      if (
        !Number.isFinite(end) ||
        end <= from ||
        end > render.info.duration ||
        from >= render.info.duration
      )
        throw new Error('Invalid video interval');
      await render.seek(from);
      const firstFrame = await render.png();
      const even = (value) => Math.ceil(value / 2) * 2;
      const frameWidth = even(firstFrame.readUInt32BE(16)),
        frameHeight = even(height ?? firstFrame.readUInt32BE(20));
      temporary = await mkdtemp(join(tmpdir(), 'visual-storytelling-'));
      const audioFile = join(temporary, 'voice.m4a');
      if (render.info.audioURL) {
        const response = await fetch(new URL(render.info.audioURL, render.url));
        if (!response.ok) throw new Error('Could not load narration');
        await writeFile(audioFile, Buffer.from(await response.arrayBuffer()));
      }
      const args = [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'image2pipe',
        '-framerate',
        String(fps),
        '-i',
        'pipe:0',
      ];
      if (render.info.audioURL)
        args.push(
          '-ss',
          String(from),
          '-i',
          audioFile,
          '-map',
          '0:v',
          '-map',
          '1:a',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
        );
      args.push(
        '-t',
        String(end - from),
        '-vf',
        `scale=${frameWidth}:${frameHeight}:force_original_aspect_ratio=decrease:eval=frame,pad=${frameWidth}:${frameHeight}:(ow-iw)/2:(oh-ih)/2:color=${theme === 'light' ? 'white' : 'black'}:eval=frame,setsar=1`,
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        output,
      );
      const encoder = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
      let failed;
      encoder.on('error', (error) => {
        failed = error;
      });
      encoder.stdin.on('error', (error) => {
        failed = error;
      });
      const done = new Promise((resolve) => encoder.once('close', resolve));
      try {
        const count = Math.ceil((end - from) * fps);
        for (let i = 0; i < count; i++) {
          if (i) await render.seek(from + i / fps);
          const pixels = i ? await render.png() : firstFrame;
          if (failed) throw failed;
          if (!encoder.stdin.write(pixels)) await once(encoder.stdin, 'drain');
          if (i % fps === 0) console.log(`${i + 1}/${count} frames`);
        }
        encoder.stdin.end();
        const code = await done;
        if (failed) throw failed;
        if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
      } finally {
        encoder.stdin.destroy();
        if (encoder.exitCode === null && encoder.signalCode === null) encoder.kill();
        await done;
      }
    }
    console.log(output);
  } finally {
    await render.close();
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}
