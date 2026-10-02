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

/** Owns time. RAF samples native media time, or monotonic time for silent stories. */
export function transport({ duration, audio }: TransportOptions) {
  if (!(duration > 0) || !Number.isFinite(duration))
    throw new Error('Playback duration must be positive');
  const listeners = new Set<(state: Playback) => void>();
  const abort = new AbortController();
  let time = 0,
    playing = false,
    pending = false,
    frame = 0,
    origin = 0,
    disposed = false,
    request = 0;
  let error: string | null = null;
  const state = (): Playback => ({
    time,
    duration,
    playing: playing || pending,
    muted: audio?.muted ?? true,
    hasAudio: !!audio,
    error,
  });
  const notify = () => {
    for (const listener of listeners) listener(state());
  };
  const sample = () => {
    if (playing)
      time = Math.min(duration, audio ? audio.currentTime : (performance.now() - origin) / 1000);
  };
  function tick() {
    frame = 0;
    if (!playing || disposed) return;
    sample();
    if (time >= duration || audio?.ended) {
      time = duration;
      pause();
      return;
    }
    notify();
    frame = requestAnimationFrame(tick);
  }
  function pause() {
    request++;
    sample();
    playing = false;
    pending = false;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    audio?.pause();
    notify();
  }
  function seek(value: number) {
    if (!Number.isFinite(value)) throw new Error('Seek time must be finite');
    time = Math.max(0, Math.min(duration, value));
    origin = performance.now() - time * 1000;
    if (audio) audio.currentTime = time;
    notify();
  }
  async function play() {
    if (disposed || playing || pending) return;
    if (time >= duration - 0.02) seek(0);
    const token = ++request;
    error = null;
    pending = true;
    notify();
    try {
      if (audio) await audio.play();
      if (disposed || token !== request) return;
      pending = false;
      playing = true;
      origin = performance.now() - time * 1000;
      notify();
      frame = requestAnimationFrame(tick);
    } catch (cause) {
      if (token !== request || disposed) return;
      error = cause instanceof Error ? cause.message : String(cause);
      playing = false;
      pending = false;
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
      'ended',
      () => {
        pause();
        time = duration;
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
      return playing || pending ? pause() : play();
    },
    mute(value = !audio?.muted) {
      if (audio) audio.muted = value;
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
      abort.abort();
      listeners.clear();
    },
  };
}
export type Transport = ReturnType<typeof transport>;
