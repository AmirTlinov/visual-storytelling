export interface MediaClock extends EventTarget {
  currentTime: number;
  readonly paused: boolean;
  readonly ended: boolean;
  muted: boolean;
  play(): Promise<void>;
  pause(): void;
}
/** Observe media time. Cue interpretation belongs exclusively to the story's cue sheet. */
export function mediaTimeline(audio: MediaClock, duration: number, render: () => void) {
  let frame = 0,
    disposed = false;
  const update = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    if (disposed) return;
    render();
    if (!audio.paused && !audio.ended) frame = requestAnimationFrame(update);
  };
  const seek = (time: number) => {
    audio.currentTime = Math.min(duration, Math.max(0, time));
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
