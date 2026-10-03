import { cueSheet, type Frame, type Script } from './cues.js';
import { transport } from './transport.js';
import { resolveMedia } from './media.js';

export interface StoryOptions<P, K extends string> {
  script: Script<K>;
  audio?: HTMLAudioElement | null;
  stateAt(frame: Frame<K>): P;
  render(state: P, frame: Frame<K>, mode: 'story' | 'explore'): void;
}
export function story<P, K extends string>(options: StoryOptions<P, K>) {
  const sheet = cueSheet(options.script);
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  let mode: 'story' | 'explore' = 'story',
    values = options.stateAt(sheet.at(0, media.matches));
  const player = transport({
    duration: options.script.duration,
    audio: options.audio ? resolveMedia(options.audio, options.script.duration) : undefined,
  });
  let forcedReduced: boolean | undefined;
  const listeners = new Set<(mode: 'story' | 'explore', values: P) => void>();
  const seeks = new Set<(time: number) => void>();
  function update() {
    const frame = sheet.at(player.state.time, forcedReduced ?? media.matches);
    if (mode === 'story') values = options.stateAt(frame);
    options.render(values, frame, mode);
    for (const listener of listeners) listener(mode, values);
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
    get mode() {
      return mode;
    },
    explore(next: P) {
      player.pause();
      mode = 'explore';
      values = next;
      update();
    },
    resume() {
      mode = 'story';
      update();
    },
    seek(time: number) {
      if (!Number.isFinite(time)) throw new Error('Story time must be finite');
      for (const listener of seeks) listener(time);
      mode = 'story';
      player.seek(time);
    },
    setReduced(value?: boolean) {
      forcedReduced = value;
      update();
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
export type Story<P, K extends string = string> = ReturnType<typeof story<P, K>>;
