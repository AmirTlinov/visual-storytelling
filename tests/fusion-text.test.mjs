import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({
  stdin: {
    contents:
      "export * from './src/ink/fusion/text-routing.ts';export * from './src/ink/fusion/motion.ts';export * from './src/ink/fusion/detail.ts'",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { orderedPairs, textRoutes, inkMotion, inkDetailVisibility } = await import(
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

const pathLength = (path) =>
  path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - path[i][0], p[1] - path[i][1]), 0);
function assertSharedContours(routes, outputs) {
  outputs.forEach((shape, destination) => {
    const incoming = routes.filter((route) => route.destination === destination);
    const supplied = incoming.reduce((sum, route) => sum + pathLength(route.to), 0);
    const wanted = shape.paths.reduce((sum, path) => sum + pathLength(path), 0);
    assert.ok(
      // Resampling slightly shortens curves, especially at a pointed join.
      Math.abs(supplied - wanted) < Math.max(0.001, wanted * 0.02),
      'The result is covered once, without a complete duplicate contour',
    );
    for (const path of shape.paths)
      for (const point of [path[0], path.at(-1)])
        assert.ok(
          incoming.some((r) =>
            r.to.some((p) => Math.hypot(p[0] - point[0], p[1] - point[1]) < 1e-5),
          ),
        );
  });
  assert.ok(routes.every((route) => route.attachment === undefined));
}

test('unchanged handwriting retains short serifs and punctuation throughout travel and reverse seek', () => {
  const shape = block('1.');
  shape.paths[0] = [
    [-3, -18, 1],
    [0, -22, 1],
    [0, 20, 1],
  ];
  shape.text.glyphs[0].paths.push(shape.paths.length);
  shape.paths.push([
    [-3, 20, 1],
    [3, 20, 1],
  ]);
  shape.paths[1] = [
    [14, 20, 1],
    [14.1, 20, 1],
  ];
  const motion = inkMotion(textRoutes([shape], [shape]));
  const details = inkDetailVisibility(motion.patches, true);
  const sources = [{ x: -20, y: 30, scale: 0.8 }];
  const targets = [{ x: 40, y: -20, scale: 1.3, rotation: 0.4 }];
  for (const progress of [0, 0.04, 0.2, 0.5, 0.8, 0.99, 1, 0.5, 0]) {
    const geometry = motion(sources, targets, progress);
    for (const pixel of [0.3, 1, 2])
      assert.ok(details(geometry, progress, pixel).every((values) => values.every((v) => v === 1)));
  }
});

test('original punctuation stays visible while newly generated tiny marks wait for growth', () => {
  const dot = block('.');
  dot.paths[0] = [
    [0, 0, 1],
    [0.1, 0, 1],
  ];
  for (const [inputs, outputs] of [
    [[dot], [dot, dot]],
    [[dot, dot], [dot]],
  ]) {
    const motion = inkMotion(textRoutes(inputs, outputs));
    const details = inkDetailVisibility(motion.patches, true);
    const geometry = motion(
      inputs.map((_, i) => ({ x: i * 50, y: 0 })),
      outputs.map((_, i) => ({ x: i * 50, y: 0 })),
      0.4,
    );
    const opacity = details(geometry, 0.4, 1).flatMap((values) => Array.from(values));
    assert.ok(opacity.includes(1), 'The original dot stays legible');
    if (outputs.length > inputs.length)
      assert.ok(opacity.includes(0), 'Generated tiny marks are still suppressed');
    else
      assert.ok(
        opacity.every((v) => v === 1),
        'Both original marks participate without fading',
      );
  }
});

test('bending and dividing original fine strokes keeps their ink throughout the operation', () => {
  const source = block('1');
  source.paths[0] = [
    [-2, 0, 1],
    [2, 0, 1],
  ];
  for (const paths of [
    [
      [
        [0, -2, 1],
        [0, 2, 1],
      ],
    ],
    [
      [
        [-2, 1, 1],
        [-1, 1, 1],
      ],
      [
        [1, -1, 1],
        [2, -1, 1],
      ],
    ],
  ]) {
    const target = block('1');
    target.paths = paths;
    target.text.glyphs[0].paths = paths.map((_, i) => i);
    const motion = inkMotion(textRoutes([source], [target]));
    const details = inkDetailVisibility(motion.patches, true);
    const geometry = motion([{ x: 0, y: 0 }], [{ x: 0, y: 0 }], 0.4);
    assert.ok(details(geometry, 0.4, 1).every((values) => values.every((v) => v === 1)));
  }
});

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
  const routes = textRoutes([first, second], [target]);
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
    const frames = sample(sources, [{ x: 0, y: 0 }], progress);
    assert.ok(frames.every((frame) => frame.length > 0 && frame.every(Number.isFinite)));
  }
  const final = sample(sources, [{ x: 0, y: 0 }], 1).flatMap((frame) => Array.from(frame));
  assert.ok(final.every(Number.isFinite));
});

