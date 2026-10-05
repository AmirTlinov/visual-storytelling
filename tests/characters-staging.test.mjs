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
import { readingRoom, teachingRoom, courtyard } from '../dist/characters/staging/sets.js';
import { doorway, doorHandle, doorPassage } from '../dist/characters/staging/doorway.js';
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

test('room width preserves world placement and keeps projected marks inside the set', () => {
  for (const room of [readingRoom, teachingRoom]) {
    for (const perspective of ['stage', 'overview']) {
      const base = room({ perspective }),
        wide = room({ perspective, width: 1680 });
      assert.deepEqual(room({ perspective, width: 960 }), base);
      assert.equal(wide.width, 1680);
      assert.equal(wide.height, base.height);
      assert.deepEqual(wide.staging.objects, base.staging.objects);
      assert.deepEqual(wide.staging.spots, base.staging.spots);
      for (const [id, point] of Object.entries(base.spots)) {
        assert.ok(Math.abs(wide.spots[id].x - point.x - 360) < 1e-10, id);
        assert.equal(wide.spots[id].y, point.y, id);
        assert.equal(wide.spots[id].scale, point.scale, id);
        assert.ok(point.x >= 0 && point.x <= base.width, id);
        assert.ok(wide.spots[id].x >= 0 && wide.spots[id].x <= wide.width, id);
      }
    }
    for (const width of [640, 959, NaN, Infinity])
      assert.throws(() => room({ width }), /at least 960 drawing units/);
  }
});

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
      /Unknown held portable object/,
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
  // Isolate a height-only transfer to a seat on a raised platform.
  // A chair rests on the same supported floor as the reader.
  const blocking = compileScore(options).blocking;
  const baseline = new Map(
    [0, 1, 2, 3, 4, 5.1, 6, 7, 8, 9, 10].map((t) => [t, blockAt(blocking, t)]),
  );
  for (const t of [10, 1, 7, 4, 9, 0, 6, 3, 8, 2, 5.1])
    assert.deepEqual(blockAt(blocking, t), baseline.get(t));
  for (const t of [4, 6, 10]) {
    const a = blockAt(blocking, t).actors.a;
    assert.equal(a.travel, undefined, `no stale travel at ${t}`);
    assert.equal(a.holding, 'book');
  }
  assert.equal(blockAt(blocking, 8).actors.a.travel.progress, 0, 'the next walk starts a new path');
  assert.equal(blockAt(blocking, 6).actors.a.facing, 'front');
  assert.equal(
    blockAt(blocking, 8).actors.a.at.height ?? 0,
    0,
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
    scene([beat({ action: 'walkTogether', actors: ['a', 'b'], to: ground(0, 2) })]),
  ).blocking;
  for (const id of ['a', 'b']) assert.equal(blockAt(pair, 2).actors[id].at.height ?? 0, 0);
  assert.ok(Math.abs(blockAt(pair, 2 - 1e-5).actors.a.at.height ?? 0) < 1e-8);
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
  assert.throws(() => compileScore(vertical), /support/);
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
    for (const b of Object.values(bodies))
      if (b.frame.holding) b.book(b.frame.holding, '#855057', frame.objects[b.frame.holding]);
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
    beat({ action: 'flee', actor: 'a', to: ground(2.7, -0.6) }),
    beat({ action: 'openDoor', actor: 'a', door: 'door' }),
    beat({ action: 'climb', actor: 'a', stairs: 'stairs' }),
    beat({ action: 'descend', actor: 'a', stairs: 'stairs' }),
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
    const options = scene([beat(action)]),
      plan = compileScore(options).blocking.plans[0];
    const t = plan.timing,
      total = Object.values(t).reduce((n, v) => n + v, 0);
    const time =
      plan.start + ((plan.end - plan.start) * (t.rise + t.approach + t.engage + t.act / 2)) / total;
    const contact = performer(options)(time);
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

