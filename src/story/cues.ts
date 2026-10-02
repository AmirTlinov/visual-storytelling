import { gsap } from 'gsap';
import { clamp } from '../ink/dom.js';

export interface Cue {
  start: number;
  end: number;
  quote?: string;
}
export interface Chapter extends Cue {
  id: string;
  text: string;
}
export interface Script<K extends string = string> {
  duration: number;
  cues: Record<K, Cue>;
  segments?: readonly Chapter[];
}
export interface Frame<K extends string = string> {
  time: number;
  reduced: boolean;
  progress(id: K): number;
  reveal(id: K): number;
  has(id: K): boolean;
  finished(id: K): boolean;
  between(from: K, until: K): boolean;
}
const ease = gsap.parseEase('power1.inOut');
export const interpolate = (from: number, to: number, p: number) =>
  gsap.utils.interpolate(from, to, ease(clamp(p)));

/** Spoken-word cues, or authored silent cues, are the only source of reveal times. */
export function cueSheet<K extends string>(script: Script<K>) {
  if (!Number.isFinite(script.duration) || script.duration <= 0)
    throw new Error('Story duration must be positive');
  for (const [id, cue] of Object.entries<Cue>(script.cues)) {
    if (
      !Number.isFinite(cue.start) ||
      !Number.isFinite(cue.end) ||
      cue.start < 0 ||
      cue.end < cue.start ||
      cue.end > script.duration + 0.01
    )
      throw new Error(`Invalid cue: ${id}`);
  }
  for (const chapter of script.segments ?? []) {
    if (chapter.start < 0 || chapter.end < chapter.start || chapter.end > script.duration + 0.01)
      throw new Error(`Invalid chapter: ${chapter.id}`);
  }
  function get(id: K): Cue {
    const cue = script.cues[id];
    if (!cue) throw new Error(`Unknown cue: ${id}`);
    return cue;
  }
  return {
    script,
    get,
    at(time: number, reduced = false): Frame<K> {
      if (!Number.isFinite(time)) throw new Error('Story time must be finite');
      const progress = (id: K) => {
        const cue = get(id);
        return cue.start === cue.end
          ? Number(time >= cue.start)
          : clamp((time - cue.start) / (cue.end - cue.start));
      };
      return {
        time,
        reduced,
        progress,
        reveal(id) {
          return reduced ? Number(time >= get(id).start) : progress(id);
        },
        has(id) {
          return time >= get(id).start;
        },
        finished(id) {
          return time >= get(id).end;
        },
        between(from, until) {
          return time >= get(from).start && time < get(until).start;
        },
      };
    },
  };
}
