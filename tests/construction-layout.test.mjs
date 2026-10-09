import test from 'node:test';
import assert from 'node:assert/strict';
import { placeLabels } from '../dist/layout/labels.js';

const area = { x: 0, y: 0, width: 500, height: 400 };
const box = (x, y, height = 30) => ({ x, y, width: 80, height });

test('moving annotations retain their prepared order through coincident anchors', () => {
  const before = placeLabels([box(100, 100), box(100, 100 - 1e-6)], area);
  const after = placeLabels([box(100, 100), box(100, 100 + 1e-6)], area);
  for (let i = 0; i < 2; i++) assert.ok(Math.abs(after[i].y - before[i].y) < 1e-5);
  assert.ok(after[1].y >= after[0].y + after[0].height + 8 - 1e-5);
});

test('hard clearance includes tall, boundary-constrained and nonadjacent annotations', () => {
  const labels = placeLabels([box(0, 0, 100), box(250, 0), box(0, 0, 100)], area);
  assert.ok(labels[2].y >= labels[0].y + 108 - 1e-5);
  for (const label of labels) {
    assert.ok(label.y >= area.y - 1e-5);
    assert.ok(label.y + label.height <= area.height + 1e-5);
  }
  const tall = placeLabels(
    Array.from({ length: 15 }, () => box(100, 100, 50)),
    { ...area, height: 15 * 58 - 8 },
  );
  for (let i = 1; i < tall.length; i++)
    assert.ok(tall[i].y >= tall[i - 1].y + tall[i - 1].height + 8 - 1e-5);
});

test('horizontal approach creates room continuously before boxes touch', () => {
  let previous;
  for (let x = 220; x >= 100; x -= 0.1) {
    const labels = placeLabels([box(100, 100), box(x, 100)], area);
    if (previous) assert.ok(Math.abs(labels[0].y - previous[0].y) < 2);
    if (x <= 188) assert.ok(labels[1].y >= labels[0].y + 38 - 1e-5);
    previous = labels;
  }
});

test('packing annotations preserves protected material lettering between groups', () => {
  const labels = placeLabels([box(100, 155), box(100, 160), box(100, 170)], area, {
    limits: [{ bottom: 180 }, { bottom: 180 }, { top: 240 }],
  });
  assert.ok(labels[0].y + 38 <= labels[1].y + 1e-5);
  assert.ok(labels[1].y + labels[1].height <= 180 + 1e-5);
  assert.ok(labels[2].y >= 240 - 1e-5);
});

function verify(labels, area, { limits = [], obstacles = [], gap = 8 } = {}) {
  const active = labels.filter((p) => p.status === 'placed' && (p.opacity ?? 1) > 0);
  for (const [i, p] of labels.entries()) {
    assert.ok([p.x, p.y, p.width, p.height].every(Number.isFinite));
    if (p.status !== 'placed' || (p.opacity ?? 1) <= 0) continue;
    const bounds = limits[i] ?? {};
    assert.ok(p.x >= Math.max(area.x, bounds.left ?? area.x) - 1e-7);
    assert.ok(p.y >= Math.max(area.y, bounds.top ?? area.y) - 1e-7);
    assert.ok(p.x + p.width <= Math.min(area.x + area.width, bounds.right ?? Infinity) + 1e-7);
    assert.ok(p.y + p.height <= Math.min(area.y + area.height, bounds.bottom ?? Infinity) + 1e-7);
    for (const other of [...active, ...obstacles]) {
      if (other === p || (other.opacity ?? 1) <= 0) continue;
      assert.ok(
        p.x + p.width + gap <= other.x + 1e-7 ||
          other.x + other.width + gap <= p.x + 1e-7 ||
          p.y + p.height + gap <= other.y + 1e-7 ||
          other.y + other.height + gap <= p.y + 1e-7,
        `overlap: ${JSON.stringify(p)} / ${JSON.stringify(other)}`,
      );
    }
  }
}

test('dense placement uses both axes and reports the finite capacity explicitly', () => {
  const area = { x: 0, y: 0, width: 136, height: 68 };
  const preferred = Array.from({ length: 7 }, () => ({ x: 0, y: 0, width: 40, height: 30 }));
  const placed = placeLabels(preferred, area);
  assert.equal(placed.filter((p) => p.status === 'placed').length, 6);
  assert.equal(placed[6].status, 'overflow');
  verify(placed, area);
  assert.deepEqual(placeLabels(preferred, area), placed);
});

