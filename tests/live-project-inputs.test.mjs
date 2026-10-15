import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, stat, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createScene } from '../tools/create-scene.mjs';
import { ProjectStore } from '../plugin/projects.mjs';
import { authoredCandidate } from '../plugin/authored-candidate.mjs';
import { prepareLiveProject } from '../plugin/live-project.mjs';
import { collectCache } from '../plugin/cache.mjs';
import { readJSON } from '../tools/storage.mjs';

async function candidateFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'live-captured-inputs-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const data = join(directory, 'data'),
    root = resolve('.plugin-release');
  const created = await createScene(join(directory, 'project'), {
    root,
    document: { recipe: 'division', inputs: { count: 17, divisor: 4 }, chapters: [] },
  });
  const projects = new ProjectStore(data),
    project = await projects.register(created.directory);
  const proposal = await projects.stageEdit({
    projectId: project.id,
    sourceRevision: project.sourceRevision,
    requestId: randomUUID(),
    operations: [{ op: 'set-inputs', modelId: 'division', values: { count: 19 } }],
  });
  const candidate = await authoredCandidate(data, project, proposal);
  return {
    data,
    root,
    project,
    candidate,
    preparedProject: {
      ...project,
      path: candidate.snapshot,
      sourceRevision: candidate.input.sourceRevision,
    },
  };
}

test('a verified authored candidate becomes the live build input without a second snapshot copy', async (t) => {
  const { data, root, project, candidate, preparedProject } = await candidateFixture(t);
  const captured = await readdir(join(data, 'snapshots'));
  const built = await prepareLiveProject(data, preparedProject, root, candidate.input);
  assert.equal(built.snapshot, candidate.snapshot);
  assert.deepEqual(await readdir(join(data, 'snapshots')), captured);
  assert.equal(built.live.document.models[0].inputs.count, 19);
  const receipt = await readJSON(join(candidate.snapshot, '.vstory-input.json'));
  assert.equal(receipt.buildRevision, built.revision);
  assert.equal(receipt.revision, candidate.input.sourceRevision);
  const saved = await readFile(join(candidate.snapshot, 'story.json'), 'utf8');
  await writeFile(join(project.path, 'story.json'), saved.replace('19', '23'));
  assert.equal(
    await readFile(join(candidate.snapshot, 'story.json'), 'utf8'),
    saved,
    'working and captured inputs do not share a mutable inode',
  );
  await collectCache(data, {
    limitMB: 0,
    projects: [{ buildRevision: built.revision }],
    sessions: [],
    snapshotLeases: [],
  });
  assert.equal(
    await readFile(join(candidate.snapshot, 'story.json'), 'utf8'),
    saved,
    'the published build leases the captured candidate',
  );
});

test('captured input ownership and bytes are checked even when a changed file retains its timestamp', async (t) => {
  const { data, root, candidate, preparedProject } = await candidateFixture(t);
  await assert.rejects(
    prepareLiveProject(data, preparedProject, root, {
      ...candidate.input,
      projectId: randomUUID(),
    }),
    /must belong/,
  );
  await assert.rejects(
    prepareLiveProject(data, preparedProject, root, {
      ...candidate.input,
      inputSnapshot: '../../project',
    }),
    /must belong/,
  );
  const file = join(candidate.snapshot, 'story.json'),
    previous = await stat(file);
  await writeFile(file, (await readFile(file, 'utf8')).replace('19', '20'));
  await utimes(file, previous.atime, previous.mtime);
  await assert.rejects(prepareLiveProject(data, preparedProject, root, candidate.input), {
    code: 'snapshot_changed',
  });
  const builds = await readdir(join(data, 'builds')).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  assert.deepEqual(builds, [], 'changed inputs never publish a prepared receipt');
});

test('same-content preparation retains the original immutable build when a later candidate is rejected', async (t) => {
  const { data, root, project, candidate, preparedProject } = await candidateFixture(t);
  const first = await prepareLiveProject(data, preparedProject, root, candidate.input);
  const originalReceipt = await readFile(join(data, 'builds', first.revision + '.json'), 'utf8');
  const projects = new ProjectStore(data);
  await projects.start();
  const proposal = await projects.stageEdit({
    projectId: project.id,
    sourceRevision: project.sourceRevision,
    requestId: randomUUID(),
    operations: [{ op: 'set-inputs', modelId: 'division', values: { count: 19 } }],
  });
  const second = await authoredCandidate(data, project, proposal);
  const reused = await prepareLiveProject(
    data,
    { ...preparedProject, path: second.snapshot },
    root,
    second.input,
  );
  assert.equal(reused.revision, first.revision);
  assert.equal(reused.snapshot, first.snapshot, 'the existing build keeps its original inputs');
  await rm(second.snapshot, { recursive: true, force: true });
  assert.equal(
    await readFile(join(data, 'builds', first.revision + '.json'), 'utf8'),
    originalReceipt,
    'a rejected later candidate never replaces the accepted receipt',
  );
  assert.equal(
    JSON.parse(await readFile(join(reused.snapshot, 'story.json'), 'utf8')).models[0].inputs.count,
    19,
  );
  await collectCache(data, {
    limitMB: 0,
    projects: [{ buildRevision: first.revision }],
    sessions: [],
    snapshotLeases: [],
  });
  assert.equal(
    JSON.parse(await readFile(join(reused.snapshot, 'story.json'), 'utf8')).models[0].inputs.count,
    19,
  );
});
