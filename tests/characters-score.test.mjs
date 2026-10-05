import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileScore } from '../dist/characters/score.js';
import { chibi } from '../dist/characters/packs/chibi.js';

const options = () => ({
  pack: chibi,
  set: { width: 800, height: 700, svg: '', spots: { center: { x: 400, y: 620 } } },
  cast: { tesla: { skin: 'tesla', at: 'center' } },
  props: {
    lamp: { art: { svg: '' }, at: { actor: 'tesla', anchor: 'hand-right' }, values: { light: 0 } },
  },
  beats: [
    {
      id: 'think',
      seconds: 3,
      title: 'A question',
      text: 'Tesla considers the circuit.',
      actors: { tesla: 'think' },
    },
    {
      id: 'idea',
      seconds: 3,
      text: 'The lamp lights.',
      actors: { tesla: 'idea' },
      props: { lamp: { delay: 0.35, over: 0.25, values: { light: 1 } } },
    },
    { id: 'hold', seconds: 1, text: 'Tesla watches the light.' },
  ],
});

test('a score preserves continuing performances and gives short prop changes their own cue-relative interval', () => {
  const score = compileScore(options());
  assert.deepEqual(score.tracks.tesla, [
    { start: 0, action: 'think' },
    { start: 3, action: 'idea' },
  ]);
  const [lamp] = score.propTracks.lamp;
  assert.equal(lamp.start, 3.35);
  assert.equal(lamp.end, 3.6);
  assert.equal(lamp.from.values.light, 0);
  assert.equal(lamp.to.values.light, 1);
  assert.equal(score.script.segments[0].title, 'A question');
  assert.equal(score.script.segments[1].title, 'The lamp lights.');
  const narrated = options();
  narrated.script = {
    duration: 13,
    cues: {
      think: { start: 0, end: 4 },
      idea: { start: 5, end: 10 },
      hold: { start: 10, end: 13 },
    },
  };
  delete narrated.beats[1].props.lamp.over;
  const aligned = compileScore(narrated);
  assert.equal(aligned.propTracks.lamp[0].start, 5.35);
  assert.equal(aligned.propTracks.lamp[0].end, 10);
  assert.equal(aligned.tracks.tesla[1].start, 5);
  narrated.script.cues.idea = { start: 5, end: 5.6, timing: { duration: 4, delay: 0.5 } };
  const extended = compileScore(narrated);
  assert.equal(extended.tracks.tesla[1].start, 5.5);
  assert.equal(extended.propTracks.lamp[0].start, 5.85);
  assert.equal(extended.propTracks.lamp[0].end, 9.5);
  assert.deepEqual(extended.script.cues.idea.speech, { start: 5, end: 5.6 });
});

test('score errors identify invalid references and timing before graphics resources are created', () => {
  for (const timing of [
    { delay: -1 },
    { over: 0 },
    { delay: 3 },
    { delay: 2.9, over: 0.2 },
    { delay: NaN },
    { over: Infinity },
  ]) {
    const scene = options();
    scene.beats[1].props.lamp = timing;
    assert.throws(() => compileScore(scene), /delay and duration/);
  }
  const cases = [
    [
      (s) => {
        s.cast.tesla.action = 'constructor';
      },
      /Unknown action/,
    ],
    [
      (s) => {
        s.cast.tesla.at = 'constructor';
      },
      /Unknown stage spot/,
    ],
    [
      (s) => {
        s.beats[1].actors = { constructor: 'idea' };
      },
      /Unknown actor/,
    ],
    [
      (s) => {
        s.props.lamp.at = { actor: 'tesla', anchor: 'constructor' };
      },
      /Unknown actor anchor/,
    ],
    [
      (s) => {
        delete s.props.lamp.at;
      },
      /position is required/,
    ],
    [
      (s) => {
        s.pack = { ...chibi, anchors: { broken: { bone: 'root', x: NaN, y: 0 } } };
      },
      /Invalid anchor/,
    ],
    [
      (s) => {
        s.pack = { ...chibi, actions: { idle: { animation: 'idle', pose: -1 } } };
      },
      /Invalid action/,
    ],
    [
      (s) => {
        s.script = {
          duration: 7,
          cues: {
            think: { start: 0, end: 3 },
            idea: { start: 3, end: 3 },
            hold: { start: 3, end: 7 },
          },
        };
      },
      /positive duration/,
    ],
    [
      (s) => {
        s.script = { duration: 7, cues: { think: { start: 0, end: 3 } } };
      },
      /missing cue/,
    ],
  ];
  for (const [change, error] of cases) {
    const scene = options();
    change(scene);
    assert.throws(() => compileScore(scene), error);
  }
});
