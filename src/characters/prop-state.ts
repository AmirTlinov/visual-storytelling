import type { Place, Point, PropChange } from './types.js';

export type PropState = Pick<PropChange, 'at' | 'opacity' | 'values'>;
export interface PropKey {
  start: number;
  end: number;
  from: PropState;
  to: PropState;
  arc: number;
}
export const smooth = (t: number) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};

/** Absolute sampling for both flat SVGs and drawings carried by physical objects. */
export function propFrame(
  initial: PropState,
  track: readonly PropKey[],
  time: number,
  reduced: boolean,
  resolve: (at: Place) => Point,
) {
  const key = track.findLast((key) => key.start <= time),
    from = key?.from ?? initial,
    to = key?.to ?? initial,
    p = key && !reduced ? smooth((time - key.start) / (key.end - key.start)) : 1;
  const values = Object.fromEntries(
    Object.keys({ ...from.values, ...to.values }).map((name) => {
      const a = from.values?.[name] ?? 0,
        b = to.values?.[name] ?? a;
      return [name, a + (b - a) * p];
    }),
  );
  const a = from.at === undefined ? undefined : resolve(from.at),
    b = to.at === undefined ? undefined : resolve(to.at);
  return {
    at:
      a && b
        ? {
            x: a.x + (b.x - a.x) * p,
            y: a.y + (b.y - a.y) * p - (key?.arc ?? 0) * 4 * p * (1 - p),
          }
        : undefined,
    opacity: (from.opacity ?? 1) + ((to.opacity ?? 1) - (from.opacity ?? 1)) * p,
    values,
  };
}
