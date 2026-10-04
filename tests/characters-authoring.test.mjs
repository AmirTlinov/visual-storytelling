import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chibi } from '../dist/characters/packs/chibi.js';
import { arrange, destination } from '../dist/characters/staging/layout.js';
import { meetingPoint, route } from '../dist/characters/staging/navigation.js';
import {
  footprint,
  objectShape,
  stairEnd,
  supportPoint,
  triggerPoint,
} from '../dist/characters/staging/objects.js';
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
  assert.equal(final.actors.hero.holding, undefined);
  assert.equal(final.actors.hero.seated, 0);
  assert.deepEqual(final.items.book, set.staging.objects.book.at);

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

test('successive set variants retain book, approach and doorway relationships', () => {
  const first = readingRoom();
  const moved = arrange(first, {
    objects: { sideTable: { at: ground(-3, 3), scale: 1.3 }, seat: { at: ground(2, 2) } },
  });
  assert.deepEqual(
    moved.staging.objects.book.at,
    destination(moved.staging, { of: 'sideTable', side: 'on' }),
  );
  assert.deepEqual(
    moved.staging.spots.reader,
    destination(moved.staging, { of: 'seat', side: 'front', gap: 0.75 }),
  );
  assert.notDeepEqual(first.staging.objects.book.at, moved.staging.objects.book.at);
  const door = arrange(courtyard(), { objects: { door: { at: ground(1, 10), scale: 1.2 } } });
  assert.deepEqual(
    door.staging.spots.inside,
    destination(door.staging, { of: 'door', side: 'inside' }),
  );
  assert.deepEqual(
    door.staging.spots.door,
    destination(door.staging, { of: 'door', side: 'outside' }),
  );
});

test('crossing walkers keep body clearance and reproduce the same route on rewind', () => {
  const room = readingRoom();
  const set = { ...room, staging: { ...room.staging, objects: {}, layout: undefined } };
  const score = compileScore({
    pack: chibi,
    set,
    cast: {
      a: { skin: 'tesla', at: ground(-2, 1) },
      b: { skin: 'mira', at: ground(2, 1), scale: 0.64 },
    },
    beats: [
      {
        id: 'cross',
        text: 'Пройти навстречу',
        seconds: 4,
        perform: [
          { action: 'walk', actor: 'a', to: ground(2, 1) },
          { action: 'run', actor: 'b', to: ground(-2, 1) },
        ],
      },
    ],
  });
  let minimum = Infinity;
  for (let i = 0; i <= 500; i++) {
    const { a, b } = blockAt(score.blocking, i * 0.008).actors;
    minimum = Math.min(minimum, Math.hypot(a.at.x - b.at.x, a.at.z - b.at.z));
  }
  assert.ok(minimum >= 0.52 * (0.77 + 0.64) - 0.001, `minimum clearance ${minimum}`);
  const expected = blockAt(score.blocking, 2);
  blockAt(score.blocking, 4);
  assert.deepEqual(blockAt(score.blocking, 2), expected);
});

test('raised walking uses a connected stair and rejects even a narrow unsupported gap', () => {
  const set = courtyard(),
    top = destination(set.staging, 'landing');
  const path = route(set.staging, set.staging.spots.entry, top, 0.3);
  assert.ok(
    path.some(
      (p) => p.x === set.staging.objects.stairs.at.x && p.z === set.staging.objects.stairs.at.z,
    ),
  );
  assert.throws(() => route(set.staging, ground(0, 1, 2), ground(0, 1), 0.3), /support/);
  const raised = {
    ...set.staging,
    objects: {},
    supports: {
      a: { at: ground(0, 0, 2), width: 2, depth: 2 },
      b: { at: ground(2.001, 0, 2), width: 2, depth: 2 },
    },
  };
  assert.throws(() => route(raised, ground(0, 0, 2), ground(2.001, 0, 2), 0.3), /support/);
});

