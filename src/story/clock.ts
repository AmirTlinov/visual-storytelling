export interface MediaClock extends EventTarget {
  currentTime: number;
  readonly paused: boolean;
  readonly ended: boolean;
  muted: boolean;
  playbackRate?: number;
  play(): Promise<void>;
  pause(): void;
}
/** Observe media time. Cue interpretation belongs exclusively to the story's cue sheet. */
export function mediaTimeline(
  audio: MediaClock,
  duration: number,
  render: (mediaFrame: boolean) => void,
) {
  let frame = 0,
    disposed = false;
  let sought: { requested: number; reported: number } | undefined;
  const update = (reason?: Event | number | 'state') => {
    cancelAnimationFrame(frame);
    frame = 0;
    if (disposed) return;
    render(
      reason !== 'state' && !(reason instanceof Event && ['play', 'pause'].includes(reason.type)),
    );
    if (!audio.paused && !audio.ended) frame = requestAnimationFrame(update);
  };
  const seek = (time: number) => {
    const next = Math.min(duration, Math.max(0, time));
    // A redundant seek at preload=metadata can leave native media waiting indefinitely.
    if (audio.currentTime !== next) audio.currentTime = next;
    // Native media quantizes its readback (Chromium truncates to microseconds).
    // Keep the authored boundary through seeked/timeupdate echoes; advancing media
    // immediately resumes ownership of time, without a second running clock.
    sought = { requested: next, reported: audio.currentTime };
    update();
  };
  const events = [
    'play',
    'pause',
    'seeking',
    'seeked',
    'ended',
    'ratechange',
    'loadedmetadata',
    'timeupdate',
  ];
  const api = {
    get time() {
      const time = audio.currentTime;
      if (sought && time === sought.reported) return sought.requested;
      sought = undefined;
      return time;
    },
    seek,
    update,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      events.forEach((e) => audio.removeEventListener(e, update));
    },
  };
  events.forEach((e) => audio.addEventListener(e, update));
  update();
  return api;
}
