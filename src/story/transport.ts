import { SilentMedia } from './media.js';
import { mediaTimeline, type MediaClock } from './clock.js';
import { sceneHost } from '../host/adapter.js';
export interface Playback {
  time: number;
  duration: number;
  playing: boolean;
  muted: boolean;
  hasAudio: boolean;
  rate: number;
  error: string | null;
}
export interface TransportOptions {
  duration: number;
  audio?: MediaClock;
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
  let permission: AbortController | undefined;
  let unmutePermission: AbortController | undefined;
  const state = (): Playback => ({
    time: clock.time,
    duration,
    playing: pending || !media.paused,
    muted: media.muted,
    hasAudio: !(media instanceof SilentMedia),
    rate: media.playbackRate ?? 1,
    error,
  });
  const notify = () => {
    for (const listener of listeners) listener(state());
  };
  const clock = mediaTimeline(media, duration, notify);
  function pause() {
    if (disposed) return;
    request++;
    permission?.abort();
    permission = undefined;
    unmutePermission?.abort();
    pending = false;
    media.pause();
    clock.update();
  }
  function seek(time: number) {
    if (disposed) throw new Error('Playback has been disposed');
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
      permission?.abort();
      const approval = (permission = new AbortController());
      await sceneHost()?.beforePlay?.({
        muted: media.muted,
        hasAudio: !(media instanceof SilentMedia),
        signal: approval.signal,
      });
      if (disposed || token !== request || approval.signal.aborted) return;
      await media.play();
      if (disposed || token !== request) return;
      pending = false;
      clock.update();
    } catch (cause) {
      if (disposed || token !== request) return;
      pending = false;
      error = cause instanceof Error ? cause.message : String(cause);
      notify();
      throw cause;
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
        if (
          'duration' in audio &&
          typeof audio.duration === 'number' &&
          Math.abs(audio.duration - duration) > 0.25
        ) {
          error = 'Длительность звука и меток различается';
          notify();
        }
      },
      { signal: abort.signal },
    );
  }
  media.addEventListener('volumechange', notify, { signal: abort.signal });
  globalThis.document?.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) pause();
    },
    { signal: abort.signal },
  );
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
    async mute(value = !media.muted) {
      if (disposed) throw new Error('Playback has been disposed');
      unmutePermission?.abort();
      if (!value && media.muted && !media.paused) {
        const token = request,
          approval = new AbortController();
        unmutePermission = approval;
        try {
          await sceneHost()?.beforePlay?.({
            muted: false,
            hasAudio: !(media instanceof SilentMedia),
            signal: approval.signal,
          });
        } catch (cause) {
          if (approval.signal.aborted) return;
          error = cause instanceof Error ? cause.message : String(cause);
          notify();
          throw cause;
        }
        if (disposed || token !== request || approval.signal.aborted) return;
      }
      media.muted = value;
      notify();
    },
    rate(value: number) {
      if (!Number.isFinite(value) || value < 0.25 || value > 3)
        throw new Error('Playback rate must be between 0.25 and 3');
      if (media.playbackRate === undefined)
        throw new Error('This media does not support playback rate');
      media.playbackRate = value;
      notify();
    },
    subscribe(listener: (state: Playback) => void) {
      listeners.add(listener);
      listener(state());
      return () => listeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      request++;
      permission?.abort();
      unmutePermission?.abort();
      pending = false;
      clock.dispose();
      abort.abort();
      listeners.clear();
      media.pause();
    },
  };
}
export type Transport = ReturnType<typeof transport>;