test('an automatic walk up and back down rests on the same treads as explicit climbing', async () => {
  for (const scale of [0.64, 0.8]) {
    const set = courtyard(),
      stairs = set.staging.objects.stairs,
      shape = objectShape.stairs;
    const options = {
      pack: chibi,
      set,
      cast: { hero: { skin: 'mira', scale, at: 'entry' } },
      beats: [
        {
          id: 'up',
          text: 'На площадку',
          seconds: 10,
          perform: [{ action: 'walk', actor: 'hero', to: 'landing' }],
        },
        {
          id: 'down',
          text: 'Во двор',
          seconds: 10,
          perform: [{ action: 'walk', actor: 'hero', to: 'entry' }],
        },
      ],
    };
    const score = compileScore(options),
      subject = await actorWorld(options, score);
    try {
      const records = [];
      for (const [direction, plan] of score.blocking.plans.entries()) {
        for (const step of [1, 3, 5, 7]) {
          const progress = (step + 0.85) / (shape.steps + 1);
          const target =
            (stairEnd(stairs).height - (stairs.at.height ?? 0)) *
              (direction ? 1 - progress : progress) +
            (stairs.at.height ?? 0);
          let lo = plan.start,
            hi = plan.end;
          for (let i = 0; i < 44; i++) {
            const mid = (lo + hi) / 2,
              at = blockAt(score.blocking, mid).actors.hero.at;
            if (at.height < target !== !!direction) lo = mid;
            else hi = mid;
          }
          const time = (lo + hi) / 2,
            frame = blockAt(score.blocking, time).actors.hero;
          assert.equal(frame.travel.steps, shape.steps);
          subject.sample(time, false);
          const pose = subject.snapshot();
          records.push([time, pose]);
          for (const [side, foot] of Object.entries(pose.actors.hero.feet)) {
            const native = data.findBone(chibi.rig.feet[side]).setupPose;
            const rests = Array.from({ length: shape.steps + 1 }, (_, n) => {
              const p =
                n === 0
                  ? stairs.at
                  : n === shape.steps
                    ? stairEnd(stairs)
                    : {
                        x: stairs.at.x,
                        z: stairs.at.z + (n - 0.5) * shape.tread * (stairs.scale ?? 1),
                        height: (stairs.at.height ?? 0) + n * shape.rise * (stairs.scale ?? 1),
                      };
              return project(set.staging.projection, { ...p, x: p.x + (native.x * scale) / 100 });
            });
            const error = Math.min(...rests.map((p) => Math.hypot(p.x - foot.x, p.y - foot.y)));
            assert.ok(
              error < 0.01,
              `${direction ? 'down' : 'up'} ${side}: foot misses tread by ${error}`,
            );
          }
        }
      }
      for (const [time, pose] of records.reverse()) {
        subject.sample(20, true);
        subject.sample(time, false);
        assert.deepEqual(subject.snapshot(), pose, `stair rewind at ${time}`);
      }
    } finally {
      subject.dispose();
    }
  }
});

test('a closed door opens from inside, keeps the handle contact and completes an exit', async () => {
  const set = courtyard(),
    options = {
      pack: chibi,
      set,
      cast: { hero: { skin: 'mira-lab', scale: 0.64, at: 'inside' } },
      beats: routines.leave('leave', 'hero'),
    };
  const score = compileScore(options),
    subject = await actorWorld(options, score);
  try {
    const opening = score.blocking.plans[0];
    for (let p = 0.4; p < 0.8; p += 0.05) {
      subject.sample(opening.start + p * (opening.end - opening.start), false);
      for (const hand of subject.snapshot().actors.hero.contacts)
        assert.ok(hand.error < 1, `inside handle error ${hand.error}`);
    }
    const final = blockAt(score.blocking, score.script.duration);
    assert.ok(final.actors.hero.at.z < set.staging.objects.door.at.z);
    assert.equal(final.objects.door, 0);
  } finally {
    subject.dispose();
  }
});

