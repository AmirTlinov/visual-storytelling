import { gsap } from 'gsap';
import { clamp } from '../ink/dom.js';

export interface CueSpan {
  start: number;
  end: number;
}
/** An action starts at its speech anchor plus delay and has one explicit end. */
export type CueTiming = { delay?: number } & (
  | { duration: number; until?: never }
  | { until: string; duration?: never }
);
export interface Cue extends CueSpan {
  timing?: CueTiming;
  /** Original aligned words, retained when timing resolves the visible action window. */
  speech?: CueSpan;
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
  /** Short navigable heading; text remains the spoken paragraph. */
  title?: string;
  /** Absolute word times produced by the narration aligner. */
  words?: readonly { text: string; start: number; end: number }[];
}
export interface Script<K extends string = string> {
  duration: number;
  cues: Record<K, Cue>;
  segments?: readonly Chapter[];
  /** Display-only phrases, e.g. { 'пэ дэ эф': 'PDF' }; speech and aligned times stay intact.
   * Match whole phrases case-insensitively (ё = е), left-to-right, longest first. */
  captionAliases?: Readonly<Record<string, string>>;
}
export interface Frame<K extends string = string> {
  time: number;
  reduced: boolean;
  cue(id: K): Cue;
  progress(id: K): number;
  /** Seconds since the action started, clamped at zero; unaffected by reduced motion. */
  elapsed(id: K): number;
  reveal(id: K): number;
  has(id: K): boolean;
  finished(id: K): boolean;
  between(from: K, until: K): boolean;
  /** Bind an operation to a stable drawing/DOM identity for subject-scoped review. */
  target(id: K, objectId: string): void;
}
export interface CueReview {
  /** Values actually requested from the latest frame, not inferred animation progress. */
  observed?: { time: number; reads: { id: string; operation: string; value: number | boolean }[] };
  duration: number;
  cues: (Cue & {
    id: string;
    kind: 'action' | 'hold' | 'chapter' | 'unassigned';
    referenced: boolean;
    targets?: string[];
  })[];
  segments: readonly Chapter[];
  captionAliases?: Script['captionAliases'];
}
export const progress = (time: number, range: Cue, lead = 0, tail = 0) => {
  const start = range.start - lead,
    end = range.end + tail;
  return end <= start ? Number(time >= start) : clamp((time - start) / (end - start));
};
/** Resolve from original speech anchors, never from another action's retimed window. */
function timedCue(id: string, cues: Record<string, Cue>): Cue {
  const source = cues[id]!;
  if (source.timing === undefined) return source;
  const { timing, ...cue } = source;
  if (
    !timing ||
    typeof timing !== 'object' ||
    Array.isArray(timing) ||
    Object.keys(timing).some((key) => !['duration', 'until', 'delay'].includes(key))
  )
    throw new Error(`Cue ${id}: timing needs duration or until`);
  const delay = timing.delay ?? 0;
  if (!Number.isFinite(delay) || delay < 0)
    throw new Error(`Cue ${id}: timing delay must be finite and non-negative`);
  const duration = 'duration' in timing;
  if (duration === 'until' in timing)
    throw new Error(`Cue ${id}: timing needs exactly one of duration or until`);
  const speech = cue.speech ?? { start: cue.start, end: cue.end };
  const start = speech.start + delay;
  let end: number;
  if (duration) {
    if (!Number.isFinite(timing.duration) || !(timing.duration! > 0))
      throw new Error(`Cue ${id}: timing duration must be positive`);
    end = start + timing.duration!;
  } else {
    const until = timing.until;
    if (typeof until !== 'string' || !until.trim() || !Object.hasOwn(cues, until))
      throw new Error(`Cue ${id}: timing until needs an existing cue ID`);
    const target = cues[until]!;
    end = (target.speech ?? target).start;
  }
  if (!(end > start)) throw new Error(`Cue ${id}: timing must give a positive action window`);
  return { ...cue, start, end, speech: { ...speech } };
}
/** Latest started semantic operation, including its hold until the next cue. */
export function activeCue(script: Script | undefined, time: number) {
  const entry = Object.entries(script?.cues ?? {})
    .map(([id, cue]) => [id, cue.timing ? timedCue(id, script!.cues) : cue] as const)
    .filter(([, c]) => c.start <= time)
    .sort((a, b) => b[1].start - a[1].start)[0];
  return entry ? { id: entry[0], progress: progress(time, entry[1]) } : undefined;
}
const ease = gsap.parseEase('power1.inOut');
export const interpolate = (from: number, to: number, p: number) =>
  gsap.utils.interpolate(from, to, ease(clamp(p)));