test('a new word shares its letters between both sources without duplicate copies', () => {
  const first = block('свет'),
    second = block('тень'),
    target = block('объём');
  const routes = textRoutes([first, second], [target]);
  assert.equal(routes.length, first.paths.length + second.paths.length);
  assert.equal(new Set(routes.map((r) => r.text.glyph)).size, target.text.glyphs.length);
  for (const owner of [0, 1]) {
    const incoming = routes.filter((r) => r.source === owner);
    assert.ok(incoming.length > 0);
    assert.ok(new Set(incoming.map((r) => r.text.glyph)).size < target.text.glyphs.length);
  }
});

test('one plus two builds disjoint portions of three and reaches one connected contour', () => {
  const one = block('1'),
    two = block('2'),
    three = block('3');
  one.paths = [
    [
      [-3, -14, 1],
      [0, -20, 1],
      [0, 20, 1],
    ],
    [
      [-5, 20, 1],
      [5, 20, 1],
    ],
  ];
  one.text.glyphs[0].paths = [0, 1];
  two.paths = [
    [
      [-5, -15, 1],
      [8, -20, 1],
      [12, -10, 1],
      [-5, 20, 1],
      [10, 20, 1],
    ],
  ];
  three.paths = [
    Array.from({ length: 81 }, (_, i) => {
      const y = i / 2 - 20;
      return [10 * Math.sin((Math.PI * (i % 40)) / 40), y, 1];
    }),
  ];
  const routes = textRoutes([one, two], [three]);
  assertSharedContours(routes, [three]);
  const wanted = pathLength(three.paths[0]);
  assert.ok(
    routes.every((r) => pathLength(r.to) < wanted * 0.8),
    'No incoming digit produces a whole three underneath the other digit',
  );
  const motion = inkMotion(routes),
    details = inkDetailVisibility(motion.patches, true);
  const sources = [
      { x: -40, y: 0 },
      { x: 40, y: 0 },
    ],
    targets = [{ x: 0, y: 0 }];
  const middle = motion(sources, targets, 0.4).map((v) => v.slice());
  assert.ok(
    details(middle, 0.4, 1).every((v) => v.every((a) => a === 1)),
    'The foot is real source ink',
  );
  const collected = motion(sources, targets, 0.7);
  const length = collected.reduce((sum, data) => {
    for (let i = 0; i < data.length; i += 6)
      sum += Math.hypot(data[i + 2] - data[i], data[i + 3] - data[i + 1]);
    return sum;
  }, 0);
  const supplied = routes.reduce((sum, route) => sum + pathLength(route.to), 0);
  assert.ok(Math.abs(length - supplied) < 1e-4, 'Collection leaves no extra coiled digit');
  motion(sources, targets, 1);
  assert.deepEqual(motion(sources, targets, 0.4), middle);
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
  const routes = textRoutes([first, second], [target]);
  const collapsed = (path) => path.every((p) => p[0] === path[0][0] && p[1] === path[0][1]);
  assert.ok(routes.some((route) => collapsed(route.from) && !collapsed(route.to)));
  assert.ok(routes.every((route) => !(collapsed(route.from) && collapsed(route.to))));
  assertSharedContours(routes, [target]);
});

