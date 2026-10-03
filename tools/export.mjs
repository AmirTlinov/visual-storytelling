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
    scene: { type: 'string', default: 'area-story' },
    directory: { type: 'string' },
    format: { type: 'string', default: 'png' },
    theme: { type: 'string' },
    out: { type: 'string' },
    time: { type: 'string', default: '0' },
    width: { type: 'string', default: '960' },
    fps: { type: 'string', default: '30' },
    from: { type: 'string', default: '0' },
    to: { type: 'string' },
  },
});
const { scene, format } = values;
const theme = values.theme ?? (format === 'html' ? 'auto' : 'light');
if (!['png', 'svg', 'html', 'mp4'].includes(format))
  throw new Error('Format must be png, svg, html or mp4');
if (!(format === 'html' ? ['auto', 'light', 'dark'] : ['light', 'dark']).includes(theme))
  throw new Error('Choose light or dark; interactive HTML also supports auto');
const width = Number(values.width),
  fps = Number(values.fps),
  from = Number(values.from),
  time = Number(values.time);
if (
  !Number.isInteger(width) ||
  width < 320 ||
  width > 3840 ||
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
        'pad=ceil(iw/2)*2:ceil(ih/2)*2',
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
          await render.seek(from + i / fps);
          const pixels = await render.png();
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
