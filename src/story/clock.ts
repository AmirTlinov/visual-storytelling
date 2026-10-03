import { cueSheet, progress, type Cue, type Chapter, type Frame, type CueReview } from './cues.js';
export { progress } from './cues.js';
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
  at(time: number, reduced?: boolean): Frame;
  review(): CueReview;
  seek(time: number): void;
  update(): void;
  duration: number;
  seekCue(id: string): void;
  progress(id: string, time?: number, lead?: number, tail?: number): number;
  dispose(): void;
}
export function timeline(
  audio: MediaClock,
  data: Timing,
  render: (time: number, cues: CueClock) => void,
) {
  let frame = 0,
    disposed = false;
  const sheet = cueSheet({
    ...data,
    segments: data.segments.filter(
      (segment): segment is Chapter => segment.id !== undefined && segment.end !== undefined,
    ),
  });
  const cue = sheet.get;
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
    at: sheet.at,
    review: sheet.review,
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
