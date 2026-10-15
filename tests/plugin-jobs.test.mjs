import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { JobRunner } from '../plugin/jobs.mjs';
import { contentDigest } from '../tools/build-info.mjs';
import { projectFiles } from '../tools/project-files.mjs';

async function wait(check, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await check();
    if (result) return result;
    await delay(10);
  }
  throw new Error('Job did not reach the expected state.');
}
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'story-jobs-')),
    entry = join(directory, 'worker.mjs'),
    toolchainRoot = join(directory, 'release');
  await mkdir(toolchainRoot);
  await writeFile(
    entry,
    `
import { spawn } from 'node:child_process';
process.on('message', (message) => {
  if (message.type === 'cancel') return;
  if (message.input.fail) {
    process.send({ type: 'error', error: 'Preparation failed' }, () => process.disconnect());
    return;
  }
  if (message.input.hold) {
    if (message.input.childFile) spawn(process.execPath, ['-e',
      'process.on("SIGTERM", () => {}); require("node:fs").writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000);',
      message.input.childFile], { stdio: 'ignore' });
    setInterval(() => {}, 1000); return;
  }
  process.send({ type: 'progress', stage: 'Working' });
  setTimeout(() => {
    process.send({ type: 'result', result: { value: message.input.value } }, () => process.disconnect());
  }, 100);
});
`,
  );
  const runner = new JobRunner(directory, entry, undefined, { toolchainRoot });
  await runner.start();
  t.after(async () => {
    await runner.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, runner, entry, toolchainRoot };
}
const terminal = (runner, id) =>
  wait(() => {
    const job = runner.get(id);
    return !['queued', 'running', 'cancelling'].includes(job.status) && job;
  });

test('completed deterministic review reuses verified evidence and rejects changed report or snapshot bytes', async (t) => {
  const { runner, directory } = await fixture(t);
  const snapshot = join(directory, 'snapshots', 'review-input');
  const output = join(await realpath(directory), 'report');
  await mkdir(snapshot, { recursive: true });
  await mkdir(output);
  await writeFile(join(snapshot, 'scene.js'), 'accepted model');
  await mkdir(join(snapshot, 'dist'));
  await writeFile(join(snapshot, 'dist/index.html'), 'accepted drawing');
  for (const name of ['index.html', 'motion.json', 'session.json'])
    await writeFile(join(output, name), 'accepted evidence');
  const input = {
    projectId: 'review-project',
    inputSnapshot: 'review-input',
    sourceRevision: 'revision',
    value: 1,
  };
  const first = await runner.enqueue('review', input, randomUUID());
  await terminal(runner, first.id);
  const stored = runner.jobs.get(first.id);
  stored.result = {
    path: join(output, 'index.html'),
    reportProof: {
      version: 1,
      kind: 'document-checkpoints',
      directory: output,
      digest: await contentDigest(output, ['.']),
      snapshot,
      inputRevision: (await projectFiles(snapshot)).revision,
      outputDigest: await contentDigest(join(snapshot, 'dist'), ['.']),
    },
  };
  await runner.save(stored);
  stored.createdAt = new Date(Date.now() - 20000).toISOString();
  for (let index = 0; index < 31; index++)
    runner.jobs.set('newer-' + index, {
      id: 'newer-' + index,
      projectId: input.projectId,
      kind: 'build',
      status: 'succeeded',
      createdAt: new Date(Date.now() - 10000 + index).toISOString(),
      input: {},
    });
  assert(!runner.snapshotLeases().includes(first.id));
  const repeated = await runner.enqueue('review', input, randomUUID());
  assert.equal(repeated.id, first.id);
  assert.equal(repeated.status, 'succeeded');
  assert(
    runner.snapshotLeases().includes(first.id),
    'The returned proof retains its source links through collection',
  );
  await writeFile(join(snapshot, 'dist/index.html'), 'changed drawing');
  const changedDrawing = await runner.enqueue('review', input, randomUUID());
  assert.notEqual(changedDrawing.id, first.id);
  await terminal(runner, changedDrawing.id);
  await writeFile(join(snapshot, 'dist/index.html'), 'accepted drawing');
  await writeFile(join(output, 'motion.json'), 'changed evidence');
  const changedReport = await runner.enqueue('review', input, randomUUID());
  assert.notEqual(changedReport.id, first.id);
  await terminal(runner, changedReport.id);
  await writeFile(join(output, 'motion.json'), 'accepted evidence');
  await writeFile(join(snapshot, 'scene.js'), 'changed model');
  const changedModel = await runner.enqueue('review', input, randomUUID());
  assert.notEqual(changedModel.id, first.id);
  await terminal(runner, changedModel.id);
  await writeFile(join(snapshot, 'scene.js'), 'accepted model');
  const scenarioInput = { ...input, options: { scenario: 'attempt.json' } };
  const scenario = await runner.enqueue('review', scenarioInput, randomUUID());
  await terminal(runner, scenario.id);
  runner.jobs.get(scenario.id).result = stored.result;
  const nextAttempt = await runner.enqueue('review', scenarioInput, randomUUID());
  assert.notEqual(nextAttempt.id, scenario.id);
  await terminal(runner, nextAttempt.id);
});

