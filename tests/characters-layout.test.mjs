import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrange, destination } from '../dist/characters/staging/layout.js';
import { readingRoom } from '../dist/characters/staging/sets.js';
import { ground } from '../dist/characters/staging/space.js';
import { supportPoint } from '../dist/characters/staging/objects.js';

const has = (record, key) => Object.hasOwn(record, key);
const absent = (set, kind, names) => {
  for (const name of names) {
    assert.equal(has(set.staging[kind], name), false, `${kind}:${name} is not rendered`);
    assert.equal(
      has(set.staging.layout[kind], name),
      false,
      `${kind}:${name} is not retained as an authored relation`,
    );
    if (kind === 'spots')
      assert.equal(has(set.spots, name), false, `${name} has no stale projected mark`);
  }
};

test('removing prepared furniture removes only inherited dependents and leaves the reusable room intact', () => {
  const room = readingRoom(),
    before = JSON.stringify(room);
  const withoutSeat = arrange(room, { objects: { seat: null } });
  absent(withoutSeat, 'objects', ['seat']);
  absent(withoutSeat, 'spots', ['reader']);
  assert.deepEqual(withoutSeat.staging.objects.book, room.staging.objects.book);
  assert.deepEqual(withoutSeat.staging.spots.entry, room.staging.spots.entry);
  const withoutTable = arrange(room, { objects: { sideTable: null } });
  absent(withoutTable, 'objects', ['sideTable', 'book']);
  assert.deepEqual(withoutTable.staging.spots.reader, room.staging.spots.reader);
  assert.equal(JSON.stringify(room), before);
});

test('cascading deletion follows cross-kind relations, persists across arrange, and does not resurrect children', () => {
  const base = arrange(readingRoom(), {
    spots: { bookMark: 'book', lookAt: { of: 'bookMark', side: 'left', gap: 0.1 } },
    objects: { note: { kind: 'book', at: 'lookAt' } },
  });
  const before = JSON.stringify(base);
  const removed = arrange(base, { objects: { sideTable: null } });
  absent(removed, 'objects', ['sideTable', 'book', 'note']);
  absent(removed, 'spots', ['bookMark', 'lookAt']);
  const restoredParent = arrange(removed, {
    objects: { sideTable: { kind: 'table', at: ground(-2, 4) } },
  });
  absent(restoredParent, 'objects', ['book', 'note']);
  absent(restoredParent, 'spots', ['bookMark', 'lookAt']);
  assert.deepEqual(arrange(restoredParent, {}).staging, restoredParent.staging);
  assert.equal(JSON.stringify(base), before);
});

test('explicit relocations survive owner deletion and their remaining relations still update', () => {
  const room = readingRoom();
  const moved = arrange(room, {
    objects: { sideTable: null, book: { at: { of: 'seat', side: 'on' } } },
    spots: { bookMark: 'book' },
  });
  absent(moved, 'objects', ['sideTable']);
  assert.deepEqual(moved.staging.objects.book.at, supportPoint(moved.staging.objects.seat));
  const next = arrange(moved, { objects: { seat: { at: ground(-2, 4) } } });
  assert.deepEqual(next.staging.objects.book.at, supportPoint(next.staging.objects.seat));
  assert.deepEqual(next.staging.spots.bookMark, next.staging.objects.book.at);
  assert.deepEqual(next.staging.layout.objects.book.at, { of: 'seat', side: 'on' });
  const retainedMark = arrange(room, { objects: { seat: null }, spots: { reader: ground(-3, 2) } });
  assert.deepEqual(retainedMark.staging.spots.reader, ground(-3, 2));
});

test('explicit dangling references and author-created cycles remain errors', () => {
  const room = readingRoom();
  for (const layout of [
    { objects: { seat: null }, spots: { reader: { of: 'seat', side: 'front' } } },
    { objects: { sideTable: null, book: { at: 'sideTable' } } },
    { objects: { sideTable: null }, spots: { requestedBook: 'book' } },
    { spots: { a: 'missing' } },
  ])
    assert.throws(() => arrange(room, layout), /Unknown.*(?:placement|destination)/);
  assert.throws(() => arrange(room, { spots: { a: 'b', b: 'a' } }), /Circular/);
});

test('duplicate names preserve destination precedence and use a live fallback without creating self-dependencies', () => {
  const room = readingRoom();
  const base = arrange(room, {
    objects: {
      anchor: { kind: 'table', at: ground(-2, 4) },
      named: { kind: 'book', at: 'anchor' },
      relative: { kind: 'book', at: { of: 'anchor', side: 'front', gap: 0.2 } },
    },
    spots: { anchor: ground(4, 5) },
  });
  const noObject = arrange(base, { objects: { anchor: null } });
  assert.deepEqual(noObject.staging.objects.named.at, ground(4, 5));
  assert.deepEqual(noObject.staging.objects.relative.at, ground(4, 4.8));
  const noSpot = arrange(base, { spots: { anchor: null } });
  assert.deepEqual(noSpot.staging.objects.named.at, noSpot.staging.objects.anchor.at);
  assert.deepEqual(
    noSpot.staging.objects.relative.at,
    destination(noSpot.staging, { of: 'anchor', side: 'front', gap: 0.2 }),
  );
  const neither = arrange(base, { objects: { anchor: null }, spots: { anchor: null } });
  absent(neither, 'objects', ['anchor', 'named', 'relative']);
  absent(neither, 'spots', ['anchor']);

  const approach = arrange(room, {
    spots: { seat: { of: 'seat', side: 'front', gap: 0.5 }, waiting: 'seat' },
  });
  const noSeat = arrange(approach, { objects: { seat: null } });
  absent(noSeat, 'spots', ['seat', 'waiting', 'reader']);
});

test('exact .content names retain their owner when a physical surface is removed, and fall back when the name is removed', () => {
  const room = readingRoom(),
    mark = ground(-2, 1);
  const base = arrange(room, {
    objects: {
      board: { kind: 'board', at: ground(0, 3) },
      note: { kind: 'book', at: 'board.content' },
    },
    spots: { 'board.content': mark, observer: 'board.content' },
  });
  assert.deepEqual(base.staging.objects.note.at, mark);
  assert.deepEqual(destination(base.staging, 'board.content'), mark);
  const noBoard = arrange(base, { objects: { board: null } });
  assert.deepEqual(noBoard.staging.objects.note.at, mark);
  assert.deepEqual(noBoard.staging.spots.observer, mark);
  const neither = arrange(noBoard, { spots: { 'board.content': null } });
  absent(neither, 'objects', ['board', 'note']);
  absent(neither, 'spots', ['board.content', 'observer']);
  const physical = arrange(base, { spots: { 'board.content': null, board: ground(8, 8) } });
  const surface = destination(physical.staging, 'board.content');
  assert.deepEqual(physical.staging.objects.note.at, surface);
  assert.deepEqual(physical.staging.spots.observer, surface);
  assert.equal(surface.x, 0, 'a surface suffix belongs to the physical board, not the board spot');
  assert(surface.height > 0);

  const onlyName = arrange(room, {
    objects: { note: { kind: 'book', at: 'board.content' } },
    spots: { 'board.content': mark },
  });
  assert.deepEqual(onlyName.staging.objects.note.at, mark);
  const onlyObject = arrange(room, {
    objects: {
      'board.content': { kind: 'table', at: mark },
      note: { kind: 'book', at: 'board.content' },
    },
  });
  assert.deepEqual(onlyObject.staging.objects.note.at, mark);
});
