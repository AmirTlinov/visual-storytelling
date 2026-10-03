import type { MathMorphFrame, MathMorphPlan, MathPart, MorphPoint } from './types.js';
import { mix, smooth } from './numbers.js';

export function partBounds(parts: readonly MathPart[]): [MorphPoint, MorphPoint] {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (const p of parts)
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, p.position[i]! - p.size[i]! / 2);
      max[i] = Math.max(max[i]!, p.position[i]! + p.size[i]! / 2);
    }
  return [min as unknown as MorphPoint, max as unknown as MorphPoint];
}
export const cellFormulaWidth = (plan: MathMorphPlan) =>
  Math.max(3, Math.min(6.6, plan.bounds[1][0] - plan.bounds[0][0]));

/** Both projections follow the last computation; the plan retains its fixed comparison bounds. */
export function frameBounds(
  plan: MathMorphPlan,
  frame: MathMorphFrame,
  progress: number,
): [MorphPoint, MorphPoint] {
  if (plan.encoding === 'cells') {
    const focus = smooth((progress * plan.stages - (plan.stages - 1) - 0.25) / 0.65);
    const sources = partBounds(frame.sources),
      targets = partBounds(frame.targets);
    const body = sources.map((point, side) =>
      point.map((v, axis) => mix(v, targets[side]![axis]!, frame.morph)),
    );
    const focusBounds = body.map((point) => [...point]);
    for (const note of frame.notes ?? [])
      for (let axis = 0; axis < 2; axis++) {
        const min = note.position[axis]! - note.size[axis]! / 2;
        const max = note.position[axis]! + note.size[axis]! / 2;
        focusBounds[0]![axis] = Math.min(
          focusBounds[0]![axis]!,
          mix(body[0]![axis]!, min, note.opacity),
        );
        focusBounds[1]![axis] = Math.max(
          focusBounds[1]![axis]!,
          mix(body[1]![axis]!, max, note.opacity),
        );
      }
    for (let axis = 0; axis < 2; axis++) {
      const center = (focusBounds[0]![axis]! + focusBounds[1]![axis]!) / 2;
      const minimum = Math.min(
        axis === 0 ? cellFormulaWidth(plan) : 3.4,
        plan.bounds[1][axis]! - plan.bounds[0][axis]!,
      );
      const half = Math.max(minimum, focusBounds[1]![axis]! - focusBounds[0]![axis]!) / 2;
      focusBounds[0]![axis] = center - half;
      focusBounds[1]![axis] = center + half;
    }
    return plan.bounds.map((point, side) =>
      point.map((v, axis) => mix(v, focusBounds[side]![axis]!, focus)),
    ) as unknown as [MorphPoint, MorphPoint];
  }
  if (Math.max(...plan.bounds[1].map((v, i) => v - plan.bounds[0][i]!)) <= 16)
    return [[...plan.bounds[0]], [...plan.bounds[1]]];
  const [min, max] = partBounds(
    frame.morph === 0
      ? frame.sources
      : frame.morph === 1
        ? frame.targets
        : [...frame.sources, ...frame.targets],
  );
  const center = min.map((v, i) => (v + max[i]!) / 2);
  const half = max.map((v, i) => Math.max(i === 0 ? 3 : i === 1 ? 1.5 : 0.5, (v - min[i]!) / 2));
  return [
    center.map((v, i) => v - half[i]!) as unknown as MorphPoint,
    center.map((v, i) => v + half[i]!) as unknown as MorphPoint,
  ];
}
export const quantityStep = (part: MathPart) =>
  Math.max(1, 10 ** Math.ceil(Math.log10(Math.max(part.size[0], part.size[1]) / 64)));