/** Spoken-word cues, or authored silent cues, are the only source of reveal times. */
export function cueSheet<K extends string>(source: Script<K>) {
  const script = Object.values<Cue>(source.cues).some((cue) => cue.timing !== undefined)
    ? {
        ...source,
        cues: Object.fromEntries(
          Object.keys(source.cues).map((id) => [id, timedCue(id, source.cues)]),
        ) as Record<K, Cue>,
      }
    : source;
  const referenced = new Set<K>();
  const targets = new Map<K, Set<string>>();
  let observedTime = 0;
  const reads = new Map<string, { id: K; operation: string; value: number | boolean }>();
  const chapters = new Set(script.segments?.map((chapter) => chapter.id));
  if (!Number.isFinite(script.duration) || script.duration <= 0)
    throw new Error('Story duration must be positive');
  for (const [id, cue] of Object.entries<Cue>(script.cues)) {
    const speech = cue.speech;
    if (
      !Number.isFinite(cue.start) ||
      !Number.isFinite(cue.end) ||
      cue.start < 0 ||
      cue.end < cue.start ||
      cue.end > script.duration + 0.01
    )
      throw new Error(`Invalid cue: ${id}`);
    if (
      speech &&
      (!Number.isFinite(speech.start) ||
        !Number.isFinite(speech.end) ||
        speech.start < 0 ||
        speech.end < speech.start ||
        speech.end > script.duration + 0.01)
    )
      throw new Error(`Invalid speech anchor: ${id}`);
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
    if (!cue)
      throw new Error(
        `Unknown cue: ${id}. Available: ${Object.keys(script.cues).slice(0, 12).join(', ')}${Object.keys(script.cues).length > 12 ? ', … (see script.cues)' : ''}`,
      );
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
        observed: { time: observedTime, reads: [...reads.values()] },
        segments: script.segments ?? [],
        captionAliases: script.captionAliases,
        cues: Object.entries<Cue>(script.cues)
          .map(([id, cue]): CueReview['cues'][number] => ({
            ...cue,
            id,
            referenced: referenced.has(id as K),
            ...(targets.has(id as K) ? { targets: [...targets.get(id as K)!] } : {}),
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
      observedTime = time;
      reads.clear();
      const observe = <V extends number | boolean>(id: K, operation: string, value: V): V => {
        reads.set(`${operation}:${id}`, { id, operation, value });
        return value;
      };
      const amount = (id: K) => observe(id, 'progress', progress(time, get(id)));
      return {
        time,
        reduced,
        cue: get,
        progress: amount,
        elapsed(id) {
          return observe(id, 'elapsed', Math.max(0, time - get(id).start));
        },
        target(id, objectId) {
          get(id);
          if (!objectId.trim()) throw new Error('A review target needs a stable identity');
          if (!targets.has(id)) targets.set(id, new Set());
          targets.get(id)!.add(objectId);
        },
        reveal(id) {
          return observe(id, 'reveal', reduced ? Number(time >= get(id).start) : amount(id));
        },
        has(id) {
          return observe(id, 'has', time >= get(id).start);
        },
        finished(id) {
          return observe(id, 'finished', time >= get(id).end);
        },
        between(from, until) {
          return time >= get(from).start && time < get(until).start;
        },
      };
    },
  };
}
