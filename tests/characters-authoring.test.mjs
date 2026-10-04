import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chibi } from '../dist/characters/packs/chibi.js';
import { arrange, destination } from '../dist/characters/staging/layout.js';
import { meetingPoint, route } from '../dist/characters/staging/navigation.js';
import { footprint } from '../dist/characters/staging/objects.js';
import { ground, project, alongPath } from '../dist/characters/staging/space.js';
import { readingRoom, courtyard } from '../dist/characters/staging/sets.js';
import { compileScore } from '../dist/characters/score.js';
import { blockAt } from '../dist/characters/staging/motion.js';
import { routines } from '../dist/characters/routines.js';
import { world } from '../dist/characters/staging/world.js';
import { performance, readSkeleton, unpackCharacter } from '../dist/characters/performance.js';

const { data } = readSkeleton(await unpackCharacter(chibi));
const inside = (p, box) =>
  p.x > box.left + 1e-6 &&
  p.x < box.right - 1e-6 &&
  p.z > box.front + 1e-6 &&
  p.z < box.back - 1e-6;
function clearPath(path, box) {
  for (let i = 0; i <= 200; i++)
    assert.equal(
      inside(alongPath(path, i / 200), box),
      false,
      `route enters furniture at ${i / 200}`,
    );
}
async function actorWorld(options, score) {
  return world(
    { ...options, background: false },
    score.blocking,
    Object.fromEntries(
      Object.entries(options.cast).map(([id, actor]) => [
        id,
        performance(
          data,
          chibi,
          actor,
          score.tracks[id],
          project(options.set.staging.projection, destination(options.set.staging, actor.at)),
          options.set.height,
        ),
      ]),
    ),
    undefined,
  );
}

test('relative names resolve before routing to an edge contact without crossing the furniture', () => {
  const projection = readingRoom().staging.projection;
  const base = {
    width: 800,
    height: 600,
    svg: '',
    spots: {},
    staging: {
      projection,
      spots: {},
      objects: { table: { kind: 'table', at: ground(0, 3) } },
    },
  };
  const original = structuredClone(base);
  const set = arrange(base, {
    objects: { marker: { kind: 'book', at: 'table' } },
    spots: { table: { of: 'table', side: 'front', gap: 0.12 } },
  });
  const contact = destination(set.staging, 'table');
  assert.deepEqual(
    set.staging.objects.marker.at,
    contact,
    'a named spot has the same meaning during placement and actions',
  );
  assert.equal(contact.z, 2.4);
  assert.ok(Math.abs(destination(set.staging, { of: 'table', side: 'on' }).height - 1.9) < 1e-10);
  assert.deepEqual(base, original, 'arrangement leaves its source set reusable');

  const from = ground(0, 6),
    via = route(set.staging, from, contact, 0.35);
  assert.ok(via.length >= 2, 'approaching inside the clearance margin still goes around the table');
  clearPath([from, ...via, contact], footprint(set.staging.objects.table));
  assert.deepEqual(route(set.staging, from, contact, 0.35, ['table']), []);
  assert.throws(() => route(set.staging, from, ground(0, 3), 0.35), /inside blocking furniture/);
  const meeting = meetingPoint(set.staging, ground(0, 3), 1.2, 0.35);
  for (const offset of [-1.2, 1.2])
    assert.equal(
      inside({ ...meeting, x: meeting.x + offset }, footprint(set.staging.objects.table)),
      false,
    );
  assert.deepEqual(meetingPoint(set.staging, from, 1.2, 0.35), from);
  assert.throws(() => arrange(base, { spots: { a: 'b', b: 'a' } }), /Circular/);
  assert.throws(
    () => arrange(base, { objects: { table: null }, spots: { a: 'table' } }),
    /destination/,
  );
  assert.throws(() => destination(set.staging, { of: 'table', side: 'front', gap: -1 }), /gap/);
});

