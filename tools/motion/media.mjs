import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

export async function videoFrames(input, from, count, seconds) {
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
        ...(seconds === undefined ? [] : ['-to', String(from + seconds)]),
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
        join(temporary, '%06d.png'),
      ],
      { maxBuffer: 8 * 1024 * 1024, timeout: 45000 },
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

export async function saveCapture(samples, source, out, telemetry) {
  const folder = join(out, 'capture');
  await mkdir(folder, { recursive: true });
  const manifest = { source, ...(telemetry ? { telemetry: '../telemetry.json' } : {}), frames: [] };
  for (const [i, sample] of samples.entries()) {
    const file = `${String(i).padStart(4, '0')}.png`;
    await writeFile(join(folder, file), sample.png);
    const { png, epoch, file: originalFile, ...metadata } = sample;
    manifest.frames.push({ file, ...metadata });
  }
  const path = join(folder, 'frames.json');
  await writeFile(path, JSON.stringify(manifest, null, 2) + '\n');
  if (telemetry)
    await writeFile(join(out, 'telemetry.json'), JSON.stringify(telemetry, null, 2) + '\n');
  return path;
}