test('an opened entrance guides different actors around its leaf and through the same clear threshold', () => {
  const open = { action: 'openDoor', actor: 'a', door: 'door' },
    enter = { action: 'passDoor', actor: 'a', door: 'door', to: 'inside' },
    leave = { ...enter, to: 'outside', gait: 'run' },
    run = { action: 'flee', actor: 'a', to: 'stairs' };
  const entranceScene = (
    skin,
    scale,
    entranceScale,
    beats = [beat(open), beat(enter), beat(leave), beat(run)],
  ) => ({
    pack,
    set: courtyard({ entranceScale }),
    cast: { a: { skin, at: 'entry', scale } },
    beats: beats.map((b, i) => ({ ...b, id: `door-${i}` })),
  });
  const separation = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  for (const [skin, scale, entranceScale] of [
    ['mira', 0.64, 1],
    ['tesla', 0.8, 1.08],
  ]) {
    const options = entranceScene(skin, scale, entranceScale),
      blocking = compileScore(options).blocking,
      door = options.set.staging.objects.door,
      sample = performer(options),
      hinge = { x: door.at.x - (doorway.width * entranceScale) / 2, z: door.at.z };
    const halfStance = Math.max(
      ...Object.values(pack.rig.feet).map(
        (name) => (Math.abs(data.findBone(name).setupPose.x) * scale) / 100,
      ),
    );
    const clearance = (at, open) => {
      const angle = -open * doorway.swing,
        leaf = {
          x: Math.cos(angle) * doorway.width * entranceScale,
          z: Math.sin(angle) * doorway.width * entranceScale,
        },
        u = Math.max(
          0,
          Math.min(
            1,
            ((at.x - hinge.x) * leaf.x + (at.z - hinge.z) * leaf.z) / (leaf.x ** 2 + leaf.z ** 2),
          ),
        );
      return separation(at, { x: hinge.x + u * leaf.x, z: hinge.z + u * leaf.z });
    };

    // The actor pulls from the free edge; the facade plane is never crossed during opening.
    for (let i = 0; i <= 100; i++) {
      const time = i * 0.02,
        frame = blockAt(blocking, time),
        actor = frame.actors.a;
      assert.ok(actor.at.z < door.at.z, `${skin}: opening stays outside the facade`);
      if (time >= 0.7 && time < 2) {
        assert.ok(
          clearance(actor.at, frame.objects.door) > halfStance,
          `${skin}: stance intersects swinging leaf @ ${time}`,
        );
      }
      if (actor.reaches?.some((reach) => reach.weight === 1)) {
        const target = project(
            options.set.staging.projection,
            doorHandle(door, frame.objects.door),
          ),
          contacts = sample(time).a.contacts;
        assert.equal(contacts.length, 1, 'the gripping hand follows the real handle');
        assert.ok(
          Math.hypot(contacts[0].target.x - target.x, contacts[0].target.y - target.y) < 1e-6,
        );
        assert.ok(contacts[0].error < 0.01, `${skin}: handle contact error @ ${time}`);
      }
    }

    for (const [start, end, side, direction] of [
      [2, 4, 'inside', 1],
      [4, 6, 'outside', -1],
    ]) {
      let previous = blockAt(blocking, start).actors.a.at,
        crossings = 0;
      for (let i = 1; i <= 100; i++) {
        const time = start + ((end - start) * i) / 100,
          actor = blockAt(blocking, time).actors.a,
          at = actor.at;
        assert.ok(
          direction * (at.z - previous.z) >= -1e-9,
          `${skin}: passage does not double back`,
        );
        if ((previous.z - door.at.z) * (at.z - door.at.z) <= 0) {
          const alpha = (door.at.z - previous.z) / (at.z - previous.z),
            x = previous.x + (at.x - previous.x) * alpha;
          assert.ok(Math.abs(x - door.at.x) < 1e-8, `${skin}: cross the opening, not the wall`);
          crossings++;
        }
        if (actor.facing === 'front' || actor.facing === 'back') {
          const pose = sample(time).a;
          for (const [side, leg] of Object.entries(pack.rig.legs)) {
            const lower = data.findBone(leg.lower),
              bone = pose.bones[data.bones.indexOf(lower)],
              ankle = {
                x: bone[4] + bone[0] * lower.length,
                y: options.set.height - bone[5] - bone[2] * lower.length,
              };
            assert.ok(
              Math.hypot(ankle.x - pose.feet[side].x, ankle.y - pose.feet[side].y) < 0.01,
              `${skin}: perspective stride loses the ${side} foot target @ ${time}`,
            );
          }
        }
        previous = at;
      }
      assert.equal(crossings, 1, `${skin}: one threshold crossing towards ${side}`);
      assert.deepEqual(blockAt(blocking, end).actors.a.at, doorPassage(door, side));
      assert.ok(separation(blockAt(blocking, end - 1e-5).actors.a.at, previous) < 1e-7);
    }
    assert.equal(blockAt(blocking, 5).actors.a.travel.running, true);
    for (let i = 0; i <= 100; i++) {
      const time = 6 + i * 0.02,
        frame = blockAt(blocking, time);
      assert.ok(
        clearance(frame.actors.a.at, frame.objects.door) > halfStance,
        `${skin}: leave enough clearance to run sideways past the open leaf @ ${time}`,
      );
    }
    assert.equal(blockAt(blocking, 8).actors.a.travel, undefined);
    const times = [0, 0.76, 1.13, 1.6, 2, 2.5, 3.28, 3.99999, 4, 5.1, 6, 6.8, 8],
      expected = times.map((time) => sample(time));
    for (const [i, time] of [...times.entries()].reverse()) {
      sample(time, true);
      assert.deepEqual(sample(time), expected[i], `${skin}: native door-route rewind @ ${time}`);
    }
  }

  assert.throws(() => compileScore(entranceScene('mira', 0.64, 1, [beat(enter)])), /Open door/);
  // Actions within one beat are simultaneous: their array order cannot make a closed door passable.
  for (const actions of [
    [open, { ...enter, actor: 'b' }],
    [{ ...enter, actor: 'b' }, open],
  ]) {
    const options = entranceScene('mira', 0.64, 1, [beat(...actions)]);
    options.cast.b = { skin: 'tesla', at: 'entry', scale: 0.8 };
    assert.throws(() => compileScore(options), /Open door/);
  }
  for (const beats of [
    [beat(open), beat(enter), beat(enter)],
    [beat(open), beat(leave)],
  ]) {
    const score = compileScore(entranceScene('mira', 0.64, 1, beats));
    const end = score.script.duration;
    assert.ok(
      separation(
        blockAt(score.blocking, end - 1e-5).actors.a.at,
        blockAt(score.blocking, end).actors.a.at,
      ) < 1e-7,
    );
  }

  const competing = entranceScene('mira', 0.64, 1, [
    beat(open),
    beat(enter, { ...leave, actor: 'b' }),
  ]);
  competing.cast.b = { skin: 'tesla', at: 'inside', scale: 0.8 };
  assert.throws(() => compileScore(competing), /Two actions own object door/);

  const seated = entranceScene('mira', 0.64, 1, [
    beat(open),
    beat({ action: 'sit', actor: 'a', seat: 'seat' }),
    beat(enter),
  ]);
  seated.set.staging.objects.seat = {
    kind: 'chair',
    at: doorPassage(seated.set.staging.objects.door, 'outside'),
  };
  const standing = compileScore(seated).blocking;
  assert.equal(blockAt(standing, 4).actors.a.seated, 1);
  assert.ok(blockAt(standing, 4.1).actors.a.seated < 1);
  assert.ok(blockAt(standing, 4.1).actors.a.seated > 0);
  assert.equal(blockAt(standing, 4.4).actors.a.seated, 0);
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
  assert.equal(blockAt(blocking, 0).actors.a.holding, undefined);
  assert.equal(blockAt(blocking, 2).actors.a.holding, 'book');
  assert.equal(blockAt(blocking, 6).actors.a.holding, undefined);
  assert.equal(blockAt(blocking, 8).actors.b.holding, 'book');
  const resting = blockAt(blocking, 6).items.book;
  assert.equal(resting.x, options.set.staging.objects.sideTable.at.x);
  assert.ok(resting.height > options.set.staging.objects.sideTable.at.height);
  assert.deepEqual(blockAt(blocking, 6).actors.b.transfer.at, resting);
  assert.deepEqual(blockAt(blocking, 10).items.book, resting);
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
    const before = subject.snapshot().items.a;
    subject.sample(2, false);
    const after = subject.snapshot().items.a;
    assert.ok(
      Math.hypot(after.x - before.x, after.y - before.y) < 0.01,
      'take ends without teleporting the book',
    );
    subject.sample(5.99999, false);
    const put = subject.snapshot().items.a,
      position = project(options.set.staging.projection, resting);
    assert.ok(
      Math.hypot(put.x - position.x, put.y - position.y) < 0.01,
      'put ends at the same resting book position',
    );
    subject.sample(6, false);
    assert.equal(
      subject.snapshot().items.a,
      undefined,
      'the actor no longer draws a released book',
    );
    for (const plan of blocking.plans.filter((p) => p.transfer)) {
      const t = plan.timing,
        factor = (plan.end - plan.start) / Object.values(t).reduce((n, v) => n + v, 0);
      const start = plan.transfer.taking
        ? plan.start + (t.rise + t.approach + t.engage) * factor
        : plan.start;
      const end = plan.transfer.taking ? plan.end : plan.end - t.release * factor;
      for (let time = start; time <= end; time += 0.03) {
        subject.sample(time, false);
        for (const pose of Object.values(subject.snapshot().actors))
          for (const hand of pose.contacts)
            assert.ok(hand.error < 1, `a full-grip transfer misses by ${hand.error} at ${time}`);
      }
    }
  } finally {
    subject.dispose();
    reference.dispose();
  }

  for (const [actions, held, error] of [
    [[{ action: 'put', actor: 'a', onto: 'sideTable' }], false, /no object to put/],
    [[{ action: 'take', actor: 'b', object: 'book' }], true, /already has a holder/],
    [[{ action: 'take', actor: 'a', object: 'book' }], true, /already holds an object/],
    [[{ action: 'put', actor: 'a', onto: 'plant' }], true, /no support surface/],
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
