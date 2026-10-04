import type { Frame } from '../story/cues.js';

export interface MorphProgress {
  progress: number;
  /** Physical duration of the complete operation, including its stages. */
  duration?: number;
  reduced?: boolean;
}
export type MorphTime = number | Frame | MorphProgress;
export type MorphCues = string | readonly string[];

let preference: MediaQueryList | undefined;
const motionPreference = () =>
  (preference ??=
    typeof matchMedia === 'undefined' ? undefined : matchMedia('(prefers-reduced-motion: reduce)'));
const isProgress = (input: Frame | MorphProgress): input is MorphProgress =>
  typeof input.progress === 'number';

export const motionProgress = (time: ReturnType<typeof morphTiming>, completeAt: number) =>
  time.reduced ? Number(time.progress >= completeAt) : time.progress;

/** The story supplies time; this owner resolves narrative stages and motion preference. */
export function morphTiming(input: MorphTime, cues?: MorphCues, stages = 1) {
  let progress: number, reduced: boolean, duration: number | undefined;
  if (typeof input === 'number') {
    progress = input;
    reduced = motionPreference()?.matches ?? false;
  } else if (isProgress(input)) {
    progress = input.progress;
    duration = input.duration;
    reduced = input.reduced ?? motionPreference()?.matches ?? false;
  } else {
    const frame = input;
    const ids = typeof cues === 'string' ? [cues] : cues;
    if (!ids?.length || (ids.length !== 1 && ids.length !== stages))
      throw new Error(`Provide one cue for the operation or ${stages} cues for its stages`);
    const seen = new Set<string>();
    for (const [i, id] of ids.entries()) {
      if (seen.has(id) && ids[i - 1] !== id)
        throw new Error('Repeated morph cues must be consecutive');
      seen.add(id);
    }
    if (ids.length === 1) {
      progress = frame.progress(ids[0]!);
      const cue = frame.cue(ids[0]!);
      duration = cue.end - cue.start;
    } else {
      // A completed cue holds its result until the next operation actually starts.
      // Repeating a cue allocates consecutive stages within that same speech interval.
      const active = ids.findLastIndex((id) => frame.has(id));
      if (active < 0) progress = 0;
      else {
        let first = active;
        while (first > 0 && ids[first - 1] === ids[active]) first--;
        const amount = frame.progress(ids[active]!);
        const end = active + 1;
        const cue = frame.cue(ids[active]!);
        duration = ((cue.end - cue.start) * stages) / (end - first);
        progress =
          (first + amount * (end - first) - (amount === 1 && end < stages ? 1e-10 : 0)) / stages;
      }
    }
    reduced = frame.reduced;
  }
  if (!Number.isFinite(progress)) throw new Error('Morph progress must be finite');
  if (duration !== undefined && (!Number.isFinite(duration) || duration < 0))
    throw new Error('Morph duration must be finite and non-negative');
  return { progress: Math.max(0, Math.min(1, progress)), reduced, duration };
}

export function mathMotionFrame<
  F extends { stage: number; phase: string; formula: string; result?: unknown },
>(
  plan: {
    stages: number;
    sample(progress: number, layout?: { columns?: number; duration?: number }): F;
  },
  time: ReturnType<typeof morphTiming>,
  columns?: number,
): F & { motionProgress: number } {
  const frame = plan.sample(time.progress, {
    columns,
    duration: time.duration === undefined ? undefined : time.duration / plan.stages,
  });
  if (!time.reduced) return { ...frame, motionProgress: time.progress };
  const settled = frame.phase === 'hold';
  // Keep the original stage and disclosure time. The next result is never shown early.
  const motionProgress =
    settled && frame.stage === plan.stages - 1
      ? 1
      : (frame.stage + (settled ? 1 - 1e-12 : 0)) / plan.stages;
  const pose = plan.sample(motionProgress, { columns });
  return {
    ...pose,
    result: frame.result,
    phase: settled ? ('hold' as const) : pose.phase,
    formula: settled ? frame.formula : pose.formula,
    motionProgress,
  } as F & { motionProgress: number };
}

export function watchMotion(refresh: () => void) {
  const media = motionPreference();
  media?.addEventListener('change', refresh);
  return () => media?.removeEventListener('change', refresh);
}
