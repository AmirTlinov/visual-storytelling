import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { join, relative, basename } from 'node:path';
import { buildOutput } from '../build-output.mjs';
import { spawn } from 'node:child_process';
import { captureWriter } from './session.mjs';

/** Decode to disk with source PTS; neither PNGs nor ffmpeg logs accumulate in RAM. */
export async function videoFrames(input, from, count, seconds, out) {
  const folder = join(out, 'capture');
  const frames = [];
  await buildOutput(input, folder, async (capture) => {
    let pending = '',
      tail = '';
    const args = [
      '-nostdin',
      '-y',
      '-hide_banner',
      '-loglevel',
      'info',
      '-copyts',
      '-seek_timestamp',
      '1',
      '-ss',
      String(from),
      '-noaccurate_seek',
      '-i',
      input,
      '-map',
      '0:v:0',
      '-an',
      '-sn',
      '-dn',
      '-vf',
      `trim=start=${from}${seconds === undefined ? '' : `:end=${from + seconds}`}${count === undefined ? '' : `,trim=end_frame=${count}`},showinfo`,
      '-fps_mode',
      'passthrough',
      join(capture, '%09d.png'),
    ];
    await new Promise((resolve, reject) => {
      const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
      child.on('error', reject);
      child.stderr.on('data', (data) => {
        const text = data.toString();
        tail = (tail + text).slice(-4000);
        pending += text;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop();
        for (const line of lines) {
          const m = line.match(/\bn:\s*(\d+)\s+pts:.*?\bpts_time:([\d.e+\-]+)/);
          if (m)
            frames.push({
              id: `frame:${frames.length}`,
              time: Number(m[2]),
              file: join(folder, `${String(Number(m[1]) + 1).padStart(9, '0')}.png`),
            });
        }
      });
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`Video decode failed: ${tail}`)),
      );
    });
    const written = new Set((await readdir(capture)).filter((name) => /^\d{9}\.png$/.test(name)));
    const actual = frames.filter((frame) => written.has(basename(frame.file)));
    if (actual.length !== frames.length)
      throw new Error(`Video decode wrote ${actual.length} images for ${frames.length} timestamps`);
    if (written.size !== actual.length)
      throw new Error(`Video decode wrote ${written.size} images for ${actual.length} timestamps`);
    if (actual.length < 2)
      throw new Error('Video interval needs at least two decoded frames with PTS');
  });
  return frames;
}

export async function saveCapture(samples, source, out, telemetry, context) {
  // Reference existing raw images, including offline selections; preserve names and order.
  const folder = join(out, 'capture');
  if (samples.every((s) => s.file)) {
    await mkdir(folder, { recursive: true });
    const frames = samples.map(({ file, png, epoch, ...s }) => ({
      ...s,
      file: relative(folder, file),
    }));
    const path = join(folder, 'frames.json');
    await writeFile(
      path,
      JSON.stringify({
        source,
        context,
        frames,
        ...(telemetry ? { telemetry: '../telemetry.json' } : {}),
      }) + '\n',
    );
    if (telemetry) await writeFile(join(out, 'telemetry.json'), JSON.stringify(telemetry) + '\n');
    return path;
  }
  const writer = await captureWriter(out);
  for (const sample of samples) await writer.append(sample);
  return writer.finish(source, telemetry, context);
}
