import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({
  stdin: {
    contents:
      "export * from './src/ink/fusion/text-routing.ts';export * from './src/ink/fusion/motion.ts'",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { orderedPairs, textRoutes, inkMotion } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

function block(value) {
  const words = [],
    glyphs = [],
    paths = [];
  let x = 0;
  for (const [word, text] of value.split(' ').entries()) {
    const indices = [];
    for (const char of text) {
      indices.push(glyphs.length);
      glyphs.push({
        value: char,
        word,
        line: 0,
        center: [x, 0],
        size: 100,
        paths: [paths.length],
      });
      paths.push([
        [x - 3, -8, 1],
        [x + 3, 8, 1],
      ]);
      x += 14;
    }
    words.push({ value: text, glyphs: indices });
    x += 10;
  }
  return {
    width: x,
    height: 20,
    bounds: { width: x, height: 20 },
    paths,
    text: { words, glyphs },
  };
}

test('word alignment retains exact anchors and reading order through replacements', () => {
  const source = ['свет', 'раскрывает', 'форму', 'тень', 'даёт', 'глубину'];
  const target = ['свет', 'и', 'тень', 'создают', 'объём'];
  const pairs = orderedPairs(source, target);
  assert.ok(pairs.some(([a, b]) => a === 0 && b === 0));
  assert.ok(pairs.some(([a, b]) => a === 3 && b === 2));
  assert.equal(new Set(pairs.map(([i]) => i)).size, source.length);
  assert.equal(new Set(pairs.map(([, i]) => i)).size, target.length);
  pairs.forEach(([a, b], i) => {
    if (i) {
      assert.ok(a >= pairs[i - 1][0]);
      assert.ok(b >= pairs[i - 1][1]);
    }
  });
});

test('inserting a word preserves the complete strokes of unchanged words', () => {
  const first = block('свет'),
    second = block('тень'),
    target = block('свет и тень');
  const routes = textRoutes(first, second, target);
  assert.equal(new Set(routes.map((r) => r.text.glyph)).size, target.text.glyphs.length);
  for (const [owner, shape] of [first, second].entries())
    for (const glyph of shape.text.glyphs) {
      const original = shape.paths[glyph.paths[0]];
      assert.ok(
        routes.some(
          (r) =>
            r.source === owner &&
            r.text.same &&
            r.from.some((p) => Math.hypot(p[0] - original[0][0], p[1] - original[0][1]) < 1e-5) &&
            r.from.some((p) => Math.hypot(p[0] - original[1][0], p[1] - original[1][1]) < 1e-5),
        ),
      );
    }
  const sample = inkMotion(routes),
    sources = [
      { x: 0, y: -50 },
      { x: 0, y: 50 },
    ];
  for (const progress of [0, 0.2, 0.5, 0.8, 1]) {
    const frames = sample(sources, { x: 0, y: 0 }, progress);
    assert.ok(frames.every((frame) => frame.length > 0 && frame.every(Number.isFinite)));
  }
  const final = sample(sources, { x: 0, y: 0 }, 1).flatMap((frame) => Array.from(frame));
  assert.ok(final.every(Number.isFinite));
});

test('a new word shares its letters between both sources without duplicate copies', () => {
  const first = block('свет'),
    second = block('тень'),
    target = block('объём');
  const routes = textRoutes(first, second, target);
  assert.equal(routes.length, first.paths.length + second.paths.length);
  assert.equal(new Set(routes.map((r) => r.text.glyph)).size, target.text.glyphs.length);
  for (const owner of [0, 1]) {
    const incoming = routes.filter((r) => r.source === owner);
    assert.ok(incoming.length > 0);
    assert.ok(new Set(incoming.map((r) => r.text.glyph)).size < target.text.glyphs.length);
  }
});

test('new letters have no travelling seeds that supply neither original nor final ink', () => {
  const first = block('а'),
    second = block('б'),
    target = block('а в б');
  // A letter with several strokes used to spawn one seed per stroke, even when
  // the new letter only needed a single contour. The leftovers became specks.
  for (const shape of [first, target]) {
    const glyph = shape.text.glyphs[0];
    glyph.paths.push(shape.paths.length);
    shape.paths.push([
      [0, -8, 1],
      [0, 8, 1],
    ]);
  }
  const routes = textRoutes(first, second, target);
  const collapsed = (path) => path.every((p) => p[0] === path[0][0] && p[1] === path[0][1]);
  assert.ok(routes.some((route) => collapsed(route.from) && !collapsed(route.to)));
  assert.ok(routes.every((route) => !(collapsed(route.from) && collapsed(route.to))));
  for (let path = 0; path < target.paths.length; path++)
    assert.equal(
      routes.filter((route) => route.target === path && route.attachment === undefined).length,
      1,
    );
});

test('preserved words have their original supplier instead of echoes from the other sentence', () => {
  const first = block('Свет раскрывает форму'),
    second = block('Тень придаёт глубину'),
    target = block('Свет и тень создают объём');
  const routes = textRoutes(first, second, target);
  for (const [word, owner, originWord] of [
    [0, 0, 0],
    [2, 1, 3],
  ]) {
    const incoming = routes.filter((r) => r.text.word === word);
    assert.ok(incoming.length > 0);
    assert.ok(incoming.every((r) => r.source === owner && r.text.originWord === originWord));
  }
  const inserted = routes.filter((r) => r.text.word === 1);
  assert.ok(inserted.length > 0);
  assert.ok(
    inserted.every((r) =>
      r.from.every((p) => Math.hypot(p[0] - r.from[0][0], p[1] - r.from[0][1]) < 1e-5),
    ),
    'The inserted conjunction grows from points instead of compressing a whole source word',
  );
  assert.equal(
    new Set(routes.map((r) => r.text.origin)).size,
    first.text.glyphs.length + second.text.glyphs.length,
  );
  assert.equal(new Set(routes.map((r) => r.text.glyph)).size, target.text.glyphs.length);
});

test('coalescing letters does not concentrate their travel in the opening frames', () => {
  const shape = block('о');
  const sample = inkMotion(textRoutes(shape, shape, shape));
  const sources = [
    { x: -100, y: 0 },
    { x: 100, y: 0 },
  ];
  let previous = sample(sources, { x: 0, y: 0 }, 0).map((v) => v.slice());
  let largestStep = 0;
  for (let frame = 1; frame <= 120; frame++) {
    const current = sample(sources, { x: 0, y: 0 }, frame / 120);
    for (let source = 0; source < 2; source++)
      for (let i = 0; i < current[source].length; i += 6)
        largestStep = Math.max(
          largestStep,
          Math.hypot(
            current[source][i] - previous[source][i],
            current[source][i + 1] - previous[source][i + 1],
          ),
        );
    previous = current.map((v) => v.slice());
  }
  assert.ok(largestStep < 3, `A frame moved a letter by ${largestStep} of its 100-unit journey`);
});
