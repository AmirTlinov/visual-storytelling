import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ProjectWatch } from '../plugin/project-watch.mjs';

async function wait(check) {
  const until = Date.now() + 4000;
  while (Date.now() < until) {
    if (check()) return;
    await delay(20);
  }
  throw new Error('Project watcher did not report the edit.');
}
test('watch coalesces edits during preparation and follows the same project moved to another path', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'story-watch-')),
    first = join(directory, 'first'),
    second = join(directory, 'second');
  await mkdir(first);
  await mkdir(second);
  let calls = 0,
    active = 0,
    peak = 0,
    release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const watch = new ProjectWatch(async () => {
    calls++;
    active++;
    peak = Math.max(peak, active);
    if (calls === 1) await blocked;
    active--;
  });
  t.after(async () => {
    release();
    watch.close();
    await rm(directory, { recursive: true, force: true });
  });
  watch.open({ id: 'same-project', path: first });
  await writeFile(join(first, 'scene.js'), 'first');
  await wait(() => calls === 1);
  await writeFile(join(first, 'scene.js'), 'second');
  await delay(500);
  assert.equal(calls, 1);
  release();
  await wait(() => calls >= 2);
  assert.equal(peak, 1);
  watch.open({ id: 'same-project', path: second });
  const before = calls;
  await writeFile(join(second, 'scene.js'), 'moved');
  await wait(() => calls > before);
  await delay(500);
  const settled = calls;
  await writeFile(join(first, 'scene.js'), 'old location');
  await mkdir(join(second, 'dist'));
  await writeFile(join(second, 'dist/output.js'), 'derived');
  await delay(650);
  assert.equal(calls, settled);
});
