import type { Cue } from './cues.js';
export interface Timing {
  duration: number;
  cues: Record<string, Cue>;
  segments: { id?: string; start: number; end?: number; text: string }[];
}
export interface MediaClock extends EventTarget {
  currentTime: number;
  readonly paused: boolean;
  readonly ended: boolean;
  muted: boolean;
  play(): Promise<void>;
  pause(): void;
}
export interface CueClock {
  cue(id: string): Cue;
  seek(time: number): void;
  update(): void;
  duration: number;
  seekCue(id: string): void;
  progress(id: string, time?: number, lead?: number, tail?: number): number;
  dispose(): void;
}
const clamp = (x: number) => Math.min(1, Math.max(0, x));
export const progress = (time: number, range: Cue, lead = 0, tail = 0) => {
  const a = range.start - lead,
    b = range.end + tail;
  return b <= a ? Number(time >= a) : clamp((time - a) / (b - a));
};
export function timeline(
  audio: MediaClock,
  data: Timing,
  render: (time: number, cues: CueClock) => void,
) {
  let frame = 0,
    disposed = false;
  const cue = (id: string) => {
    if (!data.cues[id]) throw Error(`Unknown narration cue: ${id}`);
    return data.cues[id]!;
  };
  const update = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    if (disposed) return;
    render(audio.currentTime, api);
    if (!audio.paused && !audio.ended) frame = requestAnimationFrame(update);
  };
  const seek = (time: number) => {
    audio.currentTime = Math.min(data.duration, Math.max(0, time));
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
  const api: CueClock = {
    cue,
    seek,
    update,
    duration: data.duration,
    seekCue: (id) => seek(cue(id).start),
    progress: (id, time = audio.currentTime, lead = 0, tail = 0) =>
      progress(time, cue(id), lead, tail),
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
