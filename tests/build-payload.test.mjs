import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, stat, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  payloadWork,
  preparedPresentation,
  preparedBuildHTML,
  writePreparedBuild,
  readPreparedBuild,
  storePresentation,
} from '../plugin/build-payload.mjs';
import { digest } from '../tools/project-files.mjs';
import { withStoryDocument } from '../tools/story-html.mjs';
import { readJSON, writeJSON } from '../tools/storage.mjs';
import { collectCache } from '../plugin/cache.mjs';

test('200 edits share the actual prepared runtime without rereading or hashing its payload', async (t) => {
  const data = await mkdtemp(join(tmpdir(), 'story-payload-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  const html = await readFile('plugin/dist/live.html', 'utf8'),
    key = digest(html);
  assert(html.length > 1_000_000, 'exercise the shipped runtime, not a small synthetic page');
  let builds = 0;
  const warm = [];
  for (let index = 0; index < 200; index++) {
    const work = payloadWork();
    const presentation = await preparedPresentation(
      data,
      key,
      () => {
        builds++;
        return html;
      },
      work,
    );
    await writePreparedBuild(data, {
      revision: 'build-' + index,
      sourceRevision: 'source-' + index,
      presentation,
      live: { runtimeBuild: key, document: { index, text: '</script><b>data</b>' } },
    });
    if (index) warm.push(work);
  }
  assert.equal(builds, 1);
  assert(
    warm.every(
      (w) =>
        w.templateHits === 1 &&
        w.hashedBytes === 0 &&
        w.writtenBytes === 0 &&
        w.templateBytes === 0,
    ),
  );
  assert(
    warm.every((w) => w.readBytes < 20_000),
    'only the small base descriptor is read',
  );
  const first = await readJSON(join(data, 'builds/build-0.json'));
  const current = await readJSON(join(data, 'builds/build-199.json'));
  assert(!Object.hasOwn(first, 'html'));
  assert.equal(await preparedBuildHTML(data, first), withStoryDocument(html, first.live.document));
  assert.equal(
    await preparedBuildHTML(data, current),
    withStoryDocument(html, current.live.document),
  );
  assert((await stat(join(data, 'builds/build-199.json'))).size < 20_000);
  const payloads = await readdir(join(data, 'payloads'));
  const bytes = (
    await Promise.all(payloads.map((name) => stat(join(data, 'payloads', name))))
  ).reduce((sum, s) => sum + s.size, 0);
  assert(bytes <= Buffer.byteLength(html), 'large immutable content is stored once');
  await writeJSON(join(data, 'sessions/saved.json'), { buildRevision: 'build-0' });
  const gc = await collectCache(data, {
    limitMB: 0,
    projects: [{ buildRevision: 'build-199' }],
    sessions: [],
    snapshotLeases: [],
    buildLeases: ['build-175'],
  });
  assert(gc.protectedBytes >= bytes);
  assert.deepEqual((await readdir(join(data, 'builds'))).sort(), [
    'build-0.json',
    'build-175.json',
    'build-199.json',
  ]);
  assert.equal(await preparedBuildHTML(data, first), withStoryDocument(html, first.live.document));
  assert.equal(
    await preparedBuildHTML(data, current),
    withStoryDocument(html, current.live.document),
  );
  const work = payloadWork();
  await preparedPresentation(
    data,
    key,
    () => {
      throw Error('protected base was evicted');
    },
    work,
  );
  assert.equal(work.templateHits, 1);
});

test('source-built pages share stable inline assets, detect changed bytes and upgrade old cards once', async (t) => {
  const data = await mkdtemp(join(tmpdir(), 'story-payload-source-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  const runtime = 'const runtime = ' + JSON.stringify('x'.repeat(20_000));
  const page = (text) =>
    `<html><head><script>${runtime}</script></head><body>${text}</body></html>`;
  const first = await writePreparedBuild(data, { revision: 'a', html: page('first') });
  const second = await writePreparedBuild(data, { revision: 'b', html: page('second') });
  assert.deepEqual(
    first.presentation.parts.filter((p) => p.asset),
    second.presentation.parts.filter((p) => p.asset),
  );
  assert.equal(await preparedBuildHTML(data, first), page('first'));
  const asset = first.presentation.parts.find((p) => p.asset).asset;
  await writeFile(join(data, 'payloads', asset + '.html'), 'corrupted cache');
  await assert.rejects(preparedBuildHTML(data, first), /payload changed/);
  await writePreparedBuild(data, { revision: 'b', html: page('second') });
  assert.equal(
    await preparedBuildHTML(data, first),
    page('first'),
    'a fresh compile repairs bytes by their real content',
  );
  await writeJSON(join(data, 'builds/old.json'), {
    revision: 'old',
    html: page('accepted old card'),
  });
  await readPreparedBuild(data, 'old');
  const old = await readJSON(join(data, 'builds/old.json'));
  assert(!Object.hasOwn(old, 'html'));
  assert.equal(await preparedBuildHTML(data, old), page('accepted old card'));
  await readPreparedBuild(data, 'old');
  assert.deepEqual(await readJSON(join(data, 'builds/old.json')), old);
});

test('concurrent cold requests share a single template preparation and failed preparation can retry', async (t) => {
  const data = await mkdtemp(join(tmpdir(), 'story-payload-concurrent-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  const key = digest('template');
  let count = 0,
    release;
  const a = preparedPresentation(data, key, async () => {
    count++;
    await new Promise((resolve) => (release = resolve));
    return '<head></head><body>accepted</body>';
  });
  while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
  const b = preparedPresentation(data, key, () => {
    throw Error('duplicate build');
  });
  release();
  assert.deepEqual(await a, await b);
  assert.equal(count, 1);
  const retryKey = digest('retry');
  await assert.rejects(
    preparedPresentation(data, retryKey, () => {
      throw Error('failed preparation');
    }),
    /failed preparation/,
  );
  await preparedPresentation(data, retryKey, () => '<head></head>');
});

test('cache maintenance protects unopened legacy cards without converting their payloads', async (t) => {
  const data = await mkdtemp(join(tmpdir(), 'story-payload-unopened-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  for (let i = 0; i < 3; i++) {
    await writeJSON(join(data, 'builds', `old-${i}.json`), {
      revision: `old-${i}`,
      html: '<script>' + 'x'.repeat(100_000) + '</script>',
    });
    await writeJSON(join(data, 'sessions', `card-${i}.json`), { buildRevision: `old-${i}` });
  }
  await collectCache(data, { limitMB: 0, projects: [], sessions: [], snapshotLeases: [] });
  for (let i = 0; i < 3; i++)
    assert.equal(typeof (await readJSON(join(data, 'builds', `old-${i}.json`))).html, 'string');
  assert.deepEqual(
    await readdir(join(data, 'payloads')).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    }),
    [],
  );
});

test('an evicted dependency makes a base miss rather than publishing another broken build', async (t) => {
  const data = await mkdtemp(join(tmpdir(), 'story-payload-graph-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  const html =
    '<html><head><script>' +
    JSON.stringify('x'.repeat(5000)) +
    '</script></head><body>same</body></html>';
  const key = digest(html);
  let creates = 0;
  const create = () => {
    creates++;
    return html;
  };
  const presentation = await preparedPresentation(data, key, create);
  await writePreparedBuild(data, {
    revision: 'old',
    presentation,
    live: { document: { index: 1 } },
  });
  const chunk = presentation.parts.find((part) => part.asset).asset;
  await utimes(join(data, 'payloads', chunk + '.html'), 1, 1);
  await collectCache(data, { limitMB: 0.001, projects: [], sessions: [], snapshotLeases: [] });
  assert(await readJSON(join(data, 'presentation-bases', key + '.json')));
  const next = await preparedPresentation(data, key, create);
  assert.equal(creates, 2);
  const build = await writePreparedBuild(data, {
    revision: 'new',
    presentation: next,
    live: { document: { index: 2 } },
  });
  assert.equal(await preparedBuildHTML(data, build), withStoryDocument(html, build.live.document));
});

test('literal head text in authored JS and CSS never becomes the document insertion point', async (t) => {
  const data = await mkdtemp(join(tmpdir(), 'story-payload-head-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  const html =
    '<html><head><script>window.example="</head>";</script><style>p:before{content:"</head>"}</style></head><body>one</body></html>';
  const document = { version: 2, title: '</script><b>data</b>' };
  const presentation = await storePresentation(data, html, { documentSlot: true });
  const build = await writePreparedBuild(data, {
    revision: 'head',
    presentation,
    live: { document },
  });
  const hydrated = await preparedBuildHTML(data, build);
  assert.equal(hydrated, withStoryDocument(html, document));
  const window = {};
  for (const match of hydrated.matchAll(/<script>([\s\S]*?)<\/script>/g))
    new Function('window', match[1])(window);
  assert.equal(window.example, '</head>');
  assert.deepEqual(window.__visualStoryDocument, document);
});
