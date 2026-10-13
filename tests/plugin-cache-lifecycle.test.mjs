import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionDirectory, buildReference } from '../plugin/session-directory.mjs';
import { collectCache } from '../plugin/cache.mjs';
import { writeJSON } from '../tools/storage.mjs';

const frame = (stateRevision, authoring) => ({
  stateRevision,
  state: { time: stateRevision, playing: false, parameters: [] },
  checkpoint: { time: stateRevision, progress: 0, mode: 'story', values: {} },
  renderStatus: 'rendered',
  ...(authoring && { authoring }),
});

async function displayed(t, build) {
  const directory = new SessionDirectory({ pollTimeout: 1 });
  t.after(() => directory.close());
  const session = directory.open(build);
  const attached = await directory.attach(session.id, 'renderer');
  const view = { sessionId: session.id, renderer: 'renderer', generation: attached.generation };
  await directory.exchange({ ...view, report: frame(0), wait: false });
  return { directory, session, view };
}

test('200 live edits retain historical receipts without retaining render payloads or superseded attempts', async (t) => {
  const { directory, session, view } = await displayed(t, {
    revision: 'initial',
    html: 'initial payload',
  });
  const largeHTML = '<main>' + 'x'.repeat(1_000_000) + '</main>';
  let first;
  for (let index = 0; index < 200; index++) {
    const build = {
      revision: 'build-' + index,
      sourceRevision: 'source-' + index,
      html: largeHTML,
    };
    const request = {
      op: 'author',
      requestId: 'author-' + index,
      buildRevision: session.build.revision,
      stateRevision: session.stateRevision,
      nextBuildRevision: build.revision,
      sourceRevision: build.sourceRevision,
      document: { count: index },
    };
    const pending = directory.request(session.id, request, { authoredBuild: build });
    const [command] = (await directory.exchange(view)).commands;
    await directory.exchange({
      ...view,
      wait: false,
      report: frame(index + 1, {
        requestId: request.requestId,
        commandId: command.id,
        buildRevision: build.revision,
        sourceRevision: build.sourceRevision,
      }),
      acknowledgements: [
        {
          id: command.id,
          result: {
            buildRevision: build.revision,
            sourceRevision: build.sourceRevision,
          },
        },
      ],
    });
    const result = await pending;
    first ??= { request, build, result };
    const attempts = [...session.receipts.values()].flatMap((receipt) => [
      ...receipt.attempts.values(),
    ]);
    assert.equal(attempts.length, 1);
    assert.ok(attempts.every((attempt) => !Object.hasOwn(attempt.build, 'html')));
    assert.ok(!Object.hasOwn(session.build, 'html'));
    assert.deepEqual(directory.buildLeases(), [build.revision]);
  }
  assert.equal(session.receipts.size, 200);
  directory.detach(view);
  assert.equal(
    [...session.receipts.values()].flatMap((receipt) => [...receipt.attempts.values()]).length,
    0,
  );
  assert.strictEqual(
    await directory.request(session.id, first.request, { authoredBuild: first.build }),
    first.result,
  );
  assert.equal(session.queue.length, 0);
  const reopened = await directory.attach(session.id, 'new-renderer');
  assert.equal(reopened.buildRevision, 'build-199');
  assert.equal(reopened.checkpoint.time, 200);
});

test('collection preserves current, candidate, replacement, delayed author, saved card and job inputs', async (t) => {
  const data = await mkdtemp(join(tmpdir(), 'story-cache-leases-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  const revisions = [
    'current',
    'candidate',
    'replacement',
    'delayed',
    'saved-card',
    'queued-build',
    'obsolete',
  ];
  const builds = new Map();
  for (const revision of revisions) {
    const snapshot = join(data, 'snapshots', revision);
    await mkdir(snapshot, { recursive: true });
    await writeFile(join(snapshot, 'scene.js'), revision);
    const build = {
      revision,
      sourceRevision: revision,
      snapshot,
      html: '<main>' + revision + '</main>',
    };
    builds.set(revision, build);
    await writeJSON(join(data, 'builds', revision + '.json'), build);
  }
  const { directory, session, view } = await displayed(t, builds.get('current'));
  session.nextBuild = buildReference(builds.get('candidate'));
  session.replacement = { build: buildReference(builds.get('replacement')) };
  const pending = directory.request(
    session.id,
    {
      op: 'author',
      requestId: 'uncertain-author',
      buildRevision: 'current',
      stateRevision: 0,
      nextBuildRevision: 'delayed',
      sourceRevision: 'delayed',
      document: {},
    },
    { authoredBuild: builds.get('delayed') },
  );
  const refused = assert.rejects(pending, /deadline/);
  const [command] = (await directory.exchange(view)).commands;
  session.pending.get(command.id).expiresAt = 0;
  directory.expirePending(session);
  await refused;
  assert.ok(
    directory.buildLeases().includes('delayed'),
    'timeout still allows an applied-frame report',
  );
  await writeJSON(join(data, 'sessions', 'saved.json'), { buildRevision: 'saved-card' });
  await writeJSON(join(data, 'snapshots', 'queued-input', '.vstory-input.json'), {
    buildRevision: 'queued-build',
  });
  const dependencies = join(data, 'dependencies', 'queued');
  await mkdir(join(dependencies, 'node_modules'), { recursive: true });
  await writeFile(join(dependencies, 'node_modules', 'package.txt'), 'pinned');
  await symlink(
    join(dependencies, 'node_modules'),
    join(data, 'snapshots', 'queued-input', 'node_modules'),
  );
  await writeFile(join(data, 'projects.json'), 'authored registry');
  const collect = () =>
    collectCache(data, {
      limitMB: 0,
      projects: [],
      sessions: [...directory.sessions.values()],
      snapshotLeases: ['queued-input'],
      buildLeases: directory.buildLeases(),
    });
  const first = await collect();
  assert.ok(first.protectedBytes > 0);
  assert.deepEqual(
    (await readdir(join(data, 'builds'))).sort(),
    revisions
      .filter((r) => r !== 'obsolete')
      .map((r) => r + '.json')
      .sort(),
  );
  assert.equal(await readFile(join(dependencies, 'node_modules', 'package.txt'), 'utf8'), 'pinned');
  assert.equal(await readFile(join(data, 'projects.json'), 'utf8'), 'authored registry');
  // An old attempt remains usable after eviction, then the accepted frame becomes its lease.
  await directory.exchange({
    ...view,
    wait: false,
    report: frame(1, {
      requestId: 'uncertain-author',
      commandId: command.id,
      buildRevision: 'delayed',
      sourceRevision: 'delayed',
    }),
  });
  assert.equal(session.build.revision, 'delayed');
  directory.detach(view);
  await collect();
  assert.deepEqual((await readdir(join(data, 'builds'))).sort(), [
    'candidate.json',
    'delayed.json',
    'queued-build.json',
    'saved-card.json',
  ]);
  const restored = JSON.parse(await readFile(join(data, 'builds', 'delayed.json'), 'utf8'));
  const restart = new SessionDirectory();
  t.after(() => restart.close());
  const loaded = restart.open(restored);
  assert.equal(loaded.build.revision, session.build.revision);
  assert.equal(restored.html, '<main>delayed</main>', 'disk payload survives for view hydration');
  assert.ok(!Object.hasOwn(loaded.build, 'html'));
});
