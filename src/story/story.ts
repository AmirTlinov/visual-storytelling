import { cueSheet, type Frame, type Script } from './cues.js';
import { transport } from './transport.js';
import { resolveMedia } from './media.js';

export type StoryOptions<P, K extends string, S = P> = {
  script: Script<K>;
  audio?: HTMLAudioElement | null;
  stateAt(frame: Frame<K>): P;
  /** Prepare the requested presentation before drawing it. Story owns cancellation and readiness. */
  prepare?(
    state: NoInfer<S>,
    frame: Frame<K>,
    mode: 'story' | 'explore',
    signal: AbortSignal,
  ): void | Promise<void>;
  render(state: NoInfer<S>, frame: Frame<K>, mode: 'story' | 'explore'): void;
} & (
  | {
      /** Compute the visible model after either narrative time or input changes. */
      derive(values: P, frame: Frame<K>): S;
    }
  | ([P] extends [S] ? { derive?: undefined } : never)
);
export function story<P, K extends string, S = P>(options: StoryOptions<P, K, S>) {
  const sheet = cueSheet(options.script);
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  let disposed = false;
  const assertLive = () => {
    if (disposed) throw new Error('Story has been disposed');
  };
  let mode: 'story' | 'explore' = 'story';
  let values: P, state: S;
  const player = transport({
    duration: options.script.duration,
    audio: options.audio ? resolveMedia(options.audio, options.script.duration) : undefined,
  });
  let forcedReduced: boolean | undefined;
  let changing = false;
  const listeners = new Set<(mode: 'story' | 'explore', values: P) => void>();
  const seeks = new Set<(time: number) => void>();
  let preparation:
    | {
        controller: AbortController;
        done: Promise<void>;
        resolve(): void;
      }
    | undefined;
  let preparationError: unknown;
  function cancelPreparation() {
    const previous = preparation;
    preparation = undefined;
    previous?.controller.abort();
    previous?.resolve();
  }
  async function ready() {
    assertLive();
    while (preparation) {
      await preparation.done;
      if (disposed) return;
    }
    if (preparationError) throw preparationError;
  }
  function compute(next: P, frame: Frame<K>) {
    return {
      values: next,
      state: options.derive ? options.derive(next, frame) : (next as unknown as S),
      frame,
    };
  }
  function present<T>(callback: () => T): T {
    try {
      return callback();
    } catch (cause) {
      preparationError = cause;
      player.fail(cause);
      throw cause;
    }
  }
  function publish(next: ReturnType<typeof compute>) {
    cancelPreparation();
    preparationError = undefined;
    values = next.values;
    state = next.state;
    const requestedMode = mode;
    const draw = () =>
      present(() => {
        options.render(next.state, next.frame, requestedMode);
        for (const listener of listeners) listener(requestedMode, next.values);
      });
    if (!options.prepare) return draw();
    const controller = new AbortController();
    const prepared = present(() =>
      options.prepare!(next.state, next.frame, requestedMode, controller.signal),
    );
    if (!prepared) return draw();
    let resolve!: () => void, reject!: (cause: unknown) => void;
    const done = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const request = (preparation = { controller, done, resolve });
    // Pausing media can synchronously publish its state. It does not create a new request.
    const previous = changing;
    changing = true;
    try {
      player.prepare(done);
    } finally {
      changing = previous;
    }
    void prepared
      .then(() => {
        if (controller.signal.aborted || disposed) return;
        draw();
      })
      .then(
        () => {
          if (preparation === request) preparation = undefined;
          resolve();
        },
        (cause) => {
          if (controller.signal.aborted || disposed) return resolve();
          if (preparation === request) preparation = undefined;
          preparationError = cause;
          reject(cause);
        },
      );
  }
  function update() {
    if (disposed || changing || preparationError) return;
    const frame = sheet.at(player.state.time, forcedReduced ?? media.matches);
    const next = present(() => compute(mode === 'story' ? options.stateAt(frame) : values, frame));
    publish(next);
  }
  // Media commands can synchronously emit several events. Publish one complete state.
  function change(command: () => void, next: ReturnType<typeof compute>) {
    changing = true;
    try {
      command();
    } finally {
      changing = false;
    }
    publish(next);
  }
  let unsubscribe: () => void;
  try {
    unsubscribe = player.subscribe((playback, mediaFrame) => {
      if (preparationError && playback.playing) {
        preparationError = undefined;
        update();
      } else if (mediaFrame) update();
    });
  } catch (error) {
    player.dispose();
    throw error;
  }
  media.addEventListener('change', update);
  return {
    player,
    sheet,
    review: sheet.review,
    pause: player.pause,
    duration: options.script.duration,
    ready,
    get currentTime() {
      return player.state.time;
    },
    update,
    get values() {
      return values;
    },
    /** The same derived state passed to render, including during exploration. */
    get state() {
      return state;
    },
    get mode() {
      return mode;
    },
    explore(next: P) {
      assertLive();
      const computed = compute(next, sheet.at(player.state.time, forcedReduced ?? media.matches));
      change(() => {
        mode = 'explore';
        player.pause();
      }, computed);
    },
    resume() {
      assertLive();
      const frame = sheet.at(player.state.time, forcedReduced ?? media.matches);
      const computed = compute(options.stateAt(frame), frame);
      mode = 'story';
      publish(computed);
    },
    seek(time: number) {
      assertLive();
      if (!Number.isFinite(time)) throw new Error('Story time must be finite');
      const target = Math.max(0, Math.min(options.script.duration, time));
      const frame = sheet.at(target, forcedReduced ?? media.matches);
      const computed = compute(options.stateAt(frame), frame);
      change(() => {
        mode = 'story';
        for (const listener of seeks) listener(target);
        player.seek(target);
      }, computed);
    },
    setReduced(value?: boolean) {
      assertLive();
      const frame = sheet.at(player.state.time, value ?? media.matches);
      const computed = compute(mode === 'story' ? options.stateAt(frame) : values, frame);
      forcedReduced = value;
      publish(computed);
    },
    subscribe(listener: (mode: 'story' | 'explore', values: P) => void) {
      assertLive();
      listeners.add(listener);
      listener(mode, values);
      return () => listeners.delete(listener);
    },
    onSeek(listener: (time: number) => void) {
      assertLive();
      seeks.add(listener);
      return () => seeks.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelPreparation();
      unsubscribe();
      player.dispose();
      media.removeEventListener('change', update);
      listeners.clear();
      seeks.clear();
    },
  };
}
export type Story<P, K extends string = string, S = P> = ReturnType<typeof story<P, K, S>>;
