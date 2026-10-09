import test from 'node:test';
import assert from 'node:assert/strict';
import { volumeBox, volumeSphere, volumeField } from '../dist/viewport/morph/field.js';
import { fieldSection } from '../dist/viewport/morph/section.js';
import { contourGeometry } from '../dist/ink/pen.js';

test('moving sharp corners stay on their material instead of following marching cells', () => {
  const box = volumeBox([1.15, 1.15, 0.97]),
    field = volumeField([box], [box]);
  for (const angle of [0, Math.PI / 7])
    for (const x of [0, 0.011, 0.029, 0.04, 0.08, 0]) {
      field.update({
        sources: [{ position: [x, 0, 0], rotation: [0, 0, angle] }],
        targets: [{ position: [2, 0, 0] }],
        morph: 0,
        tension: 0,
      });
      const paths = fieldSection(field);
      assert.equal(paths.length, 1);
      assert.equal(paths[0].length, 4, 'A cell-sized bevel is not an authored corner');
      for (const a of [-0.575, 0.575])
        for (const b of [-0.575, 0.575]) {
          const corner = [
            x + a * Math.cos(angle) - b * Math.sin(angle),
            a * Math.sin(angle) + b * Math.cos(angle),
          ];
          assert.ok(paths[0].some((p) => Math.hypot(p[0] - corner[0], p[1] - corner[1]) < 1e-5));
        }
    }
  const sphere = volumeSphere(0.575),
    curved = volumeField([sphere], [sphere]);
  curved.update({ sources: [{}], targets: [{}], morph: 0 });
  const circle = fieldSection(curved)[0];
  assert.ok(circle.length > 16, 'Corner recovery must preserve real curvature');
  for (const p of circle) assert.ok(Math.abs(Math.hypot(...p) - 0.575) < 1e-5);
});

test('an exact shared face is interior while a positive gap remains separate', () => {
  const cube = volumeBox([1, 1, 1]),
    field = volumeField([cube, cube], [volumeBox([2, 1, 1])]);
  const sample = (gap) => {
    field.update({
      sources: [{ position: [-(1 + gap) / 2, 0, 0] }, { position: [(1 + gap) / 2, 0, 0] }],
      targets: [{}],
      morph: 0,
      tension: 0,
    });
    // Binary-exact steps put an entire sampling column on the contact plane x=0.
    field.bounds.min.set(-1.71875, -1.71875, -1);
    field.bounds.max.set(1.71875, 1.71875, 1);
    return fieldSection(field);
  };
  const joined = sample(0);
  assert.equal(joined.length, 1);
  assert.equal(joined[0].length, 4, 'No internal seam or tooth at exact contact');
  for (const [x, y] of joined[0]) {
    assert.ok(Math.abs(Math.abs(x) - 1) < 1e-5);
    assert.ok(Math.abs(Math.abs(y) - 0.5) < 1e-5);
  }
  assert.equal(sample(0.0002).length, 2, 'A real gap is not closed by a scene-time epsilon');
});

const points = (path) => {
  const values = path.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi).map(Number);
  return Array.from({ length: values.length / 2 }, (_, i) => values.slice(i * 2, i * 2 + 2));
};
const distance = ([x, y], ring) =>
  Math.min(
    ...ring.map((a, i) => {
      const b = ring[(i + 1) % ring.length],
        dx = b[0] - a[0],
        dy = b[1] - a[1];
      const t = Math.max(
        0,
        Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)),
      );
      return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
    }),
  );

test('measured ink translates with its body and survives different contour tessellations', () => {
  const square = [
    [-80, -30],
    [80, -30],
    [80, 30],
    [-80, 30],
  ];
  const outline = (ring) => points(contourGeometry(ring, 'moving-boundary').outline);
  const original = outline(square);
  const shifted = outline(square.map(([x, y]) => [x + 23.75, y - 11.2]));
  shifted.forEach(([x, y], i) =>
    assert.ok(Math.hypot(x - 23.75 - original[i][0], y + 11.2 - original[i][1]) < 1e-10),
  );
  const divided = square.flatMap((a, i) => {
    const b = square[(i + 1) % square.length];
    return [0, 0.13, 0.41, 0.78].map((t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  });
  for (const ring of [
    divided,
    [...divided].reverse(),
    [...divided.slice(5), ...divided.slice(0, 5)],
  ]) {
    const changed = outline(ring);
    for (const p of changed)
      assert.ok(distance(p, original) < 0.01, 'No new random stroke at a new vertex');
    for (const p of original) assert.ok(distance(p, changed) < 0.01);
  }
  for (const p of original)
    assert.ok(distance(p, square) < 0.5, 'The pen stays inside its own stroke width');
  const curved = Array.from({ length: 72 }, (_, i) => {
    const a = (i / 72) * Math.PI * 2;
    return [80 * Math.cos(a), 50 * Math.sin(a)];
  });
  const curve = outline(curved);
  for (const ring of [[...curved].reverse(), [...curved.slice(17), ...curved.slice(0, 17)]])
    for (const p of outline(ring))
      assert.ok(distance(p, curve) < 0.01, 'A smooth closed stroke has no privileged first sample');
});

test('a measured side keeps its hand when neighbouring geometry changes the bounds', () => {
  const first = [
      [0, 0],
      [160, 0],
    ],
    ring = [...first, [160, 60], [0, 60]],
    changed = [...first, [7000, 10000], [-5000, 10000]];
  const firstSide = (shape) => points(contourGeometry(shape, 'local-hand').outline).slice(0, 20);
  assert.deepEqual(firstSide(changed), firstSide(ring));
  const before = contourGeometry(ring, 'local-hand');
  for (const shape of [changed, ring, changed, ring]) contourGeometry(shape, 'local-hand');
  assert.deepEqual(contourGeometry(ring, 'local-hand'), before, 'Seeking does not age the ink');
});

test('the hand follows the trace through rotation, resampling and a newly forming bend', () => {
  const line = [
      [0, 0],
      [64, 0],
      [160, 0],
    ],
    outline = (trace) => points(contourGeometry(trace, 'local-hand', 1.65, false).outline),
    original = outline(line),
    angle = 1.7,
    rotate = ([x, y]) => [
      x * Math.cos(angle) - y * Math.sin(angle),
      x * Math.sin(angle) + y * Math.cos(angle),
    ],
    turned = outline(line.map(rotate));
  const expected = original.map(rotate);
  for (const p of turned) assert.ok(distance(p, expected) < 1e-10);
  for (const p of expected) assert.ok(distance(p, turned) < 1e-10);
  const unsegmented = outline([line[0], line.at(-1)]),
    reversed = outline([...line].reverse());
  for (const p of [...original, ...reversed])
    assert.ok(distance(p, unsegmented) < 0.01, 'Extra samples do not start another hand movement');
  const bending = outline([
    [0, 0],
    [64, 0.00001],
    [160, 0],
  ]);
  for (const p of bending)
    assert.ok(
      distance(p, original) < 0.0001,
      'A new bend carries the existing ink without a phase jump',
    );
  assert.deepEqual(
    outline([
      [12, 4],
      [12, 4],
    ]),
    [[12, 4]],
    'A collapsed trace remains a point',
  );
});
