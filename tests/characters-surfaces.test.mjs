import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawingPlane } from '../dist/characters/staging/drawing-plane.js';
import { bookPage } from '../dist/characters/staging/book.js';
import { portable } from '../dist/characters/staging/portable.js';
import { readingRoom } from '../dist/characters/staging/sets.js';
import { projective } from '../dist/ink/projective.js';

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
  const item = portable('instrument', { x: 2, z: 3, height: 1.4 });
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
