import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const json = (value) => JSON.stringify(value).replaceAll('<', '\\u003c');
export const reportUrl = (out, file) =>
  relative(out, file).split('/').map(encodeURIComponent).join('/');

/** The HTML keeps coordinates in time; detailed observations stay in bounded JS chunks.
 * Classic script loading works for both HTTP and a report opened from the filesystem. */
export async function writeReportEvidence(report, out) {
  if (!report.session) return undefined;
  const folder = join(out, 'analysis');
  await mkdir(folder, { recursive: true });
  for (const file of await readdir(folder))
    if (/^evidence-[a-f0-9]{24}\.js$/.test(file)) await rm(join(folder, file));
  const index = {
    frames: [],
    telemetry: {
      documents: (report.telemetry?.documents ?? []).map(({ time, url }) => ({ time, url })),
    },
    source: { viewport: report.source.viewport },
    chunks: [],
  };
  for (const kind of ['frames', 'scene', 'elements', 'events', 'steps']) {
    const records = kind === 'frames' ? report.samples : (report.telemetry?.[kind] ?? []);
    const entries = kind === 'frames' ? index.frames : (index.telemetry[kind] = []);
    let batch = [],
      bytes = 0;
    const flush = async () => {
      if (!batch.length) return;
      const payload = `{"kind":${json(kind)},"records":[${batch.join(',')}]}`;
      const script = `document.currentScript.motionEvidence=JSON.parse(${json(payload)});\n`;
      // An already open report must never hydrate its old index with a replacement run's data.
      const hash = createHash('sha256').update(script).digest('hex').slice(0, 24);
      const file = `analysis/evidence-${hash}.js`;
      await writeFile(join(out, file), script);
      index.chunks.push({ file, bytes: Buffer.byteLength(script) });
      batch = [];
      bytes = 0;
    };
    for (const [i, record] of records.entries()) {
      let detail = record;
      if (kind === 'frames') {
        const { png, epoch, ...metadata } = record;
        detail = { ...metadata, file: reportUrl(out, record.file) };
      }
      const serialized = `[${i},${json(detail)}]`;
      const size = Buffer.byteLength(serialized);
      if (batch.length && (bytes + size > 512 * 1024 || batch.length === 64)) await flush();
      entries.push({
        time: record.time,
        chunk: index.chunks.length,
        ...(kind === 'frames'
          ? { id: record.id, file: detail.file, width: record.width, height: record.height }
          : kind === 'elements'
            ? { selector: record.selector, document: record.document }
            : {}),
      });
      batch.push(serialized);
      bytes += size;
    }
    await flush();
  }
  return index;
}

/** Embedded verbatim in the report. This only loads observations; queryEvidence owns selection. */
export function createReportEvidence(index) {
  const cache = new Map(),
    active = new Map();
  let cachedBytes = 0,
    current;
  function remember(id, payload) {
    cache.set(id, payload);
    cachedBytes += index.chunks[id].bytes;
    while (cache.size > 8 || cachedBytes > 8 * 1024 * 1024) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
      cachedBytes -= index.chunks[oldest].bytes;
    }
  }
  function read(id) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const finish = (error) => {
        clearTimeout(timeout);
        const payload = script.motionEvidence;
        script.remove();
        script.onload = script.onerror = null;
        script.motionEvidence = undefined;
        if (error) reject(error);
        else if (!payload) reject(new Error('Empty evidence chunk: ' + index.chunks[id].file));
        else resolve(payload);
      };
      const timeout = setTimeout(() => finish(new Error('Evidence loading timed out')), 15000);
      script.src = index.chunks[id].file;
      script.onload = () => finish();
      script.onerror = () => finish(new Error('Cannot load ' + index.chunks[id].file));
      document.head.append(script);
    });
  }
  function hydrate(chunks) {
    const data = {
      frames: index.frames.slice(),
      telemetry: { ...index.telemetry },
      source: index.source,
    };
    for (const key of ['scene', 'elements', 'events', 'steps'])
      data.telemetry[key] = index.telemetry[key].slice();
    for (const { kind, records } of chunks.values()) {
      const entries = kind === 'frames' ? data.frames : data.telemetry[kind];
      for (const [i, detail] of records) entries[i] = detail;
    }
    return data;
  }
  function pump() {
    if (!current) return;
    if ([...current.ids].every((id) => current.loaded.has(id))) {
      const request = current;
      current = undefined;
      request.resolve(hydrate(request.loaded));
      return;
    }
    for (const id of current.ids) {
      if (active.size >= 2) break;
      if (current.loaded.has(id) || active.has(id)) continue;
      const promise = read(id);
      active.set(id, promise);
      promise
        .then(
          (payload) => {
            remember(id, payload);
            if (current?.ids.has(id)) current.loaded.set(id, payload);
          },
          (error) => {
            if (current?.ids.has(id)) {
              current.reject(error);
              current = undefined;
            }
          },
        )
        .finally(() => {
          active.delete(id);
          pump();
        });
    }
  }
  function needed({ at, from, to }) {
    const ids = new Set();
    const add = (record) => {
      if (record) ids.add(record.chunk);
    };
    // Include the window, its neighbours and the nearest frame. Sparse captures need
    // both sides even when the requested interval contains no saved image.
    const frames = index.frames;
    let before,
      after,
      nearest = frames[0];
    for (const frame of frames) {
      if (frame.time < from) before = frame;
      else if (frame.time <= to) add(frame);
      else after ??= frame;
      if (Math.abs(frame.time - at) <= Math.abs(nearest.time - at)) nearest = frame;
    }
    add(before);
    add(after);
    add(nearest);
    const telemetry = index.telemetry;
    const documentAt = [...telemetry.documents]
      .filter((d) => d.time <= at)
      .sort((a, b) => a.time - b.time)
      .at(-1)?.url;
    const latest = new Map();
    for (const record of telemetry.elements) {
      if (record.time >= from && record.time <= to) add(record);
      if (record.time <= at && (!documentAt || !record.document || record.document === documentAt))
        latest.set(record.selector, record);
    }
    for (const record of latest.values()) add(record);
    add(telemetry.scene.findLast((record) => record.time <= at));
    for (const kind of ['scene', 'events', 'steps'])
      for (const record of telemetry[kind])
        if (record.time >= from && record.time <= to) add(record);
    return ids;
  }
  return {
    load(window) {
      // A seek supersedes pending work; at most two script requests can remain in flight.
      current?.resolve(undefined);
      return new Promise((resolve, reject) => {
        const ids = needed(window),
          loaded = new Map();
        for (const id of ids)
          if (cache.has(id)) {
            const payload = cache.get(id);
            cache.delete(id);
            cache.set(id, payload);
            loaded.set(id, payload);
          }
        current = { ids, loaded, resolve, reject };
        pump();
      });
    },
  };
}
