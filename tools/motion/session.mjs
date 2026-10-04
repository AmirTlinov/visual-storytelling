import {
  mkdir,
  readFile,
  writeFile,
  copyFile,
  realpath,
  stat,
  appendFile,
  rm,
} from 'node:fs/promises';
import { resolve, join, dirname, relative } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Raw images are written immediately. Only frame references remain in memory. */
export async function captureWriter(out) {
  const folder = join(out, 'capture');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'frames.jsonl'), '');
  const frames = [];
  return {
    frames,
    async append(sample) {
      const { png, file: input, ...metadata } = sample;
      const file = join(folder, `${String(frames.length).padStart(9, '0')}.png`);
      const frame = { ...metadata, file };
      if (png?.readUInt32BE && png.length >= 24) {
        frame.width = png.readUInt32BE(16);
        frame.height = png.readUInt32BE(20);
      }
      if (png) await writeFile(file, png);
      else if (resolve(input) !== resolve(file)) await copyFile(input, file);
      await appendFile(
        join(folder, 'frames.jsonl'),
        JSON.stringify({ ...frame, file: relative(folder, file) }) + '\n',
      );
      frames.push(frame);
      return frame;
    },
    async finish(source, telemetry, context) {
      const path = join(folder, 'frames.json');
      const manifest = {
        source,
        ...(context ? { context } : {}),
        ...(telemetry ? { telemetry: '../telemetry.json' } : {}),
        frames: frames.map(({ file, epoch, ...frame }) => ({
          ...frame,
          file: relative(folder, file),
        })),
      };
      if (telemetry) await writeFile(join(out, 'telemetry.json'), JSON.stringify(telemetry) + '\n');
      await writeFile(path, JSON.stringify(manifest) + '\n');
      await rm(join(folder, 'frames.jsonl'), { force: true });
      return path;
    },
  };
}

export async function loadCapture(input) {
  let path = await realpath(input);
  if ((await stat(path)).isDirectory()) {
    const directory = path;
    for (const candidate of ['session.json', 'capture/frames.json', 'capture/frames.jsonl']) {
      path = join(directory, candidate);
      if (
        await stat(path).then(
          () => true,
          () => false,
        )
      )
        break;
    }
  }
  let value;
  if (path.endsWith('.jsonl')) {
    const lines = (await readFile(path, 'utf8')).split('\n');
    const frames = lines.flatMap((line) => {
      try {
        return line ? [JSON.parse(line)] : [];
      } catch {
        return [];
      }
    });
    const origin = frames[0]?.epoch;
    value = {
      source: {
        kind: 'partial-capture',
        path,
        clock: origin ? 'capture epoch' : 'model time',
        truncated: true,
        warning: 'Recovered raw frames; the capture did not finalize metadata.',
      },
      frames: frames.map((f) => ({ ...f, time: f.time ?? (f.epoch - origin) / 1000 })),
    };
  } else value = JSON.parse(await readFile(path, 'utf8'));
  let session;
  if (value.kind === 'visual-review-session') {
    session = value;
    path = resolve(dirname(path), value.capture);
    value = JSON.parse(await readFile(path, 'utf8'));
  }
  if (!Array.isArray(value.frames))
    throw new Error('Expected a review session or a frame manifest');
  if (!value.frames.length) throw new Error('This capture has no saved frames yet');
  let previous = -Infinity;
  const frames = value.frames.map((frame, i) => {
    if (!Number.isFinite(frame.time) || frame.time <= previous || typeof frame.file !== 'string')
      throw new Error('Manifest needs PNG file paths and strictly increasing times in seconds');
    previous = frame.time;
    return { ...frame, id: frame.id ?? `frame:${i}`, file: resolve(dirname(path), frame.file) };
  });
  const telemetry = value.telemetry
    ? JSON.parse(await readFile(resolve(dirname(path), value.telemetry), 'utf8'))
    : undefined;
  return {
    samples: frames,
    source: value.source,
    context: value.context,
    telemetry,
    session,
    captureManifest: path,
  };
}

export async function saveSession(
  out,
  { captureManifest, source, episodes, context, samples, telemetry, replayPath, parent },
) {
  await mkdir(out, { recursive: true });
  const session = {
    kind: 'visual-review-session',
    version: 1,
    id: randomUUID(),
    created: new Date().toISOString(),
    source,
    capture: relative(out, captureManifest),
    ...(parent ? { parent } : {}),
    ...(replayPath ? { replay: relative(out, replayPath) } : {}),
    coverage: {
      from: samples[0].time,
      to: samples.at(-1).time,
      frames: samples.length,
      sampling:
        source.kind === 'scene-seek'
          ? 'model-checkpoints'
          : source.sparse
            ? 'image-updates'
            : 'recorded-frames',
      complete: !source.truncated && !source.error,
      ...(source.gaps?.length ? { gaps: source.gaps } : {}),
    },
    capabilities: [
      'pixels',
      ...(context?.review ? ['narration', 'model-state'] : []),
      ...(telemetry?.capabilities ?? []),
      ...(replayPath ? ['scenario-replay'] : []),
    ],
    episodes,
  };
  await writeFile(join(out, 'session.json'), JSON.stringify(session, null, 2) + '\n');
  return session;
}

export const frameInput = (sample) => sample.png ?? sample.file;

export function nearestFrame(samples, time) {
  let lo = 0,
    hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (samples[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  return lo && Math.abs(samples[lo - 1].time - time) < Math.abs(samples[lo].time - time)
    ? samples[lo - 1]
    : samples[lo];
}
