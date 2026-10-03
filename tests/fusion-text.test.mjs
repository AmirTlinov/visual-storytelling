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
        paragraph: 0,
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
    text: { value, words, glyphs, lines: 1 },
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
  for (const owner of [0, 1])
    assert.equal(
      new Set(routes.filter((r) => r.source === owner).map((r) => r.text.glyph)).size,
      target.text.glyphs.length,
      'Each incoming text must cover the complete destination',
    );
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
