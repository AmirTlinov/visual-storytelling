import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionDirectory } from '../plugin/session-directory.mjs';
import { sessionStorage } from '../plugin/runtime/session-storage.mjs';
import { collectCache } from '../plugin/cache.mjs';
import { storyProjectOwner } from '../tools/story-project.mjs';
import { samePreparedOwner } from '../plugin/runtime/project-transactions.mjs';

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
  for (const build of [a, b])
    await writeFile(join(data, 'builds', build.revision + '.json'), JSON.stringify(build));
  let directory = new SessionDirectory();
  let storage = sessionStorage(data, directory, () => false);
  const shown = directory.open(a);
  shown.checkpoint = { mode: 'explore', values: { count: 19 }, time: 0 };
  shown.nextBuild = { ...b, authoredInputs: ['count'] };
  await storage.save(shown);
  directory = new SessionDirectory();
  storage = sessionStorage(data, directory, () => false);
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
  storage = sessionStorage(data, directory, () => false);
  const committed = await storage.load(shown.id);
  assert.deepEqual(
    committed.build.authoredInputs,
    ['count'],
    'restart after replacement commit retains keys until its rendered report',
  );
  const attached = await directory.attach(committed.id, 'renderer');
  assert.deepEqual(attached.authoredInputs, ['count'], 'attach passes intent to the renderer');
  directory = new SessionDirectory();
  storage = sessionStorage(data, directory, () => false);
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