test('portable art, support surfaces, free hands, device state and bench slots share action owners', async () => {
  const { portable } = await import('../dist/characters/staging/portable.js');
  const set = arrange(readingRoom({ seat: 'bench' }), {
    objects: {
      letter: { ...portable('letter', ground(0, 0)), at: { of: 'sideTable', side: 'on' } },
      meter: { ...portable('instrument', ground(0, 0)), at: { of: 'sideTable', side: 'on' } },
    },
  });
  const actions = [
    [{ action: 'take', actor: 'a', object: 'letter', hand: 'right' }],
    [{ action: 'press', actor: 'a', target: 'meter' }],
    [{ action: 'put', actor: 'a', onto: 'seat' }],
    [
      { action: 'sit', actor: 'a', seat: 'seat' },
      { action: 'sit', actor: 'b', seat: 'seat' },
    ],
  ];
  const options = {
    pack: chibi,
    set,
    cast: {
      a: { skin: 'tesla', at: 'entry' },
      b: { skin: 'mira', at: ground(3.5, 0.2), scale: 0.64 },
    },
    beats: actions.map((perform, i) => ({
      id: `act-${i}`,
      seconds: 4,
      text: 'Взаимодействие',
      perform,
    })),
  };
  const score = compileScore(options),
    subject = await actorWorld(options, score);
  const pressing = [
    {
      id: 'press',
      text: 'Включить',
      seconds: 3,
      perform: [{ action: 'press', actor: 'a', target: 'meter' }],
    },
  ];
  assert.throws(
    () =>
      compileScore({
        ...options,
        cast: { ...options.cast, a: { ...options.cast.a, holdingHand: 'middle' } },
      }),
    /holdingHand/,
  );
  assert.throws(
    () =>
      compileScore({
        ...options,
        beats: [
          {
            ...options.beats[0],
            perform: [{ action: 'take', actor: 'a', object: 'letter', hand: 'middle' }],
          },
        ],
      }),
    /taking hand/,
  );
  assert.equal(
    compileScore({
      ...options,
      cast: { ...options.cast, a: { ...options.cast.a, holdingHand: 'right' } },
      beats: [{ ...options.beats[0], perform: [{ action: 'take', actor: 'a', object: 'letter' }] }],
    }).blocking.plans[0].to.a.holdingHand,
    'right',
  );
  assert.throws(
    () =>
      compileScore({
        ...options,
        cast: { ...options.cast, b: { ...options.cast.b, holding: 'meter' } },
        beats: pressing,
      }),
    /Put object meter/,
  );
  for (const perform of [
    [{ action: 'take', actor: 'b', object: 'meter' }, ...pressing[0].perform],
    [...pressing[0].perform, { action: 'take', actor: 'b', object: 'meter' }],
  ])
    assert.throws(
      () => compileScore({ ...options, beats: [{ ...pressing[0], perform }] }),
      /Put object meter/,
    );
  const relocated = compileScore({
    ...options,
    cast: { ...options.cast, a: { ...options.cast.a, holding: 'meter' } },
    beats: [
      {
        id: 'put',
        text: 'Поставить',
        seconds: 3,
        perform: [{ action: 'put', actor: 'a', onto: 'seat' }],
      },
      ...pressing,
    ],
  });
  assert.deepEqual(
    relocated.blocking.plans[1].target,
    triggerPoint({ ...set.staging.objects.meter, at: supportPoint(set.staging.objects.seat) }),
  );
  try {
    const taken = blockAt(score.blocking, 4).actors.a;
    assert.equal(taken.holding, 'letter');
    assert.equal(taken.hands, 1);
    assert.equal(taken.holdingHand, 'right');
    assert.equal(blockAt(score.blocking, 5.9).objects.meter, 0);
    assert.equal(blockAt(score.blocking, 6.1).objects.meter, 1);
    const final = blockAt(score.blocking, 16);
    assert.equal(final.actors.a.holding, undefined);
    assert.equal(final.actors.a.seatSlot, 0);
    assert.equal(final.actors.b.seatSlot, 1);
    assert.ok(Math.abs(final.actors.a.at.x - final.actors.b.at.x) > 1);
    const times = [0, 2.4, 3.999, 4, 6.4, 8, 10.3, 12, 15.99, 16];
    const expected = times.map((t) => {
      subject.sample(t, false);
      return subject.snapshot();
    });
    for (const [i, t] of [...times.entries()].reverse()) {
      subject.sample(t, false);
      assert.deepEqual(subject.snapshot(), expected[i]);
    }
    subject.sample(6.4, false);
    const hands = subject.snapshot().actors.a.contacts;
    assert.equal(new Set(hands.map((h) => h.side)).size, 2, 'carry and press use different hands');
    for (const hand of hands) assert.ok(hand.error < 1, `${hand.kind} error: ${hand.error}`);
  } finally {
    subject.dispose();
  }
});

