import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawingPlane } from '../dist/characters/staging/drawing-plane.js';
import { bookPage } from '../dist/characters/staging/book.js';
import { portable, portableBounds } from '../dist/characters/staging/portable.js';
import { readingRoom, courtyard } from '../dist/characters/staging/sets.js';
import { destination } from '../dist/characters/staging/layout.js';
import { projective } from '../dist/ink/projective.js';
import { project } from '../dist/characters/staging/space.js';

test('the same homography maps a perspective board and the opening book to all four corners', () => {
  const space = readingRoom().staging.projection;
  const board = drawingPlane({ kind: 'board', at: { x: 1, z: 4 }, scale: 1.3 }, space).quad;
  const frames = [
    board,
    ...[0.56, 0.7, 0.9, 1].map((open) =>
      bookPage({
        id: 'book',
        x: 420,
        y: 390,
        scale: 0.64,
        open,
        turn: 0,
        handTurn: 0,
        color: '#000',
      }),
    ),
  ];
  for (const quad of frames) {
    const map = projective(quad, 640, 320);
    assert.ok(map);
    for (const [index, point] of [
      [0, 0],
      [640, 0],
      [640, 320],
      [0, 320],
    ].entries()) {
      const actual = map.at(...point);
      assert.ok(Math.hypot(actual.x - quad[index].x, actual.y - quad[index].y) < 1e-8);
    }
    for (const point of [
      [0, 0],
      [320, 160],
      [640, 320],
      [-50, 400],
    ]) {
      const projected = map.at(...point),
        restored = map.inverse(projected.x, projected.y);
      assert.ok(Math.hypot(restored.x - point[0], restored.y - point[1]) < 1e-8);
    }
  }
  assert.equal(
    projective(
      [
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: 2 },
        { x: 0, y: 3 },
      ],
      640,
      320,
    ),
    undefined,
  );
  assert.throws(
    () =>
      projective(
        [
          { x: 0, y: 0 },
          { x: 2, y: 2 },
          { x: 0, y: 2 },
          { x: 2, y: 0 },
        ],
        640,
        320,
      ),
    /convex/,
  );
});

test('a portable drawing uses the same local picture coordinates at rest and in either hand', () => {
  const space = readingRoom().staging.projection;
  const item = portable('letter', { x: 2, z: 3, height: 1.4 });
  item.surface = {
    corners: [
      { x: -0.28, z: 0, height: 0.8 },
      { x: 0.28, z: 0, height: 0.8 },
      { x: 0.28, z: 0, height: 0.4 },
      { x: -0.28, z: 0, height: 0.4 },
    ],
  };
  const resting = drawingPlane(item, space).quad;
  for (const frame of [
    { x: 280, y: 320, scale: 0.64 },
    { x: 510, y: 390, scale: 0.8 },
  ]) {
    const carried = drawingPlane(item, space, undefined, frame).quad;
    assert.notDeepEqual(carried, resting);
    for (const [i, point] of carried.entries()) {
      assert.ok(
        Math.abs((point.x - frame.x) / frame.scale - item.surface.corners[i].x * 100) < 1e-9,
      );
      assert.ok(
        Math.abs((frame.y - point.y) / frame.scale - item.surface.corners[i].height * 100) < 1e-9,
      );
    }
  }
  assert.throws(
    () =>
      drawingPlane(
        { ...item, surface: { corners: item.surface.corners.map((p) => ({ ...p, z: 0.1 })) } },
        space,
      ),
    /front plane/,
  );
});

test('automatic artwork content targets match its physical picture in each set projection', () => {
  for (const set of [readingRoom(), courtyard()]) {
    const space = set.staging.projection;
    for (const scale of [undefined, 0.55, 1.2]) {
      const item = { ...portable('instrument', { x: 2, z: 3, height: 1.4 }), scale };
      const staging = { ...set.staging, objects: { meter: item }, spots: {} };
      const target = destination(staging, 'meter.content');
      const projected = project(space, target),
        anchor = project(space, item.at);
      const bounds = portableBounds(
        { id: 'meter', portable: true, ...anchor, scale: anchor.scale * (scale ?? 0.72) },
        item.art,
      );
      assert.ok(Math.abs(projected.x - bounds.x - bounds.width / 2) < 1e-9);
      assert.ok(Math.abs(projected.y - bounds.y - bounds.height / 2) < 1e-9);
      const quad = drawingPlane(item, space).quad;
      assert.ok(Math.abs(quad[0].x - bounds.x) < 1e-9);
      assert.ok(Math.abs(quad[0].y - bounds.y) < 1e-9);
      assert.ok(Math.abs(quad[2].x - bounds.x - bounds.width) < 1e-9);
      assert.ok(Math.abs(quad[2].y - bounds.y - bounds.height) < 1e-9);
      staging.spots['meter.content'] = { x: -2, z: 1, height: 0 };
      assert.deepEqual(destination(staging, 'meter.content'), staging.spots['meter.content']);
    }
  }
});
