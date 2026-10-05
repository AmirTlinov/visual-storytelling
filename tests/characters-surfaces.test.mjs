import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawingPlane } from '../dist/characters/staging/drawing-plane.js';
import { bookPage } from '../dist/characters/staging/book.js';
import { portable } from '../dist/characters/staging/portable.js';
import { readingRoom } from '../dist/characters/staging/sets.js';
import { projective } from '../dist/ink/projective.js';
import { PerspectiveCamera, Vector3 } from '../dist/viewport/engine.js';
import { notebookCamera } from '../dist/book/camera.js';
import { notebookGeometry } from '../dist/characters/staging/notebook.js';
import { project } from '../dist/characters/staging/space.js';

test('the notebook camera preserves the stage crop and fills the page after resize and rewind', () => {
  for (const perspective of ['stage', 'overview']) {
    const set = readingRoom({ perspective });
    for (const scale of [0.55, 1.1]) {
      const source = {
        width: set.width,
        height: set.height,
        projection: set.staging.projection,
        camera: { x: 130, y: 80, width: 560, height: 430 },
        book: {
          kind: 'book',
          at: { x: 2, z: 3, height: 1.86 * scale },
          scale,
          open: scale < 1 ? 0 : 1,
        },
      };
      const camera = new PerspectiveCamera();
      for (const aspect of [0.44, 1.5, 2.2]) {
        const width = 960,
          height = width / aspect;
        const pixels = (point) => {
          const p = new Vector3(point.x, point.height ?? 0, -point.z).project(camera);
          assert.ok([p.x, p.y, p.z].every(Number.isFinite));
          return { x: ((p.x + 1) * width) / 2, y: ((1 - p.y) * height) / 2 };
        };
        const closed = notebookCamera(source, 0);
        assert.deepEqual(
          closed.model.front,
          notebookGeometry(source.book).front,
          'the camera entry preserves the book opening left by the actor',
        );
        closed.project(camera, width, height);
        const w = Math.max(source.camera.width, source.camera.height * aspect),
          h = w / aspect;
        const x = source.camera.x + (source.camera.width - w) / 2;
        const y = source.camera.y + (source.camera.height - h) / 2;
        for (const point of [...closed.model.front, { x: -4, z: 0.5 }, { x: 4, z: 8, height: 2 }]) {
          const actual = pixels(point),
            expected = project(source.projection, point);
          assert.ok(
            Math.hypot(
              actual.x - ((expected.x - x) * width) / w,
              actual.y - ((expected.y - y) * width) / w,
            ) < 1e-7,
          );
        }
        const arrived = notebookCamera(source, 1);
        arrived.project(camera, width, height);
        for (const [i, point] of arrived.model.content(aspect).entries()) {
          const expected = [
            [0, 0],
            [width, 0],
            [width, height],
            [0, height],
          ][i];
          const actual = pixels(point);
          assert.ok(Math.hypot(actual.x - expected[0], actual.y - expected[1]) < 1e-7);
        }
        for (const p of [0.24, 0.42, 0.64, 0.68, 0.76]) {
          const frames = [-1e-7, 1e-7].map((delta) => {
            const shot = notebookCamera(source, p + delta);
            shot.project(camera, width, height);
            return pixels(source.book.at);
          });
          assert.ok(Math.hypot(frames[1].x - frames[0].x, frames[1].y - frames[0].y) < 0.01);
        }
        const current = notebookCamera(source, 0.81);
        current.project(camera, width, height);
        const expected = [...camera.matrixWorld.elements, ...camera.projectionMatrix.elements];
        // A prior turn changes clipping; a prior opening may also have a different aspect.
        camera.near = 0.2;
        camera.far = 20;
        notebookCamera(source, 0).project(camera, height, width);
        current.project(camera, width, height);
        assert.deepEqual(
          [...camera.matrixWorld.elements, ...camera.projectionMatrix.elements],
          expected,
        );
      }
    }
  }
});

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
