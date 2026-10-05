import {
  mkdir,
  readFile,
  writeFile,
  copyFile,
  realpath,
  stat,
  appendFile,
  rm,
  open,
  rename,
  readdir,
} from 'node:fs/promises';
import { resolve, join, dirname, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

/** Publish complete metadata only; interrupted writes leave the journal recoverable. */
async function atomicFile(path, write) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx');
  try {
    await write(handle);
    await handle.close();
    await rename(temporary, path);
  } finally {
    await handle.close();
    await rm(temporary, { force: true });
  }
}

const ownedImage = /^(?:\d{9}|capture-[\da-f-]{36}-\d{9})\.png$/;

/** Raw images are written immediately. Only frame references remain in memory. */
export async function captureWriter(out, { reference = false } = {}) {
  await mkdir(join(out, 'capture'), { recursive: true });
  out = await realpath(out);
  const folder = join(out, 'capture');
  const journal = join(folder, 'frames.jsonl');
  const manifest = join(folder, 'frames.json');
  const id = randomUUID();
  const frames = [];
  let started = false,
    finished = false,
    initial;
  async function begin(metadata = {}) {
    if (started) throw new Error('This capture has already begun');
    const header = JSON.stringify({ kind: 'visual-capture-start', version: 1, id, ...metadata });
    const session = await readFile(join(out, 'session.json'), 'utf8').then(JSON.parse, (error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (session !== undefined && session?.kind !== 'visual-review-session')
      throw new Error(
        'Capture output contains an unrelated session.json; choose another directory',
      );
    // Invalidate the previous report before publishing this run. Its pictures stay intact
    // until finish, but it must never masquerade as the result of an interrupted new run.
    if (session) {
      for (const file of [
        'session.json',
        'index.html',
        'motion.json',
        'motion.png',
        'frames.png',
        'photometry.png',
      ])
        await rm(join(out, file), { force: true });
    }
    await rm(manifest, { force: true });
    await atomicFile(journal, (handle) => handle.writeFile(header + '\n'));
    initial = metadata;
    started = true;
  }
  return {
    frames,
    begin,
    async append(sample) {
      if (finished) throw new Error('This capture has already finished');
      if (!started) await begin();
      const { png, file: input, ...metadata } = sample;
      if (!png && typeof input !== 'string')
        throw new Error('A captured frame needs PNG bytes or a file');
      const file =
        reference && !png
          ? await realpath(input)
          : join(folder, `capture-${id}-${String(frames.length).padStart(9, '0')}.png`);
      const frame = { ...metadata, file };
      if (png?.readUInt32BE && png.length >= 24) {
        frame.width = png.readUInt32BE(16);
        frame.height = png.readUInt32BE(20);
      }
      // Serialize metadata before writing the image; a failed append must not enter the journal.
      const entry = JSON.stringify({ ...frame, file: relative(folder, file) }) + '\n';
      if (png) await writeFile(file, png, { flag: 'wx' });
      else if (!reference)
        await copyFile(input, file, constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL);
      else if (!(await stat(file)).isFile())
        throw new Error('A captured frame must reference a regular file');
      await appendFile(journal, entry);
      frames.push(frame);
      return frame;
    },
    async finish(source, telemetry, context) {
      if (finished) throw new Error('This capture has already finished');
      if (!started) await begin({ source, context });
      source ??= initial.source;
      context ??= initial.context;
      const metadata = {
        source,
        ...(context ? { context } : {}),
        ...(telemetry ? { telemetry: '../telemetry.json' } : {}),
      };
      const prefix = JSON.stringify(metadata).slice(0, -1);
      if (telemetry)
        await atomicFile(join(out, 'telemetry.json'), (handle) =>
          handle.writeFile(JSON.stringify(telemetry) + '\n'),
        );
      await atomicFile(manifest, async (handle) => {
        await handle.writeFile(prefix + (prefix.length > 1 ? ',' : '') + '"frames":[\n');
        for (const [i, { file, epoch, ...frame }] of frames.entries())
          await handle.writeFile(
            (i ? ',\n' : '') + JSON.stringify({ ...frame, file: relative(folder, file) }),
          );
        await handle.writeFile('\n]}\n');
      });
      finished = true;
      await rm(journal, { force: true });
      // Remove only our obsolete raw images, never arbitrary files in the output directory.
      const retained = new Set(frames.map((frame) => frame.file));
      for (const entry of await readdir(folder, { withFileTypes: true }))
        if (
          entry.isFile() &&
          ownedImage.test(entry.name) &&
          !retained.has(join(folder, entry.name))
        )
          await rm(join(folder, entry.name));
      return manifest;
    },
  };
}

async function recoverJournal(path) {
  const frames = [];
  let metadata;
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      // An interrupted final append may end midway through a JSON record.
      break;
    }
    if (!frames.length && record.kind === 'visual-capture-start') metadata = record;
    else frames.push(record);
  }
  const origin = frames[0]?.epoch;
  return {
    source: {
      ...(metadata?.source ?? {
        kind: 'partial-capture',
        path,
        clock: Number.isFinite(origin) ? 'capture epoch' : 'model time',
      }),
      truncated: true,
      warning: 'Recovered completed raw frames; this capture did not finish.',
    },
    ...(metadata?.context ? { context: metadata.context } : {}),
    frames: frames.map((f) => ({ ...f, time: f.time ?? (f.epoch - origin) / 1000 })),
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
  if (path.endsWith('.jsonl')) value = await recoverJournal(path);
  else value = JSON.parse(await readFile(path, 'utf8'));
  let session;
  if (value.kind === 'visual-review-session') {
    session = value;
    path = resolve(dirname(path), value.capture);
    value = path.endsWith('.jsonl')
      ? await recoverJournal(path)
      : JSON.parse(await readFile(path, 'utf8'));
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
  out = await realpath(out);
  const session = {
    kind: 'visual-review-session',
    version: 1,
    id: randomUUID(),
    created: new Date().toISOString(),
    source,
    capture: relative(out, await realpath(captureManifest)),
    ...(parent ? { parent } : {}),
    ...(replayPath ? { replay: relative(out, await realpath(replayPath)) } : {}),
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
  await atomicFile(join(out, 'session.json'), (handle) =>
    handle.writeFile(JSON.stringify(session, null, 2) + '\n'),
  );
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
