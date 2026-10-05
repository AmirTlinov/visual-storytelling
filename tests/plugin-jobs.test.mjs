import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { JobRunner } from '../plugin/jobs.mjs';

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
  for (const relative of ['tools/prepare.mjs', 'dist/voice/macos', 'runtime/npm/bin/npm-cli.js']) {
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
