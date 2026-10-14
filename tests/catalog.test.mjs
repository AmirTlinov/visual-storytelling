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

test('the public catalog exposes maintained exemplars with source, preview and guides', async () => {
  const entries = await examples();
  assert.deepEqual(
    entries.map(({ id }) => id),
    ['gpt-model', 'spatial-order', 'cube-section'],
  );
  await Promise.all(
    entries.flatMap((entry) =>
      [entry.source, entry.page, entry.preview, ...entry.guides]
        .filter(Boolean)
        .map((path) => access(path)),
    ),
  );
  const recommended = await examples('--recommended');
  assert.deepEqual(
    recommended.map(({ id }) => id),
    ['gpt-model'],
  );
  const [detail] = await examples('gpt-model');
  assert.ok(detail.create.includes('--example gpt-model'));
  assert.ok(detail.source.endsWith('/gpt-model/scene.js'));
});

test('CLI search combines topic and group, handles multiple words and reports no matches', async () => {
  assert.deepEqual(
    (await examples('ТоКеН', '--group', 'explanations')).map(({ id }) => id),
    ['gpt-model'],
  );
  assert.deepEqual(
    (await examples('GPT', 'слово', '--recommended')).map(({ id }) => id),
    ['gpt-model'],
  );
  assert.deepEqual(await examples('GPT', '--group', 'techniques'), []);
  assert.deepEqual(await examples('no-such-example'), []);
  await assert.rejects(examples('--group', 'unknown'), /Choose a group/);
});