test('press plans reachable shoulders for different support heights, free hands and mirrored rigs', async () => {
  const { portable } = await import('../dist/characters/staging/portable.js');
  for (const tableScale of [0.55, 0.8]) {
    const set = arrange(readingRoom(), {
      objects: {
        book: null,
        sideTable: { scale: tableScale },
        letter: { ...portable('letter', ground(0, 0)), at: { of: 'sideTable', side: 'on' } },
        meter: { ...portable('instrument', ground(0, 0)), at: { of: 'sideTable', side: 'on' } },
      },
    });
    for (const scale of [0.64, 0.8])
      for (const holdingHand of ['left', 'right'])
        for (const flip of [false, true]) {
          const actor = {
            skin: scale === 0.64 ? 'mira-scholar' : 'tesla-workshop',
            at: 'entry',
            scale,
            holding: 'letter',
            holdingHand,
            flip,
          };
          const options = {
            pack: chibi,
            set,
            background: false,
            cast: { hero: actor },
            beats: [
              {
                id: 'sit',
                seconds: 1,
                text: 'Сесть перед опытом',
                perform: [{ action: 'sit', actor: 'hero', seat: 'seat' }],
              },
              {
                id: 'press',
                seconds: 4,
                text: 'Включить прибор',
                perform: [{ action: 'press', actor: 'hero', target: 'meter' }],
              },
            ],
          };
          const score = compileScore(options);
          const perf = performance(
            data,
            chibi,
            actor,
            score.tracks.hero,
            project(set.staging.projection, destination(set.staging, actor.at)),
            set.height,
          );
          const subject = await world(options, score.blocking, { hero: perf }, undefined);
          try {
            const expected = [];
            for (const time of [2.8, 2.9, 3.1, 3.6, 4.1]) {
              subject.sample(time, false);
              const snapshot = subject.snapshot();
              assert.equal(snapshot.actors.hero.seated, 0, 'stand up before reaching the control');
              const contact = snapshot.actors.hero.contacts.find((c) => c.kind === 'press');
              assert.ok(contact, 'press remains a gesture after its short push impulse');
              assert.notEqual(contact.side, holdingHand);
              assert.ok(
                contact.error < 0.01,
                `press contact ${tableScale}/${scale}/${holdingHand}/${flip}: ${contact.error}`,
              );
              const elbow = perf.skeleton.findBone(chibi.rig.arms[contact.side].lower).appliedPose;
              const shoulder = perf.skeleton.findBone(
                chibi.rig.arms[contact.side].upper,
              ).appliedPose;
              assert.ok(
                set.height - elbow.worldY > (set.height - shoulder.worldY + contact.target.y) / 2,
                'the forearm reaches from below without covering the readout',
              );
              expected.push([time, snapshot]);
            }
            for (const [time, snapshot] of expected.reverse()) {
              subject.sample(5, true);
              subject.sample(time, false);
              assert.deepEqual(subject.snapshot(), snapshot);
            }
          } finally {
            subject.dispose();
          }
        }
    for (const height of [-10, 20])
      assert.throws(
        () =>
          compileScore({
            pack: chibi,
            set,
            cast: { hero: { skin: 'tesla', at: 'entry' } },
            beats: [
              {
                id: 'unreachable',
                seconds: 4,
                text: 'Нажать',
                perform: [{ action: 'press', actor: 'hero', target: ground(0, 2, height) }],
              },
            ],
          }),
        /Cannot reach a press control at height/,
      );
  }
});
