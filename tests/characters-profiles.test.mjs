import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  characterSources,
  characterProfile,
  paintCharacter,
} from '../tools/characters/profiles.mjs';
import { compileCharacterPack } from '../tools/characters/compile.mjs';
import { runCharacters } from '../tools/characters/cli.mjs';

const template = fileURLToPath(new URL('../src/assets/characters/chibi', import.meta.url));

test('cast variations reuse drawings and preserve inherited palette colours', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'story-cast-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'cast.json');
  await writeFile(
    file,
    JSON.stringify([
      { id: 'scientist', from: 'mira', outfit: 'lab-coat', palette: { '#ffdac3': '#d4a077' } },
      { id: 'engineer', from: 'tesla', outfit: 'work-apron' },
    ]),
  );
  const sources = await characterSources(template, [file]);
  const { profile } = await characterProfile(sources[0]);
  assert.equal(profile.palette['#ffdac3'], '#d4a077');
  assert.equal(profile.palette['#242b38'], '#493734');
  const pack = await compileCharacterPack(template, sources);
  assert.deepEqual(pack.skins, ['scientist', 'engineer']);
  assert.equal(pack.viewSkins.scientist.back, 'scientist@back');
  assert.ok(pack.rig.reach.left.max > 0);
  await writeFile(file, JSON.stringify([{ from: 'mira' }]));
  await assert.rejects(characterSources(template, [file]), /lowercase id/);
  assert.equal(
    paintCharacter('<path fill="#AABBCC" stroke="#112233"/>', {
      '#aabbcc': '#112233',
      '#112233': '#abcdef',
    }),
    '<path fill="#112233" stroke="#abcdef"/>',
    'colour substitution must neither cascade nor depend on case',
  );
});

test('rebuilding editable artwork refreshes its sheet with the same wardrobe and palette as the pack', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'story-skin-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const artwork = join(dir, 'author'),
    output = join(dir, 'pack.json');
  await runCharacters(['new', 'author', '--from', 'mira', '--out', artwork]);
  const previous = await readFile(join(artwork, 'sheet.svg'), 'utf8');
  const file = join(artwork, 'character.json');
  const profile = JSON.parse(await readFile(file, 'utf8'));
  profile.outfit = 'lab-coat';
  profile.palette = { ...profile.palette, '#ffdac3': '#aabbcc' };
  await writeFile(file, JSON.stringify(profile));
  await runCharacters(['build', artwork, '--out', output]);
  const sheet = await readFile(join(artwork, 'sheet.svg'), 'utf8');
  assert.notEqual(sheet, previous);
  assert.match(sheet, /body \(back\)/);
  const images = [...sheet.matchAll(/base64,([^"]+)/g)].map((m) =>
    Buffer.from(m[1], 'base64').toString(),
  );
  assert.ok(
    images.some((svg) => svg.includes('#aabbcc')),
    'edited skin colour appears in the sheet',
  );
  const coat = await readFile(join(template, 'wardrobe/lab-coat/body.svg'), 'utf8');
  assert.ok(
    images.includes(paintCharacter(coat, profile.palette)),
    'sheet uses the selected wardrobe',
  );
  const pack = await readFile(output);
  profile.parts.body.file = 'missing.svg';
  delete profile.outfit;
  await writeFile(file, JSON.stringify(profile));
  await assert.rejects(runCharacters(['build', artwork, '--out', output]), /missing.svg/);
  assert.deepEqual(await readFile(output), pack);
  assert.equal(await readFile(join(artwork, 'sheet.svg'), 'utf8'), sheet);
});
