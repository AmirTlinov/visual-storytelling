import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../tools/scene.mjs', import.meta.url));
const examples = async (...args) =>
  JSON.parse(
    (await promisify(execFile)(process.execPath, [cli, 'examples', ...args, '--json'])).stdout,
  );

test('the authoring catalog resolves every preview, source and guide and narrows to a useful starting point', async () => {
  const entries = await examples();
  await Promise.all(
    entries.flatMap((entry) =>
      [entry.source, entry.page, entry.preview, ...entry.guides].map((path) => access(path)),
    ),
  );
  const recommended = await examples('--recommended');
  assert.ok(recommended.some((entry) => entry.id === 'explorer-svg'));
  assert.ok(recommended.some((entry) => entry.id === 'explorer-3d'));
  assert.ok(recommended.every((entry) => entry.recommended));
  const [detail] = await examples('explorer-svg');
  assert.ok(detail.create.includes('--example explorer-svg'));
  assert.ok(detail.source.endsWith('/explorer-svg/scene.js'));
});

test('CLI search combines topic and group, handles multiple words and reports no matches', async () => {
  assert.deepEqual(
    (await examples('НейРон', '--group', 'techniques')).map(({ id }) => id),
    ['neuron-morph', 'long-calculation'],
  );
  assert.deepEqual(
    (await examples('3d', 'камера', '--recommended')).map(({ id }) => id),
    ['explorer-3d'],
  );
  assert.deepEqual(await examples('no-such-example'), []);
  await assert.rejects(examples('--group', 'unknown'), /Choose a group/);
});