test('an arranged reading routine reaches the book, opens and closes it, then returns it across rewinds', async () => {
  const set = arrange(readingRoom(), {
    objects: {
      sideTable: { at: { of: 'seat', side: 'right', gap: 1.35 } },
      book: { at: { of: 'sideTable', side: 'on' } },
    },
  });
  const options = {
    pack: chibi,
    set,
    cast: {
      hero: { skin: 'mira-lab', scale: 0.64, at: { of: 'sideTable', side: 'back', gap: 1.5 } },
    },
    beats: routines.read('reading', { actor: 'hero', pages: 2 }),
  };
  const score = compileScore(options),
    blocking = score.blocking;
  const plans = Object.fromEntries(blocking.plans.map((p) => [p.action.action, p]));
  assert.ok(plans.take.via.length > 0, 'taking the book starts with a real furniture detour');
  clearPath(
    [plans.take.from.hero.at, ...plans.take.via, plans.take.to.hero.at],
    footprint(set.staging.objects.sideTable),
  );
  for (const action of ['openBook', 'closeBook']) {
    const plan = plans[action];
    assert.equal(blockAt(blocking, (plan.start + plan.end) / 2).actors.hero.bookOpen, 0.5);
    assert.equal(blockAt(blocking, plan.end).actors.hero.bookOpen, action === 'openBook' ? 1 : 0);
  }
  const final = blockAt(blocking, score.script.duration);
  assert.equal(final.actors.hero.book, undefined);
  assert.equal(final.actors.hero.seated, 0);
  assert.deepEqual(final.books.book, set.staging.objects.book.at);

  const returning = compileScore({
    ...options,
    beats: options.beats.filter((beat) =>
      ['take', 'openBook', 'put'].includes(beat.perform[0].action),
    ),
  }).blocking;
  const put = returning.plans.at(-1),
    span = put.end - put.start;
  assert.equal(blockAt(returning, put.start).actors.hero.bookOpen, 1);
  assert.ok(
    Math.abs(blockAt(returning, put.start + span * 0.15).actors.hero.bookOpen - 0.5) < 1e-10,
  );
  assert.equal(blockAt(returning, put.start + span * 0.3).actors.hero.bookOpen, 0);
  assert.equal(
    blockAt(returning, put.end).actors.hero.bookOpen,
    0,
    'returning closes an open book before release',
  );

  const subject = await actorWorld(options, score);
  try {
    const times = blocking.plans.flatMap((p) => [p.start, (p.start + p.end) / 2, p.end - 1e-6]);
    const expected = times.map((time) => {
      subject.sample(time, false);
      return subject.snapshot();
    });
    for (const [i, time] of [...times.entries()].reverse()) {
      subject.sample(time, true);
      subject.sample(time, false);
      assert.deepEqual(subject.snapshot(), expected[i], `reading rewind @ ${time}`);
    }
    for (const action of ['openBook', 'read', 'closeBook']) {
      const plan = plans[action];
      for (let i = 0; i <= 20; i++) {
        subject.sample(plan.start + ((plan.end - plan.start) * i) / 20, false);
        const contacts = subject.snapshot().actors.hero.contacts;
        assert.equal(contacts.length, 2);
        for (const hand of contacts)
          assert.ok(hand.error < 1, `${action}: ${hand.kind} misses its fold by ${hand.error}`);
      }
    }
  } finally {
    subject.dispose();
  }
});

