import type { MathMorphFrame, MathMorphPlan, MathPart, MorphPoint } from './types.js';

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
/** Large measured quantities follow the current body; cell layout owns symbolic arithmetic. */
export function quantityBounds(
  plan: MathMorphPlan,
  frame: MathMorphFrame,
): [MorphPoint, MorphPoint] {
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
