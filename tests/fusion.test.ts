import test from 'node:test';
import assert from 'node:assert/strict';
import { signedDistance } from '../src/ink/fusion/field.ts';
import { inkRoutes, type InkPath } from '../src/ink/fusion/transport.ts';
import { medialPaths } from '../src/ink/fusion/skeleton.ts';

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