test('priority survives impossible packing and transparent labels reserve no space', () => {
  const area = { x: 0, y: 0, width: 90, height: 40 };
  const preferred = [
    { x: 4, y: 5, width: 80, height: 30, priority: 1 },
    { x: 6, y: 5, width: 80, height: 30, priority: 3 },
    { x: 0, y: 0, width: 90, height: 40, opacity: 0, priority: 9 },
  ];
  const placed = placeLabels(preferred, area);
  assert.equal(placed[0].status, 'overflow');
  assert.equal(placed[1].status, 'placed');
  assert.equal(placed[1].x, 6);
  assert.equal(placed[1].y, 5);
  verify(placed, area);
  assert.deepEqual(placeLabels([preferred[1]], area)[0], placed[1]);
});

test('obstacles and four-sided limits choose the nearest free boundary', () => {
  const area = { x: 0, y: 0, width: 100, height: 100 };
  const preferred = [{ x: 45, y: 45, width: 20, height: 20 }];
  const options = { gap: 5, obstacles: [{ x: 40, y: 40, width: 20, height: 20 }] };
  const placed = placeLabels(preferred, area, options);
  assert.equal(placed[0].x, 65);
  assert.equal(placed[0].y, 45);
  verify(placed, area, options);
  const limited = { ...options, limits: [{ left: 35, right: 65, top: 10, bottom: 90 }] };
  const result = placeLabels(preferred, area, limited);
  assert.equal(result[0].x, 45);
  assert.equal(result[0].y, 65);
  verify(result, area, limited);
  const impossible = placeLabels(preferred, area, { limits: [{ left: 45, right: 50 }] });
  assert.equal(impossible[0].status, 'overflow');
  verify(impossible, area);
  assert.equal(
    placeLabels(preferred, area, {
      obstacles: [{ ...area, opacity: 0 }],
    })[0].x,
    45,
  );
});

test('long diagonal strokes allow nearby positions in their middle, including crossed strokes', () => {
  const area = { x: 0, y: 0, width: 1000, height: 1000 };
  const preferred = [{ x: 490, y: 490, width: 20, height: 20 }];
  const first = { from: [0, 0], to: [1000, 1000], width: 2 };
  const second = { from: [0, 1000], to: [1000, 0], width: 2 };
  for (const segments of [[first], [first, second]]) {
    const [placed] = placeLabels(preferred, area, { segments, gap: 5 });
    assert.equal(placed.status, 'placed');
    assert.ok(Math.hypot(placed.x - 490, placed.y - 490) < 40);
    // A diagonal enters this expanded rectangle exactly when its corner signs straddle zero.
    const corners = [
      [placed.x - 6, placed.y - 6],
      [placed.x + placed.width + 6, placed.y - 6],
      [placed.x + placed.width + 6, placed.y + placed.height + 6],
      [placed.x - 6, placed.y + placed.height + 6],
    ];
    for (const segment of segments) {
      const signs = corners.map(([x, y]) => (segment === first ? x - y : x + y - 1000));
      assert.ok(Math.min(...signs) >= -1e-7 || Math.max(...signs) <= 1e-7);
    }
  }
});

test('placement is deterministic across coordinates, scale, and unrelated calls', () => {
  const preferred = [
    { x: 40, y: 40, width: 30, height: 20 },
    { x: 40, y: 40, width: 30, height: 20 },
    { x: 40, y: 40, width: 30, height: 20, priority: 2 },
  ];
  const area = { x: 0, y: 0, width: 140, height: 100 };
  const obstacles = [{ x: 45, y: 45, width: 40, height: 40 }];
  const original = structuredClone({ preferred, area, obstacles });
  const baseline = placeLabels(preferred, area, { obstacles, gap: 6 });
  for (const scale of [0.01, 0.5, 10, 1000]) {
    const transform = (b) => ({
      ...b,
      x: 17 + b.x * scale,
      y: -31 + b.y * scale,
      width: b.width * scale,
      height: b.height * scale,
    });
    const placed = placeLabels(preferred.map(transform), transform(area), {
      obstacles: obstacles.map(transform),
      gap: 6 * scale,
    });
    placed.forEach((p, i) => {
      assert.equal(p.status, baseline[i].status);
      assert.ok(Math.abs((p.x - 17) / scale - baseline[i].x) < 1e-6);
      assert.ok(Math.abs((p.y + 31) / scale - baseline[i].y) < 1e-6);
    });
    verify(placed, transform(area), { obstacles: obstacles.map(transform), gap: 6 * scale });
  }
  assert.deepEqual(placeLabels(preferred, area, { obstacles, gap: 6 }), baseline);
  assert.deepEqual({ preferred, area, obstacles }, original);
});

