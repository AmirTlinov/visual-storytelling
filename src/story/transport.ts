import { SilentMedia } from './media.js';
import { timeline } from './clock.js';
export interface Playback {
  time: number;
  duration: number;
  playing: boolean;
  muted: boolean;
  hasAudio: boolean;
  error: string | null;
}
export interface TransportOptions {
  duration: number;
  audio?: HTMLAudioElement;
}
/** Commands and subscriptions over the single media clock used by narrated scenes. */
export function transport({ duration, audio }: TransportOptions) {
  if (!(duration > 0) || !Number.isFinite(duration))
    throw new Error('Playback duration must be positive');
  const media = audio ?? new SilentMedia(duration),
    listeners = new Set<(state: Playback) => void>(),
    abort = new AbortController();
  let pending = false,
    disposed = false,
    request = 0,
    error: string | null = null;
  const state = (): Playback => ({
    time: media.currentTime,
    duration,
    playing: pending || !media.paused,
    muted: media.muted,
    hasAudio: !!audio,
    error,
  });
  const notify = () => {
    for (const listener of listeners) listener(state());
  };
  const clock = timeline(media, { duration, cues: {}, segments: [] }, notify);
  function pause() {
    request++;
    pending = false;
    media.pause();
    clock.update();
  }
  function seek(time: number) {
    if (!Number.isFinite(time)) throw new Error('Seek time must be finite');
    clock.seek(time);
  }
  async function play() {
    if (disposed || pending || !media.paused) return;
    if (media.currentTime >= duration - 0.02) seek(0);
    const token = ++request;
    error = null;
    pending = true;
    notify();
    try {
      await media.play();
      if (disposed || token !== request) return;
      pending = false;
      clock.update();
    } catch (cause) {
      if (disposed || token !== request) return;
      pending = false;
      error = cause instanceof Error ? cause.message : String(cause);
      notify();
    }
  }
  if (audio) {
    audio.addEventListener(
      'error',
      () => {
        pause();
        error = 'Не удалось загрузить звук';
        notify();
      },
      { signal: abort.signal },
    );
    audio.addEventListener(
      'loadedmetadata',
      () => {
        if (Math.abs(audio.duration - duration) > 0.25) {
          error = 'Длительность звука и меток различается';
          notify();
        }
      },
      { signal: abort.signal },
    );
  }
  return {
    get state() {
      return state();
    },
    play,
    pause,
    seek,
    toggle() {
      return pending || !media.paused ? pause() : play();
    },
    mute(value = !media.muted) {
      media.muted = value;
      notify();
    },
    subscribe(listener: (state: Playback) => void) {
      listeners.add(listener);
      listener(state());
      return () => listeners.delete(listener);
    },
    dispose() {
      pause();
      disposed = true;
      clock.dispose();
      abort.abort();
      listeners.clear();
    },
  };
}
export type Transport = ReturnType<typeof transport>;
