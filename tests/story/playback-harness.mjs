export function playbackHarness(t) {
  const callbacks = new Map();
  const resources = [];
  const preferences = Object.assign(new EventTarget(), { matches: false });
  let serial = 0;
  const descriptors = new Map();
  for (const [key, value] of Object.entries({
    matchMedia: () => preferences,
    requestAnimationFrame: (callback) => {
      callbacks.set(++serial, callback);
      return serial;
    },
    cancelAnimationFrame: (id) => callbacks.delete(id),
    HTMLAudioElement: class {},
  })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  t.after(() => {
    for (const resource of resources) resource.dispose();
    for (const [key, descriptor] of descriptors)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
  });
  const audio = Object.assign(new EventTarget(), {
    currentTime: 0,
    paused: true,
    ended: false,
    muted: true,
    playbackRate: 1,
    pauses: 0,
    async play() {
      this.paused = false;
      this.dispatchEvent(new Event('play'));
    },
    pause() {
      this.pauses++;
      this.paused = true;
      this.dispatchEvent(new Event('pause'));
    },
  });
  return {
    audio,
    callbacks,
    preferences,
    own: (resource) => resources.push(resource),
    tick(time) {
      audio.currentTime = time;
      const frames = [...callbacks.values()];
      callbacks.clear();
      for (const callback of frames) callback(performance.now());
    },
  };
}