test('idle maintenance coalesces requests and fences source capture plus direct worker enqueues', async (t) => {
  const { runner } = await fixture(t);
  let releaseMaintenance;
  const gate = new Promise((resolve) => {
    releaseMaintenance = resolve;
  });
  t.after(() => releaseMaintenance());
  let runs = 0,
    captured = false;
  const work = async () => {
    assert.equal(runner.busy, false);
    runs++;
    await gate;
    assert.equal(runner.busy, false, 'new worker cannot start during collection');
  };
  const first = await runner.enqueue('build', { value: 1 }, randomUUID());
  for (let i = 0; i < 20; i++) runner.requestMaintenance(work);
  assert.equal(runs, 0, 'a running worker owns its staging files');
  await terminal(runner, first.id);
  await wait(() => runs === 1);
  const capture = runner.preserveInputs(() => {
    captured = true;
  });
  const next = runner.enqueue('migrate', { value: 2 }, randomUUID());
  await delay(20);
  assert.equal(captured, false);
  assert.equal(runner.jobs.size, 1);
  releaseMaintenance();
  await capture;
  const queued = await next;
  assert.equal((await terminal(runner, queued.id)).result.value, 2);
  await wait(() => runs === 2 && !runner.maintenanceRun);
});

test('maintenance rechecks idle after waiting for an input capture and a direct enqueue', async (t) => {
  const { runner } = await fixture(t);
  let releaseCapture;
  const gate = new Promise((resolve) => {
    releaseCapture = resolve;
  });
  t.after(() => releaseCapture());
  const capture = runner.preserveInputs(() => gate);
  let collected = false;
  runner.requestMaintenance(async () => {
    assert.equal(runner.busy, false);
    collected = true;
  });
  const job = await runner.enqueue('review', { value: 3 }, randomUUID());
  releaseCapture();
  await capture;
  await delay(20);
  assert.equal(collected, false);
  assert.equal((await terminal(runner, job.id)).status, 'succeeded');
  await wait(() => collected);
});

test('concurrent repeated preparation shares one worker and persists every request identity', async (t) => {
  const { runner, directory, entry } = await fixture(t),
    requestId = randomUUID(),
    alias = randomUUID();
  const input = { projectId: 'project', value: 12 };
  const started = await Promise.all([
    runner.enqueue('review', input, requestId),
    runner.enqueue('review', input, requestId),
    runner.enqueue('review', input, alias),
  ]);
  assert.equal(new Set(started.map((job) => job.id)).size, 1);
  const done = await terminal(runner, started[0].id);
  assert.equal(done.status, 'succeeded');
  assert.deepEqual(done.result, { value: 12 });
  assert.ok(
    runner.snapshotLeases().includes(done.id),
    'recent review evidence retains its source files',
  );
  const reopened = new JobRunner(directory, entry);
  await reopened.start();
  assert.equal((await reopened.enqueue('review', input, alias)).id, done.id);
  assert.ok(reopened.snapshotLeases().includes(done.id));
  await assert.rejects(reopened.enqueue('review', { ...input, value: 13 }, alias), /requestId/);
  await reopened.close();
});

test('new working builds coalesce while explicit releases keep their selected input; inspect waits are bounded', async (t) => {
  const { runner } = await fixture(t);
  const old = await runner.enqueue(
    'build',
    { projectId: 'p', sourceRevision: 'a', inputSnapshot: 'a', hold: true },
    randomUUID(),
  );
  await wait(() => runner.get(old.id).status === 'running');
  const released = await runner.enqueue(
    'produce',
    { projectId: 'p', sourceRevision: 'a', inputSnapshot: 'a', value: 'selected' },
    randomUUID(),
  );
  const middle = await runner.enqueue(
    'build',
    { projectId: 'p', sourceRevision: 'b', inputSnapshot: 'b', value: 'middle' },
    randomUUID(),
  );
  const latest = await runner.enqueue(
    'build',
    { projectId: 'p', sourceRevision: 'c', inputSnapshot: 'c', value: 'latest' },
    randomUUID(),
  );
  assert.equal(runner.get(middle.id).status, 'cancelled');
  assert.equal(runner.get(middle.id).supersededBy, latest.id);
  const start = performance.now();
  assert.equal((await runner.wait(released.id, { timeout: 20 })).status, 'queued');
  assert.ok(performance.now() - start < 200);
  assert.equal((await runner.wait(released.id)).result.value, 'selected');
  assert.equal((await runner.wait(latest.id)).result.value, 'latest');
  assert.equal(runner.get(old.id).status, 'cancelled');
});

