import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chibi } from '../dist/characters/packs/chibi.js';
import { compileScore } from '../dist/characters/score.js';
import { blockAt } from '../dist/characters/staging/motion.js';
import { readingRoom } from '../dist/characters/staging/sets.js';
import { portable } from '../dist/characters/staging/portable.js';
import { ground } from '../dist/characters/staging/space.js';

function scene(at = ground(-4, 1)) {
  const room = readingRoom();
  return {
    pack: chibi,
    set: {
      ...room,
      staging: {
        ...room.staging,
        spots: {},
        layout: undefined,
        objects: { switch: portable('instrument', ground(0, 2, 1.1)) },
      },
    },
    cast: { hero: { skin: 'tesla', at } },
    props: { lamp: { art: { svg: '' }, at: { x: 500, y: 200 }, values: { light: 0 } } },
    beats: [
      {
        id: 'press',
        text: 'Замкнуть цепь',
        perform: [{ action: 'press', actor: 'hero', target: 'switch' }],
        props: { lamp: { on: { press: 'switch' }, over: 0.25, values: { light: 1 } } },
      },
    ],
  };
}
const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
function contact(score, index = 0, delay = 0) {
  const key = score.propTracks.lamp[index],
    time = key.start - delay;
  const hand = blockAt(score.blocking, time).actors.hero.reaches[0];
  close(hand.press, 1);
  close(hand.weight, 1);
  assert.equal(hand.gesture, 'press');
  for (const reduced of [false, true]) {
    assert.equal(blockAt(score.blocking, time - 1e-7, reduced).objects.switch, index % 2);
    assert.equal(blockAt(score.blocking, time + 1e-7, reduced).objects.switch, 1 - (index % 2));
  }
  return time;
}

test('prop onset follows the actual finger contact through approach, explicit pacing and speech cues', () => {
  const near = scene(ground(-1, 1.4)),
    far = scene(ground(-4, 1));
  const first = compileScore(near),
    second = compileScore(far);
  const nearby = contact(first),
    distant = contact(second);
  assert(distant > nearby + 2, 'a longer approach must delay the reaction');
  for (const seconds of [1, 8]) {
    const paced = scene();
    paced.beats[0].seconds = seconds;
    paced.beats[0].props.lamp.over = 0.05;
    const score = compileScore(paced);
    close(contact(score) / seconds, distant / second.script.duration);
    close(score.propTracks.lamp[0].end - score.propTracks.lamp[0].start, 0.05);
  }
  const narrated = scene();
  narrated.script = { duration: 14, cues: { press: { start: 4, end: 14 } } };
  const spoken = compileScore(narrated);
  close(contact(spoken), distant + 4);
  assert(spoken.blocking.plans[0].end < 14, 'long speech holds the naturally completed action');
  narrated.beats[0].seconds = 1;
  const fitted = compileScore(narrated);
  close((contact(fitted) - 4) / 10, distant / second.script.duration);
  delete narrated.beats[0].seconds;
  narrated.script = { duration: 1, cues: { press: { start: 0, end: 1 } } };
  assert.throws(() => compileScore(narrated), /actions need/);
});

test('delayed reactions, repeated toggles and a passing actor retain causal times after reverse seeks', () => {
  const options = scene();
  options.cast.friend = { skin: 'mira', at: ground(4, 1), scale: 0.64 };
  options.beats[0].perform.push({ action: 'walk', actor: 'friend', to: ground(-4, 1) });
  options.beats[0].props.lamp.delay = 0.12;
  options.beats[0].props.lamp.over = 0.35;
  options.beats.push({
    id: 'off',
    text: 'Разомкнуть цепь',
    perform: [{ action: 'press', actor: 'hero', target: 'switch' }],
    props: { lamp: { on: { press: 'switch' }, over: 1.2, values: { light: 0 } } },
  });
  const score = compileScore(options);
  assert(score.blocking.plans[1].via.length, 'the crossing actor uses an actual passing route');
  assert(
    score.script.cues.press.end > 8 / 1.25,
    'the detour contributes to the natural cue duration',
  );
  close(contact(score, 0, 0.12), contact(compileScore(scene())));
  const off = contact(score, 1);
  close(score.script.cues.off.end, off + 1.2);
  assert(
    score.blocking.plans.at(-1).end < score.script.cues.off.end,
    'the reaction can finish after the hand is released',
  );
  const [onKey, offKey] = score.propTracks.lamp;
  assert.equal(onKey.from.values.light, 0);
  assert.equal(onKey.to.values.light, 1);
  assert.equal(offKey.from.values.light, 1);
  assert.equal(offKey.to.values.light, 0);
  assert.deepEqual(
    Object.keys(offKey.from).sort(),
    ['at', 'opacity', 'values'],
    'reaction metadata is not persistent prop state',
  );
  const times = [
    0,
    onKey.start - 0.13,
    onKey.start,
    onKey.end,
    off - 1e-7,
    off + 1e-7,
    score.script.duration,
  ];
  const normal = times.map((time) => blockAt(score.blocking, time));
  const reduced = times.map((time) => blockAt(score.blocking, time, true));
  for (const i of [6, 0, 5, 3, 1, 4, 2, 6]) {
    assert.deepEqual(blockAt(score.blocking, times[i]), normal[i]);
    assert.deepEqual(blockAt(score.blocking, times[i], true), reduced[i]);
  }
});

test('reaction references reject missing, ambiguous or malformed contacts and timing outside the cue', () => {
  for (const on of [
    null,
    {},
    { press: '' },
    { press: 7 },
    { press: 'switch', extra: true },
    { press: 'absent' },
  ]) {
    const options = scene();
    options.beats[0].props.lamp.on = on;
    assert.throws(() => compileScore(options), /on:|on.press/);
  }
  const later = scene();
  later.beats[0].perform = [];
  later.beats.push({
    id: 'later',
    text: 'Нажать позже',
    perform: [{ action: 'press', actor: 'hero', target: 'switch' }],
  });
  assert.throws(() => compileScore(later), /exactly one matching press/);
  const ambiguous = scene();
  ambiguous.set.staging.spots.button = ground(0, 2, 1.2);
  ambiguous.cast.friend = { skin: 'mira', at: ground(4, 1) };
  ambiguous.beats[0].perform = ['hero', 'friend'].map((actor) => ({
    action: 'press',
    actor,
    target: 'button',
  }));
  ambiguous.beats[0].props.lamp.on = { press: 'button' };
  assert.throws(() => compileScore(ambiguous), /exactly one matching press/);
  const short = scene();
  short.beats[0].seconds = 1;
  short.beats[0].props.lamp.over = 0.5;
  assert.throws(() => compileScore(short), /delay and duration must fit cue press/);
  const plain = scene();
  delete plain.beats[0].props.lamp.on;
  plain.beats[0].props.lamp.delay = 0.2;
  close(compileScore(plain).propTracks.lamp[0].start, 0.2);
});
