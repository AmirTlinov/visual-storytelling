import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { compileCharacterPack } from '../tools/characters/compile.mjs';
import { compileScore } from '../dist/characters/score.js';
import { blockAt } from '../dist/characters/staging/motion.js';
import { body, connect } from '../dist/characters/staging/pose.js';
import { world } from '../dist/characters/staging/world.js';
import { ground, project } from '../dist/characters/staging/space.js';
import { readingRoom } from '../dist/characters/staging/sets.js';
import { performance, readSkeleton } from '../dist/characters/performance.js';

const template = fileURLToPath(new URL('../src/assets/characters/chibi', import.meta.url));
const pack = await compileCharacterPack(template, [template + '/tesla', template + '/mira']);
const source = JSON.parse(gunzipSync(Buffer.from(pack.gzip, 'base64')));
const { data } = readSkeleton(source);
const beat = (...perform) => ({ id: 'action', seconds: 2, text: 'A visible action.', perform });
function scene(beats = [beat()]) {
  const set = readingRoom();
  set.staging.objects = {
    ...set.staging.objects,
    door: { kind: 'door', at: ground(2.5, 4) },
    stairs: { kind: 'stairs', at: ground(-2, 1) },
  };
  return {
    pack,
    set,
    cast: { a: { skin: 'tesla', at: 'entry' }, b: { skin: 'mira', at: 'partner', scale: 0.64 } },
    beats: beats.map((b, i) => ({ ...b, id: `beat-${i}` })),
  };
}

test('view skins retain their own artwork while preserving native rig and mesh dependencies', async () => {
  const rig = JSON.parse(await readFile(template + '/rig.json', 'utf8'));
  for (const key of ['bones', 'slots', 'constraints', 'animations'])
    assert.deepEqual(source.data[key], rig[key], key);
  for (const name of ['tesla', 'mira']) {
    const skin = source.data.skins.find((s) => s.name === pack.viewSkins[name].back);
    const paths = Object.values(skin.attachments).flatMap((slot) =>
      Object.values(slot).map((a) => a.path),
    );
    assert.ok(
      paths.includes(`${name}@back/nate/body`),
      `${name}: native back view has its own body`,
    );
    assert.ok(
      paths.includes(`${name}@back/nate/head-base`),
      `${name}: inherited parts stay in its own skin`,
    );
    assert.equal(
      paths.some((path) => path?.startsWith('tesla/')),
      false,
    );
  }
});

test('prepared actions reject invalid participants, places and competing physical owners', () => {
  const cases = [
    [
      (s) => {
        s.beats[0].perform = [{ action: 'fly', actor: 'a' }];
      },
      /Unknown prepared action/,
    ],
    [
      (s) => {
        s.beats[0].perform = [{ action: 'walk', actor: 'missing', to: 'entry' }];
      },
      /Unknown action participant/,
    ],
    [
      (s) => {
        s.beats[0].perform = [{ action: 'walk', actor: 'a', to: 'constructor' }];
      },
      /stage destination/,
    ],
    [
      (s) => {
        s.beats[0].perform = [{ action: 'highFive', actors: ['a'] }];
      },
      /exactly two/,
    ],
    [
      (s) => {
        s.beats[0].perform = [{ action: 'highFive', actors: ['a', 'a'] }];
      },
      /distinct participants/,
    ],
    [
      (s) => {
        s.beats[0].perform = [
          { action: 'stand', actor: 'a' },
          { action: 'walk', actor: 'a', to: 'exit' },
        ];
      },
      /Two actions own a/,
    ],
    [
      (s) => {
        s.cast.a.holding = s.cast.b.holding = 'book';
      },
      /already has a holder/,
    ],
    [
      (s) => {
        s.cast.a.holding = 'seat';
      },
      /Unknown held book/,
    ],
    [
      (s) => {
        s.beats[0].perform = [{ action: 'read', actor: 'a', book: 'book' }];
      },
      /reader must hold/,
    ],
    [
      (s) => {
        s.cast.a.holding = 'book';
        s.beats[0].perform = [{ action: 'highFive', actors: ['a', 'b'] }];
      },
      /free hands/,
    ],
    [
      (s) => {
        s.cast.a.holding = 'book';
        s.beats[0].perform = [{ action: 'openDoor', actor: 'a', door: 'door' }];
      },
      /free hand/,
    ],
    [
      (s) => {
        s.beats[0].perform = ['a', 'b'].map((actor) => ({ action: 'sit', actor, seat: 'seat' }));
      },
      /occupied by two/,
    ],
    [
      (s) => {
        s.beats[0].perform = ['a', 'b'].map((actor) => ({
          action: 'openDoor',
          actor,
          door: 'door',
        }));
      },
      /Two actions own object/,
    ],
    [
      (s) => {
        s.set.staging.objects.plant.scale = -1;
      },
      /Invalid object scale/,
    ],
    [
      (s) => {
        s.set.staging.objects.plant.at.x = NaN;
      },
      /stage destination/,
    ],
    [
      (s) => {
        s.set.staging.projection.unit = 0;
      },
      /Stage projection/,
    ],
  ];
  for (const [change, expected] of cases) {
    const options = scene();
    change(options);
    assert.throws(() => compileScore(options), expected);
  }
  const swapping = scene([
    beat({ action: 'sit', actor: 'a', seat: 'seat' }),
    beat({ action: 'sit', actor: 'b', seat: 'seat' }, { action: 'stand', actor: 'a' }),
  ]);
  assert.doesNotThrow(() => compileScore(swapping), 'seat ownership changes within the same beat');
});

