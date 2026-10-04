import { mkdir, mkdtemp, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { renderer } from './render.mjs';

function encoder(args, signal, pipe = false) {
  signal.throwIfAborted();
  const child = spawn('ffmpeg', ['-nostdin', '-y', '-hide_banner', '-loglevel', 'error', ...args], {
    stdio: [pipe ? 'pipe' : 'ignore', 'ignore', 'pipe'],
  });
  let tail = '',
    failure;
  child.stderr.on('data', (data) => {
    tail = (tail + data).slice(-4000);
  });
  child.on('error', (error) => {
    failure = error;
  });
  child.stdin?.on('error', (error) => {
    failure = error;
  });
  const cancel = () => {
    child.stdin?.destroy();
    child.kill();
  };
  signal.addEventListener('abort', cancel, { once: true });
  const closed = new Promise((resolve) => child.once('close', resolve));
  return {
    async write(bytes) {
      signal.throwIfAborted();
      if (failure) throw failure;
      if (!child.stdin.write(bytes)) await once(child.stdin, 'drain', { signal });
    },
    async finish() {
      child.stdin?.end();
      const code = await closed;
      signal.removeEventListener('abort', cancel);
      signal.throwIfAborted();
      if (failure) throw failure;
      if (code !== 0) throw new Error(`Video encoding failed: ${tail}`);
    },
    async close() {
      if (child.exitCode === null && child.signalCode === null) cancel();
      await closed;
      signal.removeEventListener('abort', cancel);
    },
  };
}

/** Frame-index partitions, a bounded renderer pool, and one continuous audio encode. */
export async function exportVideo({
  output,
  fps = 30,
  from = 0,
  to,
  height,
  jobs = 2,
  silent = false,
  signal,
  onProgress = () => {},
  ...view
}) {
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > 8)
    throw new Error('Video jobs must be an integer from 1 to 8');
  if (
    !Number.isInteger(fps) ||
    fps < 1 ||
    fps > 60 ||
    (height !== undefined && (!Number.isInteger(height) || height < 240 || height > 3840)) ||
    (view.width !== undefined &&
      (!Number.isInteger(view.width) || view.width < 320 || view.width > 3840))
  )
    throw new Error('Invalid video dimensions or frame rate');
  const abort = new AbortController();
  const cancel = () => abort.abort(signal?.reason);
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const renders = new Set();
  abort.signal.addEventListener(
    'abort',
    () => {
      for (const render of renders) void render.page.close().catch(() => {});
    },
    { once: true },
  );
  const children = new Set();
  const open = async () => {
    abort.signal.throwIfAborted();
    const render = await renderer(view);
    renders.add(render);
    abort.signal.throwIfAborted();
    return render;
  };
  let temporary;
  try {
    const first = await open();
    const end = to ?? first.info.duration;
    if (
      !Number.isFinite(end) ||
      !Number.isFinite(from) ||
      from < 0 ||
      end <= from ||
      end > first.info.duration
    )
      throw new Error('Invalid video interval');
    await first.seek(from);
    const png = await first.png();
    const even = (value) => Math.round(value / 2) * 2;
    const w = even(view.width ?? 960),
      h = even(height ?? w * png.readUInt32BE(20) / png.readUInt32BE(16));
    output = resolve(output);
    await mkdir(dirname(output), { recursive: true });
    temporary = await mkdtemp(join(dirname(output), '.visual-story-video-'));
    let audio;
    if (!silent && first.info.audioURL) {
      const response = await fetch(new URL(first.info.audioURL, first.url), {
        signal: abort.signal,
      });
      if (!response.ok) throw new Error('Could not load narration');
      audio = join(temporary, 'narration.audio');
      await writeFile(audio, Buffer.from(await response.arrayBuffer()));
    }
    const count = Math.ceil((end - from) * fps);
    const workers = Math.min(jobs, count);
    const size = Math.max(1, Math.min(Math.ceil(count / workers), fps * 20));
    const chunks = Array.from({ length: Math.ceil(count / size) }, (_, index) => ({
      start: index * size,
      end: Math.min(count, (index + 1) * size),
      file: join(temporary, `${index}.mp4`),
    }));
    let next = 0,
      completed = 0;
    async function worker(existing) {
      const render = existing ?? (await open());
      while (next < chunks.length) {
        abort.signal.throwIfAborted();
        const chunk = chunks[next++];
        const process = encoder(
          [
            '-f',
            'image2pipe',
            '-framerate',
            String(fps),
            '-i',
            'pipe:0',
            '-an',
            '-vf',
            `scale=${w}:${h}:force_original_aspect_ratio=decrease:eval=frame,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${view.theme === 'dark' ? 'black' : 'white'}:eval=frame,setsar=1`,
            '-c:v',
            'libx264',
            '-threads',
            '2',
            '-preset',
            'medium',
            '-crf',
            '18',
            '-pix_fmt',
            'yuv420p',
            chunk.file,
          ],
          abort.signal,
          true,
        );
        children.add(process);
        try {
          for (let index = chunk.start; index < chunk.end; index++) {
            await render.seek(from + index / fps);
            await process.write(await render.png());
            completed++;
            if (completed % fps === 0 || completed === count) onProgress(completed, count);
          }
          await process.finish();
        } finally {
          await process.close();
          children.delete(process);
        }
      }
    }
    const tasks = Array.from({ length: workers }, (_, i) =>
      worker(i === 0 ? first : undefined).catch((error) => {
        abort.abort(error);
        throw error;
      }),
    );
    const results = await Promise.allSettled(tasks);
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) throw abort.signal.reason ?? failed.reason;
    // Relative generated names avoid path quoting ambiguity in ffconcat.
    await writeFile(
      join(temporary, 'parts.txt'),
      chunks.map((_, i) => `file '${i}.mp4'`).join('\n'),
    );
    const final = join(temporary, 'complete.mp4');
    const mux = encoder(
      [
        '-f',
        'concat',
        '-safe',
        '1',
        '-i',
        join(temporary, 'parts.txt'),
        ...(audio
          ? [
              '-ss',
              String(from),
              '-i',
              audio,
              '-map',
              '0:v:0',
              '-map',
              '1:a:0',
              '-c:a',
              'aac',
              '-b:a',
              '128k',
            ]
          : []),
        '-c:v',
        'copy',
        '-t',
        String(end - from),
        '-movflags',
        '+faststart',
        final,
      ],
      abort.signal,
    );
    children.add(mux);
    await mux.finish();
    children.delete(mux);
    abort.signal.throwIfAborted();
    await rename(final, output);
    return {
      output,
      frames: count,
      duration: end - from,
      width: w,
      height: h,
      chunks: chunks.length,
      jobs: workers,
    };
  } finally {
    abort.abort();
    await Promise.allSettled([...children].map((child) => child.close()));
    await Promise.allSettled([...renders].map((render) => render.close()));
    if (temporary) await rm(temporary, { recursive: true, force: true });
    signal?.removeEventListener('abort', cancel);
  }
}
