import { test } from 'node:test';
import assert from 'node:assert/strict';
import { story } from '../dist/story/story.js';
import { mediaTimeline } from '../dist/story/clock.js';
import { transport } from '../dist/story/transport.js';

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

test('a rejected buffered media resume cannot stop newer playback', async (t) => {
  const globals = {
    cancelAnimationFrame: () => {},
    requestAnimationFrame: () => 1,
  };
  const restore = [];
  let player;
  t.after(() => {
    player?.dispose();
    for (const cleanup of restore) cleanup();
  });
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    restore.push(() =>
      descriptor
        ? Object.defineProperty(globalThis, key, descriptor)
        : Reflect.deleteProperty(globalThis, key),
    );
  }
  let playCount = 0,
    rejectResume;
  const media = Object.assign(new EventTarget(), {
    currentTime: 0,
    paused: true,
    ended: false,
    muted: true,
    playbackRate: 1,
    async play() {
      if (++playCount === 2)
        await new Promise((_, reject) => {
          rejectResume = reject;
        });
      this.paused = false;
      this.dispatchEvent(new Event('play'));
    },
    pause() {
      this.paused = true;
      this.dispatchEvent(new Event('pause'));
    },
  });
  player = transport({ duration: 10, audio: media });
  await player.play();
  let ready;
  player.prepare(new Promise((resolve) => (ready = resolve)));
  ready();
  await Promise.resolve();
  assert.equal(playCount, 2, 'the prepared chapter requests buffered media resume');
  player.pause();
  await player.play();
  assert.equal(player.state.playing, true);
  rejectResume(new Error('superseded play was interrupted'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(player.state.playing, true);
  assert.equal(player.state.error, null);
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

test('preparation retains the media clock, pause intent and only the latest requested frame', async (t) => {
  const globals = {
    matchMedia: () => Object.assign(new EventTarget(), { matches: false }),
    cancelAnimationFrame: () => {},
    requestAnimationFrame: () => 1,
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
    restore.push(() =>
      descriptor
        ? Object.defineProperty(globalThis, key, descriptor)
        : Reflect.deleteProperty(globalThis, key),
    );
  }
  const gates = new Map(),
    prepared = new Set([0]),
    rendered = [];
  const gate = (id) => {
    if (!gates.has(id)) {
      let resolve, reject;
      const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      });
      gates.set(id, {
        promise,
        resolve: () => {
          prepared.add(id);
          resolve();
        },
        reject,
      });
    }
    return gates.get(id);
  };
  controller = story({
    script: { duration: 8, cues: { all: { start: 0, end: 8 } } },
    stateAt: (frame) => Math.floor(frame.time),
    prepare: (value) => (prepared.has(value) ? undefined : gate(value).promise),
    render: (value) => rendered.push(value),
  });
  await controller.player.play();
  controller.seek(2);
  const heldTime = controller.currentTime;
  assert.equal(controller.player.state.playing, true, 'buffering retains the user play intent');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(
    controller.currentTime,
    heldTime,
    'the media clock holds while the chapter is loading',
  );
  controller.player.toggle();
  assert.equal(controller.player.state.playing, false, 'toggle cancels buffered playback');
  gate(2).resolve();
  await controller.ready();
  assert.equal(rendered.at(-1), 2);
  assert.equal(
    controller.player.state.playing,
    false,
    'finished preparation cannot restart a user pause',
  );

  controller.seek(3);
  const failed = assert.rejects(controller.ready(), /chapter failed/);
  gate(3).reject(new Error('chapter failed'));
  await failed;
  assert.equal(rendered.at(-1), 2, 'failed resources are never drawn');
  assert.match(controller.player.state.error, /chapter failed/);

  gates.delete(3);
  const retry = controller.player.play();
  assert.equal(gates.has(3), true, 'Play retries the failed presentation before media advances');
  const retryTime = controller.currentTime;
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(controller.currentTime, retryTime);
  gate(3).resolve();
  await retry;
  await controller.ready();
  assert.equal(rendered.at(-1), 3);
  assert.equal(controller.player.state.playing, true);
  controller.pause();

  controller.seek(4);
  const waiting = controller.ready();
  controller.seek(5);
  gate(4).resolve();
  await Promise.resolve();
  assert.equal(rendered.includes(4), false, 'an old completion cannot publish its frame');
  gate(5).resolve();
  await waiting;
  assert.equal(rendered.at(-1), 5);
  assert.equal(controller.player.state.error, null);

  controller.seek(6);
  const disposal = controller.ready();
  controller.dispose();
  await disposal;
  gate(6).resolve();
  await Promise.resolve();
  assert.equal(rendered.includes(6), false);

  let preparations = 0,
    draws = 0;
  controller = story({
    script: { duration: 2, cues: {} },
    stateAt: (frame) => frame.time,
    async prepare() {
      if (++preparations > 4) throw new Error('Preparation re-entered from a status notification');
    },
    render() {
      draws++;
    },
  });
  await controller.ready();
  await Promise.resolve();
  assert.equal(
    preparations,
    1,
    'an always-async prepare does not re-enter from readiness notifications',
  );
  assert.equal(draws, 1);
  await controller.player.play();
  await controller.ready();
  assert.equal(preparations, 1, 'play/pause events are transport status, not new authored frames');
});
