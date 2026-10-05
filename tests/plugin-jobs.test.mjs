import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    entry = join(directory, 'worker.mjs');
  await writeFile(
    entry,
    `
process.on('message', (message) => {
  if (message.type === 'cancel') return;
  if (message.input.hold) { setInterval(() => {}, 1000); return; }
  process.send({ type: 'progress', stage: 'Working' });
  setTimeout(() => {
    process.send({ type: 'result', result: { value: message.input.value } }, () => process.disconnect());
  }, 100);
});
`,
  );
  const runner = new JobRunner(directory, entry);
  await runner.start();
  t.after(async () => {
    await runner.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, runner, entry };
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
    runner.enqueue('build', input, requestId),
    runner.enqueue('build', input, requestId),
    runner.enqueue('build', input, alias),
  ]);
  assert.equal(new Set(started.map((job) => job.id)).size, 1);
  const done = await terminal(runner, started[0].id);
  assert.equal(done.status, 'succeeded');
  assert.deepEqual(done.result, { value: 12 });
  const reopened = new JobRunner(directory, entry);
  await reopened.start();
  assert.equal((await reopened.enqueue('build', input, alias)).id, done.id);
  await assert.rejects(reopened.enqueue('build', { ...input, value: 13 }, alias), /requestId/);
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

test('cancellation stops an unresponsive worker, advances the queue, and shutdown persists cancellation', async (t) => {
  const { runner } = await fixture(t);
  const held = await runner.enqueue('build', { hold: true }, randomUUID());
  await wait(() => runner.active?.child);
  const next = await runner.enqueue('build', { value: 4 }, randomUUID());
  assert.equal((await runner.cancel(held.id)).status, 'cancelling');
  assert.equal((await terminal(runner, held.id)).status, 'cancelled');
  assert.equal((await terminal(runner, next.id)).result.value, 4);
  const active = await runner.enqueue('build', { hold: true, value: 5 }, randomUUID());
  await wait(() => runner.active?.child);
  const queued = await runner.enqueue('build', { value: 6 }, randomUUID());
  await runner.close();
  assert.equal(runner.get(active.id).status, 'cancelled');
  assert.equal(runner.get(queued.id).status, 'cancelled');
  assert.equal(runner.busy, false);
});
