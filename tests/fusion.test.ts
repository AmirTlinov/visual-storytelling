import test from 'node:test';
import assert from 'node:assert/strict';
import { signedDistance } from '../src/ink/fusion/field.ts';
import { inkRoutes, type InkPath } from '../src/ink/fusion/transport.ts';
import { medialPaths } from '../src/ink/fusion/skeleton.ts';
import { inkDetailVisibility } from '../src/ink/fusion/detail.ts';

test('moving text suppresses unreadable fragments while endpoints and non-text shapes stay exact', () => {
  const geometry: [Float32Array, Float32Array] = [
    new Float32Array([0, 0, 1, 0, 0.6, 0.6, 10, 0, 30, 0, 0.6, 0.6]),
    new Float32Array(0),
  ];
  const original = geometry[0].slice();
  const patches = [
    {
      source: 0 as const,
      target: 0,
      ranges: [
        [0, 6],
        [6, 6],
      ] as [number, number][],
    },
  ];
  const details = inkDetailVisibility(patches, true);
  assert.deepEqual(Array.from(details(geometry, 0.4, 1)[0]!), [0, 1]);
  assert.deepEqual(Array.from(details(geometry, 0, 1)[0]!), [1, 1]);
  assert.deepEqual(Array.from(details(geometry, 1, 1)[0]!), [1, 1]);
  assert.deepEqual(Array.from(inkDetailVisibility(patches, false)(geometry, 0.4, 1)[0]!), [1, 1]);
  assert.deepEqual(geometry[0], original, 'Rendering must not alter geometry or Rapier history');
  // A detail crosses the readability threshold continuously rather than popping in.
  let previous = 0;
  for (let width = 1; width <= 14; width += 0.1) {
    geometry[0][2] = width;
    const visible = details(geometry, 0.4, 1)[0]![0]!;
    assert.ok(visible >= previous && visible - previous < 0.06);
    previous = visible;
  }
  assert.equal(previous, 1);
});

test('distance masks retain thin ink and have finite, symmetric exterior distances', () => {
  const width = 31,
    height = 25,
    alpha = new Uint8Array(width * height);
  for (let y = 4; y <= 20; y++) alpha[y * width + 15] = 255;
  const d = signedDistance(alpha, width, height);
  assert.ok(d.every(Number.isFinite));
  assert.equal(d[12 * width + 15], -0.5);
  assert.equal(d[12 * width + 16], 0.5);
  assert.equal(d[12 * width + 7], d[12 * width + 23]);
  assert.ok(d[0]! > 12);
});

test('transport covers every original and final stroke without an intermediate shape', () => {
  const stroke = (x: number, y: number, length: number): InkPath => [
    [x, y, 2],
    [x + length, y, 2],
  ];
  const first = [stroke(-20, 0, 12), stroke(20, 0, 8)];
  const second = [stroke(-10, 0, 8), stroke(15, 0, 15)];
  const target = [stroke(-30, 0, 20), stroke(30, 0, 20)];
  for (const [a, b, result] of [
    [first, second, target],
    [target.slice(0, 1), target.slice(1), [...first, ...second]],
  ] as const) {
    const routes = inkRoutes(a, b, result);
    assert.equal(routes.length, Math.max(a.length + b.length, result.length));
    for (const [group, paths] of [a, b].entries())
      for (const path of paths) {
        const ends = routes
          .filter((r) => r.source === group)
          .flatMap((r) => [r.from[0]![0], r.from.at(-1)![0]]);
        assert.ok(ends.some((x) => Math.abs(x - path[0]![0]) < 0.001));
        assert.ok(ends.some((x) => Math.abs(x - path.at(-1)![0]) < 0.001));
      }
    for (const path of result)
      assert.ok(routes.some((r) => Math.min(r.to[0]![0], r.to.at(-1)![0]) === path[0]![0]));
    for (const route of routes) {
      assert.equal(route.from.length, route.to.length);
      assert.ok([...route.from, ...route.to].flat().every(Number.isFinite));
    }
    for (let target = 0; target < result.length; target++) {
      const incoming = routes.filter((route) => route.target === target);
      const owners = incoming.filter((route) => route.attachment === undefined);
      assert.equal(owners.length, 1, 'A final stroke must have exactly one complete contour');
      for (const donor of incoming.filter((route) => route.attachment !== undefined))
        for (const point of donor.to) assert.deepEqual(point, owners[0]!.to[donor.attachment!]);
    }
  }
});

test('a painted drop retains its radius in the medial representation', () => {
  for (const width of [64, 65]) {
    const radius = 20;
    const mask = Uint8Array.from({ length: width * width }, (_, i) =>
      Math.hypot((i % width) - 32, Math.floor(i / width) - 32) < radius ? 255 : 0,
    );
    const paths = medialPaths(signedDistance(mask, width, width), width, width, 1);
    const points = paths.flat();
    assert.ok(points.length > 0);
    assert.ok(Math.abs(Math.max(...points.map((p) => p[2])) - radius) < 1);
    assert.ok(points.every((p) => Math.hypot(p[0], p[1]) < 2));
  }
});

test('symmetric loops keep their source order when becoming a stem and a loop', () => {
  const loop = (x: number): InkPath =>
    Array.from({ length: 41 }, (_, i) => {
      const angle = (i / 40) * Math.PI * 2;
      return [x + 30 * Math.cos(angle), 30 * Math.sin(angle), 2];
    });
  const source = loop(0);
  const routes = inkRoutes(
    [source],
    [source],
    [
      [
        [-40, -30, 2],
        [-40, 30, 2],
      ],
      [
        [-40, 0, 2],
        [-10, 0, 2],
      ],
      loop(20),
    ],
    true,
  );
  assert.ok(routes.filter((r) => r.target === 0).every((r) => r.source === 0));
  assert.ok(routes.filter((r) => r.target === 2).every((r) => r.source === 1));
});
