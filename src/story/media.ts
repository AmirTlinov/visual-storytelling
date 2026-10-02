/* The same player can read an audio element or this monotonic silent clock. */

export class SilentMedia extends EventTarget {
  duration: number;
  position: number;
  anchor: number;
  stopped: boolean;
  muted: boolean;
  constructor(duration: number) {
    super();
    this.duration = duration;
    this.position = 0;
    this.anchor = 0;
    this.stopped = true;
    this.muted = true;
  }
  get currentTime() {
    return Math.min(
      this.duration,
      this.position + (this.stopped ? 0 : (performance.now() - this.anchor) / 1000),
    );
  }
  set currentTime(value: number) {
    const wasPaused = this.paused;
    this.position = Math.max(0, Math.min(this.duration, value));
    this.anchor = performance.now();
    if (wasPaused) this.stopped = true;
    this.dispatchEvent(new Event('seeked'));
  }
  get ended() {
    return this.currentTime >= this.duration;
  }
  get paused() {
    return this.stopped || this.ended;
  }
  async play() {
    this.position = this.ended ? 0 : this.currentTime;
    this.anchor = performance.now();
    this.stopped = false;
    this.dispatchEvent(new Event('play'));
  }
  pause() {
    this.position = this.currentTime;
    this.stopped = true;
    this.dispatchEvent(new Event('pause'));
  }
}

export function resolveMedia(audio: import('./clock.js').MediaClock | null, duration: number) {
  return !audio || (audio instanceof HTMLAudioElement && audio.dataset.silent === 'true')
    ? new SilentMedia(duration)
    : audio;
}