test('completed plans clear transient movement and preserve book, facing and platform height', () => {
  const options = scene([
    beat({ action: 'walk', actor: 'a', to: 'reader' }),
    beat({ action: 'sit', actor: 'a', seat: 'seat' }),
    beat({ action: 'read', actor: 'a', book: 'book', pages: 2 }),
    beat({ action: 'stand', actor: 'a' }),
    beat({ action: 'walk', actor: 'a', to: 'exit' }),
  ]);
  options.cast.a.holding = 'book';
  options.set.staging.objects.seat.at.height = 1.5;
  const blocking = compileScore(options).blocking;
  const baseline = new Map(
    [0, 1, 2, 3, 4, 5.1, 6, 7, 8, 9, 10].map((t) => [t, blockAt(blocking, t)]),
  );
  for (const t of [10, 1, 7, 4, 9, 0, 6, 3, 8, 2, 5.1])
    assert.deepEqual(blockAt(blocking, t), baseline.get(t));
  for (const t of [4, 6, 10]) {
    const a = blockAt(blocking, t).actors.a;
    assert.equal(a.travel, undefined, `no stale travel at ${t}`);
    assert.equal(a.book, 'book');
  }
  assert.equal(
    blockAt(blocking, 2).actors.a.travel.length,
    1.5,
    'sitting starts a new path up to the platform',
  );
  assert.equal(blockAt(blocking, 8).actors.a.travel.progress, 0, 'the next walk starts a new path');
  assert.equal(blockAt(blocking, 6).actors.a.facing, 'front');
  assert.equal(
    blockAt(blocking, 8).actors.a.at.height,
    1.5,
    'standing stays on the chair’s platform',
  );
  for (const [start, end] of [
    [0, 2],
    [2, 4],
    [4, 6],
    [6, 8],
    [8, 10],
  ])
    assert.deepEqual(
      blockAt(blocking, start + 0.1, true).actors.a,
      blocking.plans.find((p) => p.end === end).to.a,
    );
  for (const t of [NaN, Infinity]) assert.throws(() => blockAt(blocking, t), /time must be finite/);

  const pair = compileScore(
    scene([beat({ action: 'walkTogether', actors: ['a', 'b'], to: ground(0, 2, 1.5) })]),
  ).blocking;
  for (const id of ['a', 'b']) assert.equal(blockAt(pair, 2).actors[id].at.height, 1.5);
  assert.ok(Math.abs(blockAt(pair, 2 - 1e-5).actors.a.at.height - 1.5) < 1e-8);
  const standingReader = scene([
    beat({ action: 'walk', actor: 'a', to: 'exit' }),
    beat({ action: 'read', actor: 'a', book: 'book' }),
  ]);
  standingReader.cast.a.holding = 'book';
  const reading = compileScore(standingReader).blocking;
  assert.equal(blockAt(reading, 3.99999).actors.a.facing, 'front');
  assert.equal(
    blockAt(reading, 4).actors.a.facing,
    'front',
    'read retains its facing after the cue',
  );

  const vertical = scene([beat({ action: 'walk', actor: 'a', to: ground(-3.5, 1, 2) })]);
  const rising = compileScore(vertical).blocking;
  assert.equal(blockAt(rising, 0).actors.a.at.height, 0, 'a height-only path does not teleport');
  assert.equal(blockAt(rising, 1).actors.a.at.height, 1);
  assert.equal(blockAt(rising, 2).actors.a.at.height, 2);
});