test('a worker that exits immediately or a failed initial save cannot strand the queue', async (t) => {
  const { runner } = await fixture(t),
    original = runner.save.bind(runner),
    entry = runner.entry;
  runner.save = async () => {
    throw new Error('disk unavailable');
  };
  await assert.rejects(runner.enqueue('build', { value: 1 }, randomUUID()), /disk unavailable/);
  assert.equal(runner.busy, false);
  assert.equal(runner.jobs.size, 0);
  runner.save = async (job) => {
    if (job.status === 'running') await delay(100);
    return original(job);
  };
  runner.entry = '/missing-story-worker.mjs';
  const failed = await runner.enqueue('build', { value: 2 }, randomUUID());
  assert.equal((await terminal(runner, failed.id)).status, 'failed');
  await wait(() => !runner.busy);
  runner.entry = entry;
  const next = await runner.enqueue('build', { value: 3 }, randomUUID());
  assert.equal((await terminal(runner, next.id)).result.value, 3);
});

test('retry verifies the recorded worker, toolchain and bundled runtime across restart', async (t) => {
  const { runner, directory, entry, toolchainRoot } = await fixture(t);
  const job = await runner.enqueue('produce', { fail: true }, randomUUID());
  assert.equal((await terminal(runner, job.id)).status, 'failed');
  assert.match(job.toolchain.digest, /^[a-f0-9]{64}$/);
  assert.equal(job.toolchain.node, process.version);
  await runner.close();
  const restart = async () => {
    const next = new JobRunner(directory, entry, undefined, { toolchainRoot });
    await next.start();
    t.after(() => next.close());
    return next;
  };
  const same = await restart();
  assert.deepEqual(await same.toolchain(), job.toolchain);
  const retried = await same.retry(job.id, randomUUID());
  assert.notEqual(retried.id, job.id);
  assert.equal((await terminal(same, retried.id)).status, 'failed');
  await same.close();
  for (const relative of [
    'tools/prepare.mjs',
    'tools/voice/adapter.mjs',
    'runtime/npm/bin/npm-cli.js',
  ]) {
    const file = join(toolchainRoot, relative);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, 'updated toolchain');
    const changed = await restart();
    await assert.rejects(changed.retry(job.id, randomUUID()), {
      code: 'toolchain_changed',
      action: 'story_produce',
    });
    assert.equal(
      changed.jobs.size,
      2,
      'a changed toolchain never silently creates a replacement job',
    );
    await changed.close();
    await rm(file);
  }
  await writeFile(entry, (await readFile(entry, 'utf8')) + '\n// new worker\n');
  const workerChanged = await restart();
  await assert.rejects(workerChanged.retry(job.id, randomUUID()), { code: 'toolchain_changed' });
});

test('cancellation stops an unresponsive worker, advances the queue, and shutdown persists cancellation', async (t) => {
  const { runner, directory } = await fixture(t),
    childFile = join(directory, 'child.pid');
  let childPid;
  t.after(() => {
    if (childPid) {
      try {
        process.kill(childPid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  });
  const held = await runner.enqueue('build', { hold: true, childFile }, randomUUID());
  childPid = await wait(() => readFile(childFile, 'utf8').then(Number, () => undefined));
  const next = await runner.enqueue('build', { value: 4 }, randomUUID());
  assert.equal((await runner.cancel(held.id)).status, 'cancelling');
  assert.equal((await terminal(runner, held.id)).status, 'cancelled');
  assert.throws(
    () => process.kill(childPid, 0),
    { code: 'ESRCH' },
    'cancellation also stops descendants that ignore SIGTERM',
  );
  assert.equal((await terminal(runner, next.id)).result.value, 4);
  const active = await runner.enqueue('build', { hold: true, value: 5 }, randomUUID());
  await wait(() => runner.active?.child);
  const queued = await runner.enqueue('build', { value: 6 }, randomUUID());
  await runner.close();
  assert.equal(runner.get(active.id).status, 'cancelled');
  assert.equal(runner.get(queued.id).status, 'cancelled');
  assert.equal(runner.busy, false);
});
