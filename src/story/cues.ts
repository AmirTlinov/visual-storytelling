import { gsap } from 'gsap';
import { clamp } from '../ink/dom.js';

export interface Cue {
  start: number;
  end: number;
  quote?: string;
  text?: string;
  /** The visible operation, including its input and result. */
  action?: string;
  /** A deliberate interval for reading, comparing or predicting. */
  hold?: string;
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
export interface CueReview {
  duration: number;
  cues: (Cue & {
    id: string;
    kind: 'action' | 'hold' | 'chapter' | 'unassigned';
    referenced: boolean;
  })[];
  segments: readonly Chapter[];
}
export const progress = (time: number, range: Cue, lead = 0, tail = 0) => {
  const start = range.start - lead,
    end = range.end + tail;
  return end <= start ? Number(time >= start) : clamp((time - start) / (end - start));
};
const ease = gsap.parseEase('power1.inOut');
export const interpolate = (from: number, to: number, p: number) =>
  gsap.utils.interpolate(from, to, ease(clamp(p)));

/** Spoken-word cues, or authored silent cues, are the only source of reveal times. */
export function cueSheet<K extends string>(script: Script<K>) {
  const referenced = new Set<K>();
  const chapters = new Set(script.segments?.map((chapter) => chapter.id));
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
    if (
      (cue.action !== undefined && cue.hold !== undefined) ||
      [cue.action, cue.hold].some(
        (value) => value !== undefined && (typeof value !== 'string' || !value.trim()),
      )
    )
      throw new Error(`Cue ${id}: provide either a non-empty action or hold`);
  }
  for (const chapter of script.segments ?? []) {
    if (
      !Number.isFinite(chapter.start) ||
      !Number.isFinite(chapter.end) ||
      chapter.start < 0 ||
      chapter.end < chapter.start ||
      chapter.end > script.duration + 0.01
    )
      throw new Error(`Invalid chapter: ${chapter.id}`);
  }
  function get(id: K): Cue {
    const cue = script.cues[id];
    if (!cue) throw new Error(`Unknown cue: ${id}`);
    referenced.add(id);
    return cue;
  }
  return {
    script,
    get,
    /** Code references are diagnostic; the rendered operation still needs visual review. */
    review(): CueReview {
      return {
        duration: script.duration,
        segments: script.segments ?? [],
        cues: Object.entries<Cue>(script.cues)
          .map(([id, cue]): CueReview['cues'][number] => ({
            ...cue,
            id,
            referenced: referenced.has(id as K),
            kind: cue.action
              ? 'action'
              : cue.hold
                ? 'hold'
                : chapters.has(id)
                  ? 'chapter'
                  : 'unassigned',
          }))
          .sort((a, b) => a.start - b.start || a.end - b.end),
      };
    },
    at(time: number, reduced = false): Frame<K> {
      if (!Number.isFinite(time)) throw new Error('Story time must be finite');
      const amount = (id: K) => progress(time, get(id));
      return {
        time,
        reduced,
        progress: amount,
        reveal(id) {
          return reduced ? Number(time >= get(id).start) : amount(id);
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
