import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { ProjectWatch } from '../plugin/project-watch.mjs';

async function until(check) {
  const deadline = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Watcher deadline');
    await delay(2);
  }
}
function fixture(t, changed, create) {
  const observers = [];
  const watch = new ProjectWatch(changed, {
    debounce: 5,
    retry: 15,
    watch(path, options, event) {
      create?.();
      const observer = Object.assign(new EventEmitter(), {
        path,
        options,
        event,
        closed: false,
        close() {
          this.closed = true;
        },
      });
      observers.push(observer);
      return observer;
    },
  });
  t.after(() => watch.close());
  const project = { id: 'project', path: '/owned/project' };
  watch.open(project);
  return { watch, observers, project };
}

test('watching starts with a full reconciliation, batches dirty paths and preserves writes during a running callback', async (t) => {
  const changes = [];
  let release;
  const { watch, observers, project } = fixture(t, async (id, change) => {
    assert.equal(id, 'project');
    changes.push(change);
    if (changes.length === 2)
      await new Promise((resolve) => {
        release = resolve;
      });
  });
  await until(() => changes.length === 1);
  assert.deepEqual(changes[0], { full: true, paths: [] });
  watch.open(project);
  assert.equal(observers.length, 1, 'one observer owns a project path');
  observers[0].event('change', 'models/b.ts');
  observers[0].event('change', 'models/a.ts');
  observers[0].event('change', 'dist/ignored.html');
  await until(() => release);
  assert.deepEqual(changes[1], { full: false, paths: ['models/a.ts', 'models/b.ts'] });
  observers[0].event('change', 'assets/next.svg');
  await delay(8);
  assert.equal(changes.length, 2);
  release();
  await until(() => changes.length === 3);
  assert.deepEqual(changes[2], { full: false, paths: ['assets/next.svg'] });
  observers[0].event('rename', 'models');
  observers[0].event('change', undefined);
  await until(() => changes.length === 4);
  assert.deepEqual(changes[3], { full: true, paths: ['models'] });
});

test('observer failure reconciles missed content and reconnects; close cancels pending work', async (t) => {
  const errors = [];
  t.mock.method(console, 'error', (message) => errors.push(message));
  const changes = [];
  const { watch, observers } = fixture(t, async (id, change) => changes.push(change));
  await until(() => changes.length === 1);
  observers[0].emit('error', new Error('observer lost events'));
  assert.equal(observers[0].closed, true);
  await until(() => observers.length === 2 && changes.length >= 3);
  assert(changes.slice(1).every((change) => change.full));
  assert.match(errors.join(' '), /observer lost events/);
  observers[0].event('change', 'stale.ts');
  observers[1].event('change', 'current.ts');
  await until(() => changes.some((change) => change.paths.includes('current.ts')));
  assert(changes.every((change) => !change.paths.includes('stale.ts')));
  const count = changes.length;
  observers[1].event('change', 'pending.ts');
  watch.close();
  await delay(25);
  assert.equal(changes.length, count);
  assert.equal(observers[1].closed, true);
});

test('failed watcher construction and failed reconciliation both retry a full content check', async (t) => {
  t.mock.method(console, 'error', () => {});
  let attempts = 0,
    checks = 0;
  const changes = [];
  const { observers } = fixture(
    t,
    async (id, change) => {
      changes.push(change);
      checks++;
      if (checks === 1) throw new Error('source was temporarily unavailable');
    },
    () => {
      if (++attempts === 1) throw new Error('project path temporarily unavailable');
    },
  );
  await until(() => observers.length === 1 && checks >= 2);
  assert(changes.every((change) => change.full));
});
