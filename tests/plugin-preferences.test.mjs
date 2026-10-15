import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Preferences } from '../plugin/preferences.mjs';

test('defaults own only plugin preferences; project voice and unknown saved fields cannot become defaults', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'plugin-preferences-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'preferences.json');
  await writeFile(
    file,
    JSON.stringify({
      projectsDirectory: join(directory, 'authored'),
      language: 'ru',
      cacheLimitMB: 512,
      voice: 'old-selection',
      unowned: true,
    }),
  );
  const preferences = new Preferences(directory);
  const expected = {
    projectsDirectory: join(directory, 'authored'),
    language: 'ru',
    cacheLimitMB: 512,
  };
  assert.deepEqual(await preferences.read(), expected);
  await assert.rejects(
    preferences.update({ voice: 'another-selection' }),
    /Unknown plugin preference/,
  );
  await preferences.update({ language: 'en' });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { ...expected, language: 'en' });
});