test('every placed label clears dense obstacles, and invalid geometry never enters the search', () => {
  let seed = 73;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const area = { x: -40, y: 12, width: 260, height: 160 };
  for (let sample = 0; sample < 24; sample++) {
    const preferred = Array.from({ length: 12 }, () => ({
      x: random() * 280 - 60,
      y: random() * 180,
      width: 24 + random() * 60,
      height: 15 + random() * 30,
      priority: Math.floor(random() * 3),
    }));
    const obstacles = Array.from({ length: 3 }, () => ({
      x: random() * 220 - 40,
      y: random() * 130 + 12,
      width: 20,
      height: 30,
    }));
    verify(placeLabels(preferred, area, { obstacles, gap: 4 }), area, { obstacles, gap: 4 });
  }
  assert.throws(() => placeLabels([box(NaN, 0)], area), /finite/);
  assert.throws(() => placeLabels([box(0, 0)], area, { gap: -1 }), /nonnegative/);
  assert.throws(() => placeLabels([box(0, 0)], area, { limits: [{ left: Infinity }] }), /finite/);
});

test('fractional measured boxes retain exact four-sided limits despite cancellation', () => {
  const box = { x: 0.1, y: 0.2, width: 0.8, height: 0.7 };
  const limits = [
    { left: box.x, right: box.x + box.width, top: box.y, bottom: box.y + box.height },
  ];
  const [placed] = placeLabels([box], { x: 0, y: 0, width: 1, height: 1 }, { limits });
  assert.equal(placed.status, 'placed');
  assert.equal(placed.x, box.x);
  assert.equal(placed.y, box.y);
  const overflow = placeLabels(
    [box],
    { x: 0, y: 0, width: 1, height: 1 },
    {
      limits: [{ ...limits[0], right: box.x + box.width - 0.000001 }],
    },
  );
  assert.equal(overflow[0].status, 'overflow');
});

test('a rotated visible boundary contains every placed corner and retains its usable edges', () => {
  const area = { x: 0, y: 0, width: 200, height: 200 };
  const boundary = [
    { x: 100, y: 0 },
    { x: 200, y: 100 },
    { x: 100, y: 200 },
    { x: 0, y: 100 },
  ];
  const contained = (label) => {
    if (label.status !== 'placed') return;
    for (const x of [label.x, label.x + label.width])
      for (const y of [label.y, label.y + label.height])
        assert.ok(Math.abs(x - 100) + Math.abs(y - 100) <= 100 + 1e-8, JSON.stringify(label));
  };
  for (const preferred of [
    { x: 5, y: 5, width: 30, height: 20 },
    { x: 140, y: 15, width: 30, height: 20 },
  ]) {
    const [label] = placeLabels([preferred], area, { boundary });
    assert.equal(label.status, 'placed');
    contained(label);
    assert.deepEqual(placeLabels([preferred], area, { boundary: [...boundary].reverse() }), [
      label,
    ]);
    if (preferred.x === 140) {
      assert.ok(Math.abs(label.x - 112.5) < 1e-8);
      assert.ok(
        Math.abs(label.y - 42.5) < 1e-8,
        'use the full boundary beyond its inscribed rectangle',
      );
    }
  }
  const labels = placeLabels(
    Array.from({ length: 14 }, () => ({ x: 90, y: 90, width: 45, height: 28 })),
    area,
    { boundary, segments: [{ from: [20, 80], to: [180, 120] }], gap: 4 },
  );
  assert.ok(labels.some((label) => label.status === 'placed'));
  assert.ok(labels.some((label) => label.status === 'overflow'));
  labels.forEach(contained);
  verify(labels, area, { gap: 4 });
  const [impossible] = placeLabels([{ x: 0, y: 0, width: 140, height: 100 }], area, { boundary });
  assert.equal(impossible.status, 'overflow');
  const [pinned] = placeLabels([{ x: 50, y: 50, width: 30, height: 20 }], area, {
    boundary,
    limits: [{ left: 50, right: 80, top: 50, bottom: 70 }],
  });
  assert.equal(pinned.status, 'placed');
  contained(pinned);
});
