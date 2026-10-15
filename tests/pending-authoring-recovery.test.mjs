import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { JobRunner } from '../plugin/jobs.mjs';
import { setImmediate } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionDirectory, buildReference } from '../plugin/session-directory.mjs';
import { sessionStorage } from '../plugin/runtime/session-storage.mjs';
import { collectCache } from '../plugin/cache.mjs';
import { storyProjectOwner } from '../tools/story-project.mjs';
import { samePreparedOwner } from '../plugin/runtime/project-delivery.mjs';
import { writePreparedBuild } from '../plugin/build-payload.mjs';
import { readJSON, writeJSON } from '../tools/storage.mjs';

test('restart preserves pending authored keys and their immutable build while retaining the shown checkpoint', async (t) => {
  const data = await mkdtemp(join(tmpdir(), 'pending-author-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  await mkdir(join(data, 'builds'));
  const a = {
    revision: 'shown-A',
    sourceRevision: 'source-A',
    projectId: 'project',
    title: 'A',
    html: '<main>A</main>',
  };
  const b = {
    ...a,
    revision: 'prepared-B',
    sourceRevision: 'source-B',
    html: '<main>B</main>',
    live: { runtimeBuild: 'runtime-B', moduleRevision: 'module-B', document: {} },
  };
  for (const build of [a, b]) await writePreparedBuild(data, build);
  let directory = new SessionDirectory();
  let storage = sessionStorage(
    data,
    directory,
    () => false,
    (work) => work(),
  );
  const shown = directory.open(a);
  shown.checkpoint = { mode: 'explore', values: { count: 19 }, time: 0 };
  shown.nextBuild = { ...b, authoredInputs: ['count'] };
  await storage.save(shown);
  directory = new SessionDirectory();
  storage = sessionStorage(
    data,
    directory,
    () => false,
    (work) => work(),
  );
  const restored = await storage.load(shown.id);
  assert.deepEqual(restored.checkpoint.values, { count: 19 }, 'shown A remains distinct');
  assert.equal(restored.nextBuild.revision, b.revision);
  assert.deepEqual(restored.nextBuild.authoredInputs, ['count']);
  await collectCache(data, { limitMB: 0, projects: [], sessions: [], snapshotLeases: [] });
  await access(join(data, 'builds', b.revision + '.json'));
  restored.build = restored.nextBuild;
  restored.nextBuild = null;
  await storage.save(restored);
  directory = new SessionDirectory();
  storage = sessionStorage(
    data,
    directory,
    () => false,
    (work) => work(),
  );
  const committed = await storage.load(shown.id);
  assert.deepEqual(
    committed.build.authoredInputs,
    ['count'],
    'restart after replacement commit retains keys until its rendered report',
  );
  const attached = await directory.attach(committed.id, 'renderer');
  assert.deepEqual(attached.authoredInputs, ['count'], 'attach passes intent to the renderer');
  directory = new SessionDirectory();
  storage = sessionStorage(
    data,
    directory,
    () => false,
    (work) => work(),
  );
  const reload = await storage.load(shown.id);
  const recovered = await directory.recover({
    sessionId: reload.id,
    renderer: 'renderer',
    generation: reload.generation,
    serverInstance: 'previous-process',
  });
  assert.equal(recovered.recovery, 'reload');
  assert.deepEqual(recovered.authoredInputs, ['count'], 'reload retains intent until rendering');
  await directory.exchange({
    ...recovered,
    renderer: 'renderer',
    report: {
      stateRevision: 0,
      renderStatus: 'rendered',
      state: {},
      checkpoint: { mode: 'explore', values: { count: 22 }, time: 0 },
    },
  });
  await storage.save(reload);
  assert.equal(reload.build.authoredInputs, undefined);
  assert.equal(
    JSON.parse(await readFile(join(data, 'sessions', shown.id + '.json'), 'utf8')).checkpoint.values
      .count,
    22,
  );
});
test('restart loads the accepted card without hydrating an unavailable pending payload or leaking sessions', async (t) => {
  const data = await mkdtemp(join(tmpdir(), 'pending-payload-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  const current = await writePreparedBuild(data, {
    revision: 'current',
    html: '<main>accepted</main>',
  });
  const pending = await writePreparedBuild(data, {
    revision: 'pending',
    html: '<script>' + JSON.stringify('x'.repeat(5000)) + '</script>',
  });
  const original = new SessionDirectory();
  t.after(() => original.close());
  const session = original.open(current);
  session.nextBuild = buildReference(pending);
  await sessionStorage(
    data,
    original,
    () => false,
    (work) => work(),
  ).save(session);
  const asset = pending.presentation.parts.find((part) => part.asset).asset;
  await rm(join(data, 'payloads', asset + '.html'));
  const directory = new SessionDirectory();
  t.after(() => directory.close());
  const storage = sessionStorage(
    data,
    directory,
    () => false,
    (work) => work(),
  );
  const loaded = await storage.load(session.id);
  assert.equal(loaded.build.revision, 'current');
  assert.equal(loaded.nextBuild.revision, 'pending');
  assert.equal((await storage.viewBuild('current')).html, '<main>accepted</main>');
  assert.equal(await storage.load(session.id), loaded);
  assert.equal(directory.sessions.size, 1);
  const file = join(data, 'sessions', session.id + '.json');
  await writeJSON(file, { ...(await readJSON(file)), nextBuildRevision: 'missing' });
  const invalid = new SessionDirectory();
  t.after(() => invalid.close());
  const retry = sessionStorage(
    data,
    invalid,
    () => false,
    (work) => work(),
  );
  await assert.rejects(retry.load(session.id), /candidate is unavailable/);
  await assert.rejects(retry.load(session.id), /candidate is unavailable/);
  assert.equal(invalid.sessions.size, 0);
});

test('an imported/declared audio or timeline resource changes the author-module owner', async (t) => {
  const data = await mkdtemp(join(tmpdir(), 'resource-owner-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  await writeFile(join(data, 'story.json'), '{}');
  await writeFile(join(data, 'timeline.json'), '{}');
  await writeFile(join(data, 'audio.wav'), 'accepted-media-A');
  const before = await storyProjectOwner(data);
  await writeFile(join(data, 'story.json'), '{"version":2}');
  assert.equal(await storyProjectOwner(data), before);
  await writeFile(join(data, 'timeline.json'), '{"duration":2}');
  assert.notEqual(await storyProjectOwner(data), before);
  const aligned = await storyProjectOwner(data);
  await writeFile(join(data, 'audio.wav'), 'accepted-media-B');
  assert.notEqual(await storyProjectOwner(data), aligned);
});

test('an older mounted subject does not prevalidate another subject sharing its runtime and manifest', () => {
  const build = (id, module, inputs) => ({
    live: {
      runtimeBuild: 'same-runtime',
      moduleRevision: 'same-manifest',
      document: { models: [{ id, module, inputs }] },
    },
  });
  const division = { build: build('experience', 'division', { count: 17, divisor: 4 }) };
  assert.equal(
    samePreparedOwner(division, build('experience', 'division', { count: 22, divisor: 5 })),
    true,
  );
  assert.equal(
    samePreparedOwner(division, build('experience', 'dependency-route', { orderId: '417' })),
    false,
  );
  assert.equal(
    samePreparedOwner(division, build('renamed', 'division', { count: 22, divisor: 5 })),
    false,
  );
});

test('selected saved-card migration waits for cache maintenance while metadata loading stays read-only', async (t) => {
  const data = await mkdtemp(join(tmpdir(), 'saved-migration-gc-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  const legacy = {
    revision: 'saved-legacy',
    html: '<script>' + JSON.stringify('x'.repeat(8000)) + '</script>',
  };
  await writeJSON(join(data, 'builds', legacy.revision + '.json'), legacy);
  const directory = new SessionDirectory();
  t.after(() => directory.close());
  const jobs = new JobRunner(data, 'unused-worker');
  const storage = sessionStorage(
    data,
    directory,
    () => false,
    (work) => jobs.preserveInputs(work),
  );
  const session = directory.open(legacy);
  await storage.save(session);
  directory.sessions.clear();
  let release, entered;
  const holding = new Promise((resolve) => {
    entered = resolve;
  });
  const maintenance = jobs.preserveInputs(async () => {
    await new Promise((resolve) => {
      release = resolve;
      entered();
    });
    return collectCache(data, { limitMB: 0, projects: [], sessions: [], snapshotLeases: [] });
  });
  await holding;
  await storage.load(session.id);
  assert.equal(
    (await readJSON(join(data, 'builds', legacy.revision + '.json'))).html,
    legacy.html,
    'loading metadata does not create payloads',
  );
  let hydrated = false;
  const view = storage.viewBuild(legacy.revision).then((value) => {
    hydrated = true;
    return value;
  });
  await setImmediate();
  assert.equal(hydrated, false, 'migration must wait for the existing input/maintenance owner');
  release();
  await maintenance;
  assert.equal((await view).html, legacy.html);
  assert.equal((await readJSON(join(data, 'builds', legacy.revision + '.json'))).html, undefined);
  await jobs.preserveInputs(() =>
    collectCache(data, { limitMB: 0, projects: [], sessions: [], snapshotLeases: [] }),
  );
  assert.equal(
    (await storage.viewBuild(legacy.revision)).html,
    legacy.html,
    'the migrated graph survives later collection',
  );
});