test('door and stair routines finish closed and back on the ground without boundary state leaks', async () => {
  const options = {
    pack: chibi,
    set: courtyard(),
    cast: { hero: { skin: 'tesla-field', scale: 0.8, at: 'entry' } },
    beats: [
      ...routines.enter('in', 'hero'),
      ...routines.leave('out', 'hero'),
      ...routines.stairs('up-down', 'hero'),
    ],
  };
  const score = compileScore(options),
    blocking = score.blocking;
  const close = blocking.plans.find((p) => p.action.action === 'closeDoor');
  assert.ok(blockAt(blocking, close.start + (close.end - close.start) * 0.6).objects.door > 0);
  assert.ok(blockAt(blocking, close.start + (close.end - close.start) * 0.6).objects.door < 1);
  assert.equal(blockAt(blocking, close.end).objects.door, 0);
  const final = blockAt(blocking, score.script.duration).actors.hero;
  assert.deepEqual(final.at, options.set.staging.objects.stairs.at);
  assert.equal(final.facing, 'front');
  assert.equal(final.travel, undefined);
  const subject = await actorWorld(options, score);
  try {
    const times = blocking.plans.flatMap((p) => [
      p.start,
      p.start + (p.end - p.start) * 0.6,
      p.end - 1e-6,
    ]);
    const expected = times.map((time) => {
      subject.sample(time, false);
      return subject.snapshot();
    });
    for (const [i, time] of [...times.entries()].reverse()) {
      subject.sample(time, true);
      subject.sample(time, false);
      assert.deepEqual(subject.snapshot(), expected[i], `door/stair rewind @ ${time}`);
    }
    for (const plan of blocking.plans) {
      const before = blockAt(blocking, plan.end - 1e-6).actors.hero.at;
      const after = blockAt(blocking, plan.end).actors.hero.at;
      assert.ok(
        Math.hypot(
          before.x - after.x,
          before.z - after.z,
          (before.height ?? 0) - (after.height ?? 0),
        ) < 1e-5,
      );
    }
  } finally {
    subject.dispose();
  }
});

test('a hand tap joins different-height actors for a shared route around furniture', async () => {
  const room = readingRoom();
  const set = {
    ...room,
    staging: {
      ...room.staging,
      spots: {},
      objects: {
        table: { kind: 'table', at: ground(0, 4) },
        seat: { kind: 'chair', at: ground(-4, 4) },
      },
    },
  };
  const options = {
    pack: chibi,
    set,
    cast: {
      a: { skin: 'mira-lab', scale: 0.64, at: ground(-4, 2) },
      b: { skin: 'tesla-field', scale: 0.8, at: ground(-4, 6) },
    },
    beats: [
      {
        id: 'tap',
        seconds: 3,
        text: 'Поздороваться',
        perform: [{ action: 'handTap', actors: ['a', 'b'] }],
      },
      {
        id: 'together',
        seconds: 5,
        text: 'Обойти стол вместе',
        perform: [{ action: 'walkTogether', actors: ['a', 'b'], to: ground(4, 4) }],
      },
    ],
  };
  const score = compileScore(options),
    blocking = score.blocking;
  const walk = blocking.plans[1];
  assert.notEqual(
    blocking.plans[0].to.a.at.z,
    4,
    'the occupied midpoint moves to a free meeting place',
  );
  for (const plan of blocking.plans)
    for (let i = 0; i <= 200; i++) {
      const state = blockAt(blocking, plan.start + ((plan.end - plan.start) * i) / 200);
      for (const [id, actor] of Object.entries(state.actors))
        for (const object of Object.values(set.staging.objects))
          assert.equal(
            inside(actor.at, footprint(object)),
            false,
            `${id} enters furniture during ${plan.action.action}`,
          );
    }
  const subject = await actorWorld(options, score);
  try {
    for (const [plan, progress] of [
      [blocking.plans[0], 0.46],
      [walk, 0.4],
      [walk, 0.65],
    ]) {
      const time = plan.start + (plan.end - plan.start) * progress;
      subject.sample(time, false);
      const expected = subject.snapshot();
      for (const actor of Object.values(expected.actors)) {
        assert.equal(actor.contacts.length, 1);
        assert.ok(actor.contacts[0].error < 1, `paired contact error: ${actor.contacts[0].error}`);
      }
      const hands = Object.values(expected.actors).map((actor) => actor.contacts[0].actual);
      assert.ok(Math.hypot(hands[0].x - hands[1].x, hands[0].y - hands[1].y) < 1);
      subject.sample(score.script.duration, true);
      subject.sample(time, false);
      assert.deepEqual(subject.snapshot(), expected, `paired rewind @ ${time}`);
    }
  } finally {
    subject.dispose();
  }
});