function performer(options) {
  const score = compileScore(options);
  const bodies = Object.fromEntries(
    Object.entries(options.cast).map(([id, actor]) => {
      const perf = performance(
        data,
        pack,
        actor,
        score.tracks[id],
        options.set.spots[actor.at],
        options.set.height,
      );
      return [id, body(perf, actor, pack.rig, options.set.staging.projection, options.set.height)];
    }),
  );
  return (time, reduced = false) => {
    const frame = blockAt(score.blocking, time, reduced);
    for (const [id, b] of Object.entries(bodies)) b.sample(time, frame.actors[id], reduced);
    for (const pair of frame.pairs) connect(bodies, pair);
    for (const b of Object.values(bodies)) if (b.frame.book) b.book(b.frame.book, '#855057');
    return Object.fromEntries(
      Object.entries(bodies).map(([id, b]) => [
        id,
        {
          ...b.snapshot(),
          skin: b.perf.skeleton.skin.name,
          bones: b.perf.skeleton.bones.map((bone) => {
            const p = bone.appliedPose;
            const values = [p.a, p.b, p.c, p.d, p.worldX, p.worldY];
            assert.ok(values.every(Number.isFinite), `${id}/${bone.data.name}@${time}`);
            return values;
          }),
          slots: b.perf.skeleton.slots.map((slot) => [
            slot.appliedPose.attachment?.name,
            slot.appliedPose.color.a,
          ]),
          drawOrder: b.perf.skeleton.drawOrder.appliedPose.map((slot) => slot.data.name),
        },
      ]),
    );
  };
}

test('native prepared poses, view skins and contacts survive backward seeks and reduced-motion toggles', () => {
  const options = scene([
    beat({ action: 'walk', actor: 'a', to: 'exit' }),
    beat({ action: 'run', actor: 'a', to: 'entry' }),
    beat({ action: 'flee', actor: 'a', to: 'partner' }),
    beat({ action: 'openDoor', actor: 'a', door: 'door' }),
    beat({ action: 'climb', actor: 'a', stairs: 'stairs' }),
    beat({ action: 'point', actor: 'a', target: ground(0, 1, 2) }),
    beat({ action: 'press', actor: 'a', target: ground(0, 1, 2) }),
    beat({ action: 'highFive', actors: ['a', 'b'] }),
    beat({ action: 'walkTogether', actors: ['a', 'b'], to: ground(0, 2) }),
    beat(),
  ]);
  const sample = performer(options);
  const times = options.beats.flatMap((_, i) => [
    i * 2,
    i * 2 + 0.31,
    i * 2 + 1.19,
    i * 2 + 1.99999,
  ]);
  const expected = times.map((t) => performer(options)(t));
  for (const index of [...times.keys()]
    .reverse()
    .concat([...times.keys()].map((i) => (i * 17) % times.length))) {
    sample(times[index], true);
    assert.deepEqual(sample(times[index]), expected[index], `native rewind @ ${times[index]}`);
  }
  assert.equal(sample(9.2).a.skin, pack.viewSkins.tesla.back);
  assert.equal(sample(1.2).a.skin, 'tesla');
  for (const action of [
    { action: 'openDoor', actor: 'a', door: 'door' },
    { action: 'highFive', actors: ['a', 'b'] },
    { action: 'walkTogether', actors: ['a', 'b'], to: ground(0, 2) },
  ]) {
    const contact = performer(scene([beat(action)]))(1.2);
    for (const pose of Object.values(contact))
      for (const hand of pose.contacts)
        assert.ok(
          hand.error < 0.01,
          `${action.action}: full-weight contact misses by ${hand.error}`,
        );
  }
  const read = scene([
    beat({ action: 'sit', actor: 'a', seat: 'seat' }),
    beat({ action: 'read', actor: 'a', book: 'book' }),
  ]);
  read.cast.a.holding = 'book';
  const reader = performer(read),
    reading = reader(3.1);
  reader(0.1);
  reader(3.8, true);
  assert.deepEqual(reader(3.1), reading);
  for (let time = 2; time < 4; time += 0.03)
    for (const hand of reader(time).a.contacts)
      assert.ok(hand.error < 1, `a reading hand misses the page by ${hand.error}`);
});

test('projection preserves metric height and rejects non-finite geometry', () => {
  const space = readingRoom().staging.projection;
  const a = project(space, ground(1, 3)),
    b = project(space, ground(1, 3, 1));
  assert.equal(a.y - b.y, space.unit * a.scale);
  for (const invalid of [ground(NaN, 0), ground(0, -space.distance), ground(0, 0, Infinity)])
    assert.throws(() => project(space, invalid));
});

