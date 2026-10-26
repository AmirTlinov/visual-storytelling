import * as T from './engine.js';
import { cueSheet, type Script } from '../story/cues.js';
import { geometryFrameAnchors } from './framing.js';
import { shotProgress, type Shot3D } from './shots.js';

export interface AuthoredShot3D {
  cue: string;
  shot: Shot3D;
  /** Movement consumes this part of the existing cue; its remainder is observation. */
  move: number | { fraction: number; maxSeconds: number };
}

/** Compile fixed authored envelopes once. Rendering and manual orbit cannot change a predecessor. */
export function shotPlan3D(script: Script, initial: Shot3D, authored: readonly AuthoredShot3D[]) {
  script = cueSheet(script).script;
  if (!Number.isFinite(script.duration) || script.duration <= 0)
    throw new Error('A camera plan needs a positive story duration.');
  const fixed = (shot: Shot3D): Shot3D => {
    const bounds =
      shot.bounds?.clone() ?? (shot.target instanceof T.Box3 ? shot.target.clone() : new T.Box3());
    if (!shot.bounds && bounds.isEmpty() && !(shot.target instanceof T.Box3))
      for (const anchor of geometryFrameAnchors(
        Array.isArray(shot.target) ? shot.target : [shot.target],
      ))
        bounds.expandByPoint(anchor.position);
    if (
      bounds.isEmpty() ||
      ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)
    )
      throw new Error('An authored camera shot needs finite non-empty bounds.');
    return {
      ...shot,
      bounds,
      target: shot.target instanceof T.Box3 ? bounds : shot.target,
      direction: shot.direction && ([...shot.direction] as [number, number, number]),
      insets: shot.insets && { ...shot.insets },
      anchors: shot.anchors?.map((a) => ({
        ...a,
        position: a.position.clone(),
        padding: a.padding && ([...a.padding] as [number, number]),
      })),
    };
  };
  const start = fixed(initial),
    ids = new Set<string>();
  let previous = start,
    end = 0;
  const legs = authored.map(({ cue, shot, move: movement }) => {
    const span = script.cues[cue];
    if (
      typeof movement !== 'number' &&
      (!movement ||
        !Number.isFinite(movement.fraction) ||
        movement.fraction < 0 ||
        movement.fraction > 1 ||
        !Number.isFinite(movement.maxSeconds) ||
        movement.maxSeconds < 0)
    )
      throw new Error(
        `Camera cue ${cue} needs a finite movement fraction in [0,1] and maximum seconds.`,
      );
    const move =
      typeof movement === 'number'
        ? movement
        : Math.min(movement.maxSeconds, (span ? span.end - span.start : NaN) * movement.fraction);
    if (
      ids.has(cue) ||
      !span ||
      ![span.start, span.end, move].every(Number.isFinite) ||
      span.start < end ||
      move < 0 ||
      span.end <= span.start ||
      span.end > script.duration ||
      move > span.end - span.start
    )
      throw new Error(
        `Camera cue ${cue} needs a unique ordered interval that contains its movement.`,
      );
    ids.add(cue);
    end = span.end;
    const to = fixed(shot),
      from = previous;
    previous = to;
    return { cue, start: span.start, end: span.end, move, from, to };
  });
  if (!legs.length) throw new Error('An authored camera plan needs at least one cue.');
  const envelope = new T.Box3().copy(start.bounds!);
  for (const leg of legs) envelope.union(leg.to.bounds!);
  const referenceScale = Math.max(
    envelope.getBoundingSphere(new T.Sphere()).radius,
    start.referenceScale ?? 0,
    ...legs.map((leg) => leg.to.referenceScale ?? 0),
  );
  if (!Number.isFinite(referenceScale) || referenceScale <= 0)
    throw new Error('A point-sized camera plan needs a positive referenceScale.');
  const authoredShot = (shot: Shot3D) => ({ ...fixed(shot), referenceScale });
  return {
    at(time: number, reduced = false) {
      if (!Number.isFinite(time) || time < 0)
        throw new Error('Camera time must be finite and non-negative.');
      const leg = legs.findLast((leg) => time >= leg.start);
      if (!leg)
        return {
          cue: undefined,
          progress: 0,
          amount: 0,
          phase: 'observe' as const,
          shot: { ...authoredShot(start), from: authoredShot(start), progress: 1, reduced },
        };
      const progress = leg.move === 0 ? 1 : Math.max(0, Math.min(1, (time - leg.start) / leg.move));
      return {
        cue: leg.cue,
        progress,
        amount: shotProgress(progress, reduced),
        phase: progress === 1 ? ('observe' as const) : ('move' as const),
        shot: { ...authoredShot(leg.to), from: authoredShot(leg.from), progress, reduced },
      };
    },
  };
}