test('preserved words have their original supplier instead of echoes from the other sentence', () => {
  const first = block('Свет раскрывает форму'),
    second = block('Тень придаёт глубину'),
    target = block('Свет и тень создают объём');
  const routes = textRoutes([first, second], [target]);
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
  const sample = inkMotion(textRoutes([shape, shape], [shape]));
  const sources = [
    { x: -100, y: 0 },
    { x: 100, y: 0 },
  ];
  let previous = sample(sources, [{ x: 0, y: 0 }], 0).map((v) => v.slice());
  let largestStep = 0;
  for (let frame = 1; frame <= 120; frame++) {
    const current = sample(sources, [{ x: 0, y: 0 }], frame / 120);
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

test('one word splits into three independently posed destinations and seeks back exactly', () => {
  const input = block('2');
  const outputs = [block('2'), block('2'), block('2')];
  const routes = textRoutes([input], outputs);
  assert.deepEqual([...new Set(routes.map((route) => route.destination))], [0, 1, 2]);
  const sample = inkMotion(routes);
  const sources = [{ x: 17, y: -12, rotation: 0.15 }];
  const targets = [
    { x: -130, y: -30, scale: 0.8 },
    { x: 0, y: 45, rotation: Math.PI / 2 },
    { x: 150, y: -25, scale: 1.4 },
  ];
  const middle = sample(sources, targets, 0.42).map((buffer) => buffer.slice());
  const final = sample(sources, targets, 1);
  for (const route of routes.filter((route) => route.attachment === undefined)) {
    const pose = targets[route.destination];
    const angle = pose.rotation ?? 0,
      scale = pose.scale ?? 1;
    for (const point of [route.to[0], route.to.at(-1)]) {
      const x = pose.x + (point[0] * Math.cos(angle) - point[1] * Math.sin(angle)) * scale;
      const y = pose.y + (point[0] * Math.sin(angle) + point[1] * Math.cos(angle)) * scale;
      assert.ok(
        final.some((buffer) =>
          Array.from({ length: buffer.length / 6 }, (_, i) => i * 6).some((i) =>
            [0, 2].some((end) => Math.hypot(buffer[i + end] - x, buffer[i + end + 1] - y) < 1e-4),
          ),
        ),
        `Destination ${route.destination} must reach its own pose`,
      );
    }
  }
  assert.deepEqual(sample(sources, targets, 0.42), middle);
  assert.throws(() => sample(sources, targets.slice(0, 2), 0.5), /shape counts/);
});

test('many text shapes share target contours once and keep the occurrence order of repeated words', () => {
  const inputs = [block('свет'), block('свет'), block('тень')];
  const outputs = [block('свет'), block('свет и тень')];
  const routes = textRoutes(inputs, outputs);
  assertSharedContours(routes, outputs);
  assert.ok(routes.filter((route) => route.text.word === 0).every((route) => route.source === 0));
  assert.ok(routes.filter((route) => route.text.word === 1).every((route) => route.source === 1));
  assert.ok(routes.filter((route) => route.text.word === 3).every((route) => route.source === 2));
  const sample = inkMotion(routes);
  const sources = [
    { x: -180, y: 0 },
    { x: 0, y: 0 },
    { x: 180, y: 0 },
  ];
  const targets = [
    { x: 0, y: -80 },
    { x: 0, y: 80 },
  ];
  for (const progress of [0, 0.25, 0.6, 1])
    assert.ok(
      sample(sources, targets, progress).every(
        (buffer) => buffer.length && buffer.every(Number.isFinite),
      ),
    );
});
