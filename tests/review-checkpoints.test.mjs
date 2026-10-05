import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sceneCheckpoints } from '../tools/motion/scene-checkpoints.mjs';
import { queryEvidence } from '../tools/motion/inspection.mjs';

const review = {
  segments: [
    { id: 'one', start: 0, end: 10 },
    { id: 'two', start: 10.6, end: 20 },
  ],
  cues: [
    { id: 'blink', kind: 'action', start: 0.101, end: 0.119 },
    { id: 'cross', kind: 'action', start: 8, end: 12 },
    { id: 'instant', kind: 'action', start: 15, end: 15 },
  ],
};

test('whole stories and selected chapters observe action interiors and both sides of cuts', () => {
  for (const cue of [undefined, 'chapter:one']) {
    const { times } = sceneCheckpoints({ review, duration: 20, cue, frames: 2 });
    assert(
      times.some((t) => t > 0.101 && t < 0.119),
      'short reveal must have a visible checkpoint',
    );
    assert(
      times.some((t) => t > 10 && t < 10.15),
      'observe the final pose held after narration',
    );
    assert(times.some((t) => t < 10 && t > 9.9));
    assert(times.every((t, i) => t >= 0 && t <= 20 && (!i || t > times[i - 1])));
  }
  const { times } = sceneCheckpoints({ review, duration: 20 });
  assert(times.some((t) => t > 10.5 && t < 10.6));
  assert(times.some((t) => t > 10.6 && t < 10.7));
  assert.equal(times.filter((t) => t === 15).length, 1);
});

test('a cropped interval samples the visible part of overlapping actions, not their external middle', () => {
  const { times } = sceneCheckpoints({ review, duration: 20, from: 8, seconds: 1, frames: 2 });
  assert.deepEqual(times, [8, 8.5, 9]);
  const { times: detail } = sceneCheckpoints({ review, duration: 20, cue: 'blink', frames: 5 });
  assert(detail.some((t) => t > 0.101 && t < 0.119));
  assert(detail.every((t) => t >= 0 && t <= 0.269));
});

test('short model-time sweeps retain their step; scenes without cues retain uniform sampling', () => {
  const { times } = sceneCheckpoints({ review, duration: 20, from: 0.1, frames: 4, fps: 20 });
  assert.equal(times.length, 4);
  assert.equal(times[0], 0.1);
  assert.equal(times.at(-1), 0.25);
  assert(times.slice(1).every((t, i) => Math.abs(t - times[i] - 0.05) < 1e-12));
  assert.deepEqual(sceneCheckpoints({ duration: 1, frames: 3 }).times, [0, 0.5, 1]);
  assert.throws(() => sceneCheckpoints({ duration: 1, from: 1 }), /fewer than two/);
});

test('object inspection restores the camera of its own frame and view without duplicating stored facts', () => {
  const object = {
    id: 'card',
    viewId: 'viewport',
    x: 1,
    y: 2,
    width: 10,
    height: 20,
    visible: true,
  };
  const data = {
    frames: [0, 1].map((time) => ({
      time,
      file: `${time}.png`,
      objects: [object],
      views: [{ id: 'viewport', camera: { x: time }, receipt: { rendered: time } }],
    })),
  };
  // The HTML inspector embeds the same self-contained function.
  const browserQuery = (0, eval)(`(${queryEvidence.toString()})`);
  for (const query of [queryEvidence, browserQuery]) {
    const evidence = query(data, { at: 1, from: 0, to: 1, object: 'card' });
    assert.equal(evidence.objects[0].camera.x, 1);
    assert.equal(evidence.frames[0].objects[0].camera.x, 0);
    assert.equal(evidence.frames[1].objects[0].receipt.rendered, 1);
    assert.equal(object.camera, undefined, 'inspection must not expand the saved frames in place');
  }
});