test('take and put preserve one book owner and its last resting place across rewinds', async () => {
  const options = scene([
    beat({ action: 'take', actor: 'a', object: 'book' }),
    beat({ action: 'read', actor: 'a', book: 'book' }),
    beat({ action: 'put', actor: 'a', onto: 'sideTable' }),
    beat({ action: 'take', actor: 'b', object: 'book' }),
    beat({ action: 'put', actor: 'b', onto: 'sideTable' }),
    beat(),
  ]);
  const score = compileScore(options),
    blocking = score.blocking;
  assert.equal(blockAt(blocking, 0).actors.a.book, undefined);
  assert.equal(blockAt(blocking, 2).actors.a.book, 'book');
  assert.equal(blockAt(blocking, 6).actors.a.book, undefined);
  assert.equal(blockAt(blocking, 8).actors.b.book, 'book');
  const resting = blockAt(blocking, 6).books.book;
  assert.equal(resting.x, options.set.staging.objects.sideTable.at.x);
  assert.ok(resting.height > options.set.staging.objects.sideTable.at.height);
  assert.deepEqual(blockAt(blocking, 6).actors.b.transfer.at, resting);
  assert.deepEqual(blockAt(blocking, 10).books.book, resting);
  const times = [0, 0.7, 1.25, 1.99999, 2, 4, 5.6, 5.99999, 6, 7.9, 8, 9.5, 10];
  const fresh = times.map((t) => blockAt(blocking, t));
  for (const [i, t] of [...times.entries()].reverse())
    assert.deepEqual(blockAt(blocking, t), fresh[i]);

  // The real world sampler needs no graphics resources for a transparent cast.
  const makeWorld = () =>
    world(
      { ...options, background: false },
      blocking,
      Object.fromEntries(
        Object.entries(options.cast).map(([id, actor]) => [
          id,
          performance(
            data,
            pack,
            actor,
            score.tracks[id],
            options.set.spots[actor.at],
            options.set.height,
          ),
        ]),
      ),
      undefined,
    );
  const subject = await makeWorld(),
    reference = await makeWorld();
  try {
    const expected = times.map((t) => {
      reference.sample(t, false);
      return reference.snapshot();
    });
    for (const [i, t] of [...times.entries()].reverse()) {
      subject.sample(t, true);
      subject.sample(t, false);
      assert.deepEqual(subject.snapshot(), expected[i], `native transfer rewind @ ${t}`);
    }
    subject.sample(1.99999, false);
    const before = subject.snapshot().books.a;
    subject.sample(2, false);
    const after = subject.snapshot().books.a;
    assert.ok(
      Math.hypot(after.x - before.x, after.y - before.y) < 0.01,
      'take ends without teleporting the book',
    );
    subject.sample(5.99999, false);
    const put = subject.snapshot().books.a,
      position = project(options.set.staging.projection, resting);
    assert.ok(
      Math.hypot(put.x - position.x, put.y - position.y) < 0.01,
      'put ends at the same resting book position',
    );
    subject.sample(6, false);
    assert.equal(
      subject.snapshot().books.a,
      undefined,
      'the actor no longer draws a released book',
    );
    for (const [start, end] of [
      [0.96, 2],
      [4, 5.66],
      [6.96, 8],
      [8, 9.66],
    ])
      for (let time = start; time <= end; time += 0.03) {
        subject.sample(time, false);
        for (const pose of Object.values(subject.snapshot().actors))
          for (const hand of pose.contacts)
            assert.ok(hand.error < 1, `a full-grip transfer misses by ${hand.error} at ${time}`);
      }
  } finally {
    subject.dispose();
    reference.dispose();
  }

  for (const [actions, held, error] of [
    [[{ action: 'put', actor: 'a', onto: 'sideTable' }], false, /no book to put/],
    [[{ action: 'take', actor: 'b', object: 'book' }], true, /already has a holder/],
    [[{ action: 'take', actor: 'a', object: 'book' }], true, /already holds a book/],
    [[{ action: 'put', actor: 'a', onto: 'seat' }], true, /must be table/],
    [
      [
        { action: 'put', actor: 'a', onto: 'sideTable' },
        { action: 'take', actor: 'b', object: 'book' },
      ],
      true,
      /Two actions own object/,
    ],
  ]) {
    const invalid = scene([beat(...actions)]);
    if (held) invalid.cast.a.holding = 'book';
    assert.throws(() => compileScore(invalid), error);
  }
});
