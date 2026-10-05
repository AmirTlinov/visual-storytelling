import test from 'node:test';
import assert from 'node:assert/strict';
import { notebookWorld, notebookSupport } from '../dist/book/world.js';
import { arrange } from '../dist/characters/staging/layout.js';
import { readingRoom, street, courtyard } from '../dist/characters/staging/sets.js';
import { furnitureParts } from '../dist/characters/staging/furniture.js';
import { notebookGeometry } from '../dist/characters/staging/notebook.js';
import { footprint } from '../dist/characters/staging/objects.js';
import { portable, portableBounds } from '../dist/characters/staging/portable.js';
import { project } from '../dist/characters/staging/space.js';

const overlaps = (a, b) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

test('an automatic notebook reuses a free table without moving the authored world', () => {
  const input = arrange(readingRoom(), { objects: { book: null } });
  const before = JSON.stringify(input);
  const { set, bookId } = notebookWorld(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(notebookSupport(set, set.staging.objects[bookId])[0], 'sideTable');
  assert.deepEqual(Object.keys(set.staging.objects), [
    ...Object.keys(input.staging.objects),
    bookId,
  ]);
  const again = notebookWorld(set);
  assert.equal(again.bookId, bookId);
  assert.deepEqual(again.set, set);
});

test('an occupied small support keeps its instrument visible when the notebook is added', () => {
  const room = arrange(readingRoom({ theme: 'laboratory', seat: 'bench' }), {
    objects: {
      book: null,
      sideTable: { scale: 0.55 },
      seat: { at: { of: 'sideTable', side: 'left', gap: 1.4, offset: { x: 0, z: 1.5 } } },
      letter: {
        ...portable('letter', { x: 0, z: 0 }),
        at: { of: 'sideTable', side: 'on', offset: { x: -0.38, z: 0 } },
      },
      meter: {
        ...portable('instrument', { x: 0, z: 0 }),
        at: { of: 'sideTable', side: 'on', offset: { x: 0.38, z: 0 } },
      },
    },
  });
  for (const input of [room, street(), courtyard()]) {
    const original = JSON.stringify(input),
      { set, bookId } = notebookWorld(input),
      book = set.staging.objects[bookId],
      [deskId, desk] = notebookSupport(set, book),
      space = set.staging.projection,
      parts = furnitureParts(desk, space),
      plane = footprint(desk);
    assert.equal(JSON.stringify(input), original);
    assert.ok(!Object.hasOwn(input.staging.objects, deskId));
    for (const [id, object] of Object.entries(input.staging.objects)) {
      assert.deepEqual(
        set.staging.objects[id],
        object,
        'automatic staging preserves authored objects',
      );
      const point = project(space, object.at),
        boxes =
          object.kind === 'prop'
            ? [
                portableBounds(
                  { ...point, scale: point.scale * (object.scale ?? 0.72) },
                  object.art,
                ),
              ]
            : furnitureParts(object, space, object.open).map((part) => part.bounds);
      for (const part of parts)
        for (const box of boxes)
          assert.equal(overlaps(part.bounds, box), false, `the added desk obscures ${id}`);
    }
    for (const { bounds } of parts) {
      assert.ok(bounds.x >= 0 && bounds.y >= 0);
      assert.ok(bounds.x + bounds.width <= set.width && bounds.y + bounds.height <= set.height);
    }
    for (const point of notebookGeometry(book).faces.flatMap((face) => face.points))
      assert.ok(
        point.x >= plane.left &&
          point.x <= plane.right &&
          point.z >= plane.front &&
          point.z <= plane.back,
        'the complete book rests on its tabletop',
      );
  }
});

test('a full scene requests an authored support instead of hiding existing artwork', () => {
  const base = readingRoom();
  const input = {
    ...base,
    staging: {
      ...base.staging,
      layout: undefined,
      objects: {
        full: {
          kind: 'prop',
          at: { x: 0, z: 0 },
          scale: 1,
          art: { svg: '', width: 2000, height: 1000, grip: { x: 0, y: 0 } },
        },
      },
    },
  };
  const before = JSON.stringify(input);
  assert.throws(() => notebookWorld(input), /arrange\(set.*side: 'on'/);
  assert.equal(JSON.stringify(input), before);
});
