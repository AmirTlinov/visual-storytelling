import { test } from 'node:test';
import assert from 'node:assert/strict';
import { story } from '../dist/story/story.js';
import { mediaTimeline } from '../dist/story/clock.js';

test('native seek quantization retains a cue boundary until media time advances', (t) => {
  const previous = globalThis.cancelAnimationFrame;
  let clock;
  globalThis.cancelAnimationFrame = () => {};
  t.after(() => {
    clock?.dispose();
    if (previous) globalThis.cancelAnimationFrame = previous;
    else delete globalThis.cancelAnimationFrame;
  });
  const audio = Object.assign(new EventTarget(), { paused: true, ended: false });
  let nativeTime = 0;
  Object.defineProperty(audio, 'currentTime', {
    get: () => nativeTime,
    set: (time) => {
      nativeTime = Math.floor(time * 1e6) / 1e6;
    },
  });
  clock = mediaTimeline(audio, 40, () => {});
  const boundary = 24.040219999999998;
  clock.seek(boundary);
  assert(audio.currentTime < boundary);
  for (const event of ['seeking', 'seeked', 'timeupdate', 'pause']) {
    audio.dispatchEvent(new Event(event));
    assert.equal(clock.time, boundary);
  }
  audio.currentTime += 1 / 60;
  audio.dispatchEvent(new Event('timeupdate'));
  assert.equal(clock.time, audio.currentTime);
  clock.seek(4.3001);
  assert.equal(clock.time, 4.3001);
  clock.seek(0);
  assert.equal(clock.time, 0);
});

test('story derives one current model for input, time, reverse seeking and reduced motion', (t) => {
  const media = Object.assign(new EventTarget(), { matches: false });
  const globals = {
    matchMedia: () => media,
    cancelAnimationFrame: () => {},
  };
  const restore = [];
  let controller;
  t.after(() => {
    controller?.dispose();
    for (const cleanup of restore) cleanup();
  });
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    restore.push(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  const rendered = [],
    published = [];
  controller = story({
    script: { duration: 4, cues: { input: { start: 0, end: 4 } } },
    stateAt: (frame) => ({
      x: frame.time === 0.5 ? -1 : 2 + frame.progress('input') * 4,
      weight: 3,
      bias: -7,
    }),
    derive: (p) => {
      if (p.x < 0) throw new Error('Input must be nonnegative');
      const z = p.x * p.weight + p.bias;
      return { ...p, z, output: Math.max(0, z) };
    },
    render: (state, frame, mode) => rendered.push({ state, time: frame.time, mode }),
  });
  controller.subscribe((mode, values) => published.push({ mode, values }));
  assert.deepEqual(controller.state, { x: 2, weight: 3, bias: -7, z: -1, output: 0 });
  assert.equal(rendered.length, 1);

  assert.throws(() => controller.explore({ ...controller.values, x: -1 }), /nonnegative/);
  assert.equal(controller.mode, 'story');
  assert.equal(controller.values.x, 2);
  assert.equal(controller.state.output, 0);
  assert.equal(rendered.length, 1, 'an invalid model publishes no partial state');
  assert.throws(() => controller.seek(0.5), /nonnegative/);
  assert.equal(controller.currentTime, 0);
  assert.equal(controller.values.x, 2);
  assert.equal(rendered.length, 1, 'an invalid seek does not move the clock');

  rendered.length = published.length = 0;
  controller.explore({ ...controller.values, x: 4 });
  assert.deepEqual(controller.state, { x: 4, weight: 3, bias: -7, z: 5, output: 5 });
  assert.deepEqual(controller.values, { x: 4, weight: 3, bias: -7 });
  assert.equal(rendered.length, 1, 'media pause publishes a single fully derived frame');
  assert.equal(published.length, 1);
  assert.equal(rendered[0].state, controller.state);
  assert.equal(rendered[0].mode, 'explore');

  controller.setReduced(true);
  assert.equal(controller.state.output, 5, 'motion preference preserves the explored model');
  controller.seek(4);
  assert.equal(controller.state.output, 11);
  controller.seek(0);
  assert.equal(controller.state.output, 0);
  controller.explore({ ...controller.values, bias: 2 });
  assert.equal(controller.state.output, 8);
  controller.resume();
  assert.equal(controller.state.output, 0, 'returning to narration restores its input and output');
});
