import { cueSheet, type Frame, type Script } from './cues.js';
import { transport } from './transport.js';
import { resolveMedia } from './media.js';
import type { SceneSubject } from '../scene-checkpoint.js';

export type StoryMode = 'story' | 'explore';
/** Portable input schema for experiments that cannot be represented by flat controls. */
export interface StoryCheckpoint<P> {
  encode(values: P): unknown;
  /** Validate the saved schema and return fresh inputs. Derived state is recomputed. */
  decode(value: unknown): P;
}
/** One accepted condition, with the model derived from precisely those inputs and time. */
export interface StoryMoment<P, S = P> {
  readonly time: number;
  readonly mode: StoryMode;
  readonly values: P;
  readonly state: S;
}
export interface StoryError {
  readonly stage: 'stateAt' | 'derive' | 'prepare' | 'render';
  readonly cause: unknown;
}
export interface StoryStatus<P, S = P> {
  readonly requested: StoryMoment<P, S>;
  readonly presented: StoryMoment<P, S> | undefined;
  readonly phase: 'preparing' | 'ready' | 'failed';
  readonly error: StoryError | undefined;
}
export type StoryOptions<P, K extends string, S = P> = {
  script: Script<K>;
  audio?: HTMLAudioElement | null;
  stateAt(frame: Frame<K>): P;
  checkpoint?: StoryCheckpoint<P>;
  /** Prepare resources without changing the visible frame. Honour cancellation before effects. */
  prepare?(
    state: NoInfer<S>,
    frame: Frame<K>,
    mode: StoryMode,
    signal: AbortSignal,
  ): void | Promise<void>;
  /** A successful synchronous return confirms the presented moment. */
  render(state: NoInfer<S>, frame: Frame<K>, mode: StoryMode): void;
} & (
  | {
      /** Validate and derive the model before accepting input or changing narrative time. */
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
  type Request = { moment: StoryMoment<P, S>; frame: Frame<K> };
  let requested: Request;
  let presented: StoryMoment<P, S> | undefined;
  let phase: StoryStatus<P, S>['phase'] = 'preparing';
  let error: StoryError | undefined;
  const player = transport({
    duration: options.script.duration,
    audio: options.audio ? resolveMedia(options.audio, options.script.duration) : undefined,
  });
  let forcedReduced: boolean | undefined;
  let changing = false;
  const listeners = new Set<(status: StoryStatus<P, S>) => void>();
  const seeks = new Set<(time: number) => void>();
  let preparation:
    | {
        request: Request;
        controller: AbortController;
        done: Promise<void>;
        resolve(): void;
      }
    | undefined;
  const status = (): StoryStatus<P, S> => ({
    requested: requested.moment,
    presented,
    phase,
    error,
  });
  function notify() {
    const next = status();
    for (const listener of listeners) listener(next);
  }
  function cancelPreparation() {
    const previous = preparation;
    preparation = undefined;
    previous?.controller.abort();
    previous?.resolve();
  }
  async function ready() {
    assertLive();
    while (preparation) {
      const pending = preparation;
      try {
        await pending.done;
      } catch (cause) {
        // A failure that has already been superseded does not reject the newer request.
        if (requested === pending.request) throw cause;
      }
      if (disposed) return;
    }
    if (error) throw error.cause;
  }
  function compute(values: P, frame: Frame<K>, mode: StoryMode): Request {
    const state = options.derive ? options.derive(values, frame) : (values as unknown as S);
    return { moment: Object.freeze({ values, state, time: frame.time, mode }), frame };
  }
  function fail(stage: StoryError['stage'], cause: unknown) {
    phase = 'failed';
    error = { stage, cause };
    // An arbitrary renderer may have changed part of the DOM before throwing.
    if (stage === 'render') presented = undefined;
    player.fail(cause);
    if (requested) notify();
  }
  function draw(next: Request) {
    if (disposed || requested !== next) return;
    try {
      options.render(next.moment.state, next.frame, next.moment.mode);
    } catch (cause) {
      if (requested === next) fail('render', cause);
      throw cause;
    }
    if (disposed || requested !== next) return;
    presented = next.moment;
    phase = 'ready';
    error = undefined;
    notify();
  }
  function publish(next: Request) {
    cancelPreparation();
    requested = next;
    phase = 'preparing';
    error = undefined;
    if (!options.prepare) return draw(next);
    const controller = new AbortController();
    let prepared: void | Promise<void>;
    try {
      prepared = options.prepare(
        next.moment.state,
        next.frame,
        next.moment.mode,
        controller.signal,
      );
    } catch (cause) {
      controller.abort();
      fail('prepare', cause);
      throw cause;
    }
    if (!prepared) return draw(next);
    let resolve!: () => void, reject!: (cause: unknown) => void;
    const done = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const pending = (preparation = { request: next, controller, done, resolve });
    // Holding the media clock can synchronously notify its status, without a new frame.
    const previous = changing;
    changing = true;
    try {
      player.prepare(done);
    } finally {
      changing = previous;
    }
    notify();
    void prepared.then(
      () => {
        if (controller.signal.aborted || disposed || requested !== next) return resolve();
        try {
          draw(next);
          if (preparation === pending) preparation = undefined;
          resolve();
        } catch (cause) {
          if (preparation === pending) preparation = undefined;
          reject(cause);
        }
      },
      (cause) => {
        if (controller.signal.aborted || disposed || requested !== next) return resolve();
        if (preparation === pending) preparation = undefined;
        fail('prepare', cause);
        reject(cause);
      },
    );
  }
  function update() {
    if (disposed || changing || error) return;
    const frame = sheet.at(player.state.time, forcedReduced ?? media.matches);
    const mode = requested?.moment.mode ?? 'story';
    // A resize while loading needs the eventual render at the latest viewport, not another load.
    if (
      preparation &&
      requested.frame.time === frame.time &&
      requested.frame.reduced === frame.reduced
    )
      return;
    let stage: StoryError['stage'] = 'stateAt';
    let next: Request;
    try {
      const values = mode === 'story' ? options.stateAt(frame) : requested.moment.values;
      stage = 'derive';
      next = compute(values, frame, mode);
    } catch (cause) {
      fail(stage, cause);
      throw cause;
    }
    publish(next);
  }
  // Media commands can synchronously emit several events. Accept one complete request.
  function change(command: () => void, next: Request) {
    const previous = changing;
    changing = true;
    try {
      command();
    } finally {
      changing = previous;
    }
    publish(next);
  }
  let unsubscribe: () => void;
  try {
    unsubscribe = player.subscribe((playback, mediaFrame) => {
      if (error && playback.playing) {
        const stage = error.stage;
        error = undefined;
        if (stage === 'prepare' || stage === 'render') publish(requested);
        else update();
      } else if (mediaFrame) update();
    });
  } catch (cause) {
    cancelPreparation();
    player.dispose();
    throw cause;
  }
  media.addEventListener('change', update);
  return {
    player,
    sheet,
    review: sheet.review,
    pause: player.pause,
    duration: options.script.duration,
    ready,
    subject:
      options.checkpoint &&
      ({
        capture({ basis = 'presented' }) {
          const moment = basis === 'requested' ? requested.moment : presented;
          if (!moment)
            throw Object.assign(new Error('The story has no completed frame to capture.'), {
              code: 'scene_not_presented',
            });
          return options.checkpoint!.encode(moment.values);
        },
        restore(value, { time, mode }) {
          assertLive();
          if (!Number.isFinite(time) || !['story', 'explore'].includes(mode))
            throw new Error('Invalid subject checkpoint position');
          const target = Math.max(0, Math.min(options.script.duration, time));
          const frame = sheet.at(target, forcedReduced ?? media.matches);
          const values =
            mode === 'story' ? options.stateAt(frame) : options.checkpoint!.decode(value);
          const next = compute(values, frame, mode);
          change(() => {
            for (const listener of seeks) listener(target);
            player.pause();
            player.seek(target);
          }, next);
        },
      } satisfies SceneSubject),
    get currentTime() {
      return player.state.time;
    },
    update,
    get requested() {
      return requested.moment;
    },
    get presented() {
      return presented;
    },
    get phase() {
      return phase;
    },
    get error() {
      return error;
    },
    explore(values: P) {
      assertLive();
      const next = compute(
        values,
        sheet.at(player.state.time, forcedReduced ?? media.matches),
        'explore',
      );
      change(player.pause, next);
    },
    resume() {
      assertLive();
      const frame = sheet.at(player.state.time, forcedReduced ?? media.matches);
      publish(compute(options.stateAt(frame), frame, 'story'));
    },
    seek(time: number) {
      assertLive();
      if (!Number.isFinite(time)) throw new Error('Story time must be finite');
      const target = Math.max(0, Math.min(options.script.duration, time));
      const frame = sheet.at(target, forcedReduced ?? media.matches);
      const next = compute(options.stateAt(frame), frame, 'story');
      change(() => {
        for (const listener of seeks) listener(target);
        player.seek(target);
      }, next);
    },
    setReduced(value?: boolean) {
      assertLive();
      const frame = sheet.at(player.state.time, value ?? media.matches);
      const mode = requested.moment.mode;
      const next = compute(
        mode === 'story' ? options.stateAt(frame) : requested.moment.values,
        frame,
        mode,
      );
      forcedReduced = value;
      publish(next);
    },
    subscribe(listener: (status: StoryStatus<P, S>) => void) {
      assertLive();
      listeners.add(listener);
      listener(status());
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
