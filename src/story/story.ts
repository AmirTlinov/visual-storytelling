import { cueSheet, type Frame, type Script } from './cues.js';
import { transport } from './transport.js';
import { resolveMedia } from './media.js';

export type StoryOptions<P, K extends string, S = P> = {
  script: Script<K>;
  audio?: HTMLAudioElement | null;
  stateAt(frame: Frame<K>): P;
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
  function compute(next: P, frame: Frame<K>) {
    return {
      values: next,
      state: options.derive ? options.derive(next, frame) : (next as unknown as S),
      frame,
    };
  }
  function publish(next: ReturnType<typeof compute>) {
    values = next.values;
    state = next.state;
    options.render(state, next.frame, mode);
    for (const listener of listeners) listener(mode, values);
  }
  function update() {
    if (changing) return;
    const frame = sheet.at(player.state.time, forcedReduced ?? media.matches);
    publish(compute(mode === 'story' ? options.stateAt(frame) : values, frame));
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
    unsubscribe = player.subscribe(update);
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
      const computed = compute(next, sheet.at(player.state.time, forcedReduced ?? media.matches));
      change(() => {
        mode = 'explore';
        player.pause();
      }, computed);
    },
    resume() {
      const frame = sheet.at(player.state.time, forcedReduced ?? media.matches);
      const computed = compute(options.stateAt(frame), frame);
      mode = 'story';
      publish(computed);
    },
    seek(time: number) {
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
      const frame = sheet.at(player.state.time, value ?? media.matches);
      const computed = compute(mode === 'story' ? options.stateAt(frame) : values, frame);
      forcedReduced = value;
      publish(computed);
    },
    subscribe(listener: (mode: 'story' | 'explore', values: P) => void) {
      listeners.add(listener);
      listener(mode, values);
      return () => listeners.delete(listener);
    },
    onSeek(listener: (time: number) => void) {
      seeks.add(listener);
      return () => seeks.delete(listener);
    },
    dispose() {
      unsubscribe();
      player.dispose();
      media.removeEventListener('change', update);
      listeners.clear();
      seeks.clear();
    },
  };
}
export type Story<P, K extends string = string, S = P> = ReturnType<typeof story<P, K, S>>;
