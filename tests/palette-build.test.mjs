import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildStyles, materializePaletteSVG } from '../tools/build-palette.mjs';
import { buildPage } from '../tools/build-pages.mjs';

const images = (css) =>
  [...css.matchAll(/url\("data:image\/svg\+xml,([^"\n]+)"\)/g)].map((match) =>
    decodeURIComponent(match[1]),
  );

test('packaged scrollbar images follow a single palette edit without changing their geometry', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'story-palette-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'source');
  await mkdir(source);
  const [palette, controls] = await Promise.all([
    readFile('src/styles/ink.css', 'utf8'),
    readFile('src/styles/sketch-controls.css', 'utf8'),
  ]);
  const changed = palette.replace(
    /--ve-default-ink: light-dark\([^;]+;/,
    '--ve-default-ink: light-dark(#123456, #abcdef);',
  );
  await writeFile(join(source, 'ink.css'), changed);
  await writeFile(join(source, 'sketch-controls.css'), controls);
  const output = join(directory, 'styles');
  await buildStyles(source, output);
  const emitted = await readFile(join(output, 'sketch-controls.css'), 'utf8');
  const originalImages = images(controls);
  const builtImages = images(emitted);
  assert.equal(builtImages.length, originalImages.length);
  assert.deepEqual(
    builtImages.map((image) => image.replace(/<style>.*?<\/style>/g, '')),
    originalImages.map((image) => image.replace(/<style>.*?<\/style>/g, '')),
  );
  const thumb = builtImages.find((image) => image.includes('path{fill:'));
  assert.match(
    thumb,
    /path\{fill:#123456\}@media\(prefers-color-scheme:dark\)\{path\{fill:#abcdef\}\}/,
  );
  const pencil = changed.match(/--ve-pencil: light-dark\(([^,]+),\s*([^\)]+)\)/);
  const track = builtImages.find((image) => image.includes('path{stroke:'));
  assert.ok(track.includes(`stroke:${pencil[1]}`));
  assert.ok(track.includes(`stroke:${pencil[2]}`));
  assert.ok(builtImages.every((image) => !image.includes('var(--ve-')));
  assert.equal(await readFile(join(source, 'sketch-controls.css'), 'utf8'), controls);
  assert.equal(await readFile(join(output, 'ink.css'), 'utf8'), changed);
});

test('an unresolved embedded pigment fails the build instead of silently painting a default', () => {
  const css = `url("data:image/svg+xml,${encodeURIComponent('<svg><style>path{fill:var(--ve-missing)}</style></svg>')}")`;
  assert.throws(() => materializePaletteSVG(css, ''), /--ve-missing/);
});

test('source-alias gallery builds materialize the same SVG palette as packaged CSS', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'story-palette-source-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const entry = join(directory, 'index.html');
  await writeFile(
    entry,
    '<!doctype html><html><head></head><body><script type="module">import "@visual-storytelling/core/style.css";</script></body></html>',
  );
  const output = join(directory, 'output');
  await buildPage(entry, output, { sourcePackage: true });
  const built = images(await readFile(join(output, 'index.css'), 'utf8'));
  const expected = images(
    materializePaletteSVG(
      await readFile('src/styles/sketch-controls.css', 'utf8'),
      await readFile('src/styles/ink.css', 'utf8'),
    ),
  ).filter((svg) => svg.includes('prefers-color-scheme:dark'));
  assert.equal(expected.length, 2);
  assert.ok(built.every((svg) => !svg.includes('var(--ve-')));
  for (const svg of expected) assert.ok(built.includes(svg));
});
