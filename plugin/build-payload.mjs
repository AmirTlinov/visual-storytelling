import { readFile, mkdir, access, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse } from 'parse5';
import { digest } from '../tools/project-files.mjs';
import { readJSON, writeJSON } from '../tools/storage.mjs';
import { storyDocumentScript, headInsertionOffset } from '../tools/story-html.mjs';

const hash = (value) => /^[a-f0-9]{64}$/.test(value);
const revisionKey = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
const building = new Map();
export const payloadWork = () => ({
  readBytes: 0,
  hashedBytes: 0,
  writtenBytes: 0,
  templateBytes: 0,
  templateBuilds: 0,
  templateHits: 0,
});
const measure = (work, key, bytes) => {
  work[key] += Buffer.byteLength(bytes);
};

async function asset(data, text, work) {
  measure(work, 'hashedBytes', text);
  const key = digest(text),
    file = join(data, 'payloads', key + '.html');
  const existing = await readFile(file, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (existing !== null) {
    measure(work, 'readBytes', existing);
    measure(work, 'hashedBytes', existing);
    if (digest(existing) === key) return { asset: key };
  }
  await mkdir(join(data, 'payloads'), { recursive: true });
  const temporary = file + '.' + randomUUID();
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(text);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
    measure(work, 'writtenBytes', text);
  } finally {
    await rm(temporary, { force: true });
  }
  return { asset: key };
}

/** Stable inline runtime, styles and data resources have one immutable content identity. */
async function split(data, html, work) {
  const ranges = [];
  const visit = (node) => {
    const location = node.sourceCodeLocation;
    if (['script', 'style'].includes(node.tagName) && location?.endTag) {
      const start = location.startTag.endOffset,
        end = location.endTag.startOffset;
      if (end - start >= 4096) ranges.push([start, end]);
    }
    for (const span of Object.values(location?.attrs ?? {}))
      if (span.endOffset - span.startOffset >= 4096)
        ranges.push([span.startOffset, span.endOffset]);
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(parse(html, { sourceCodeLocationInfo: true }));
  const parts = [];
  const append = async (text) => {
    if (text) parts.push(text.length >= 4096 ? await asset(data, text, work) : { text });
  };
  let cursor = 0;
  for (const [start, end] of ranges.sort((a, b) => a[0] - b[0])) {
    if (start < cursor) continue;
    await append(html.slice(cursor, start));
    parts.push(await asset(data, html.slice(start, end), work));
    cursor = end;
  }
  await append(html.slice(cursor));
  return parts;
}

export async function storePresentation(
  data,
  html,
  { documentSlot = false, work = payloadWork() } = {},
) {
  if (typeof html !== 'string') throw new TypeError('A prepared presentation needs HTML.');
  if (!documentSlot) return { parts: await split(data, html, work) };
  const head = headInsertionOffset(html);
  return {
    parts: [
      ...(await split(data, html.slice(0, head), work)),
      { document: true },
      ...(await split(data, html.slice(head), work)),
    ],
  };
}

/** Called under JobRunner's existing capture/maintenance exclusion. */
export async function preparedPresentation(data, key, create, work = payloadWork()) {
  if (!hash(key)) throw new Error('Invalid presentation identity.');
  const file = join(data, 'presentation-bases', key + '.json');
  const contents = await readFile(file, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const existing = contents === null ? null : JSON.parse(contents);
  if (existing && (await presentationAvailable(data, existing))) {
    measure(work, 'readBytes', contents);
    work.templateHits++;
    return { ...existing, template: key };
  }
  const operation = data + ':' + key;
  if (building.has(operation)) {
    work.templateHits++;
    return building.get(operation);
  }
  const pending = (async () => {
    const html = await create();
    work.templateBuilds++;
    measure(work, 'templateBytes', html);
    const presentation = await storePresentation(data, html, { documentSlot: true, work });
    await writeJSON(file, presentation);
    measure(work, 'writtenBytes', JSON.stringify(presentation));
    return { ...presentation, template: key };
  })();
  building.set(operation, pending);
  try {
    return await pending;
  } finally {
    if (building.get(operation) === pending) building.delete(operation);
  }
}

export async function writePreparedBuild(data, { html, ...build }, work = payloadWork()) {
  if (!revisionKey(build.revision)) throw new Error('Invalid prepared build revision.');
  if (html !== undefined) build.presentation = await storePresentation(data, html, { work });
  if (!Array.isArray(build.presentation?.parts)) throw new Error('Build has no presentation.');
  await writeJSON(join(data, 'builds', build.revision + '.json'), build);
  return build;
}

/** Descriptor cache hits validate their graph without reading or hashing large resources. */
export async function presentationAvailable(data, presentation) {
  if (!Array.isArray(presentation?.parts)) return false;
  for (const part of presentation.parts) {
    if (typeof part.text === 'string' || part.document === true) continue;
    if (!hash(part.asset)) return false;
    if (
      !(await access(join(data, 'payloads', part.asset + '.html')).then(
        () => true,
        (error) => {
          if (error.code === 'ENOENT') return false;
          throw error;
        },
      ))
    )
      return false;
  }
  return true;
}

/** Hydration is needed only for attach/reload or delivery, never for a semantic edit. */
export async function preparedBuildHTML(data, build, work = payloadWork()) {
  if (!Array.isArray(build?.presentation?.parts))
    throw new Error('The saved presentation is unavailable. Prepare the project again.');
  const parts = [];
  for (const part of build.presentation.parts) {
    if (typeof part.text === 'string') parts.push(part.text);
    else if (part.document === true && build.live?.document)
      parts.push(storyDocumentScript(build.live.document));
    else if (hash(part.asset)) {
      const text = await readFile(join(data, 'payloads', part.asset + '.html'), 'utf8');
      measure(work, 'readBytes', text);
      measure(work, 'hashedBytes', text);
      if (digest(text) !== part.asset)
        throw new Error('The immutable presentation payload changed.');
      parts.push(text);
    } else throw new Error('Invalid saved presentation part.');
  }
  return parts.join('');
}

async function storedBuild(data, revision) {
  if (revision === undefined) return null;
  if (!revisionKey(revision)) throw new Error('Invalid prepared build revision.');
  const build = await readJSON(join(data, 'builds', revision + '.json'));
  if (build && build.revision !== revision) throw new Error('Prepared build identity changed.');
  return build;
}

/** Inspection and GC do not prepare, convert or hydrate render payloads. */
export async function readBuildMetadata(data, revision) {
  const build = await storedBuild(data, revision);
  if (!build) return build;
  const { html: _html, ...metadata } = build;
  return metadata;
}

/** Upgrade selected persisted cards under the JobRunner input/maintenance exclusion. */
export async function readPreparedBuild(data, revision) {
  const build = await storedBuild(data, revision);
  return typeof build?.html === 'string' ? writePreparedBuild(data, build) : build;
}
