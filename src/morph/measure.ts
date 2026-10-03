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
/** Large quantities use a following frame; the plan retains its fixed comparison bounds. */
export function frameBounds(plan: MathMorphPlan, frame: MathMorphFrame): [MorphPoint, MorphPoint] {
  if (
    plan.encoding === 'cells' ||
    Math.max(...plan.bounds[1].map((v, i) => v - plan.bounds[0][i]!)) <= 16
  )
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
export interface MeasureLine {
  from: MorphPoint;
  to: MorphPoint;
}
export function quantityGrid(part: MathPart): { lines: MeasureLine[]; step: number } {
  const [w, h, d] = part.size,
    [x, y, z] = part.position;
  const step = Math.max(1, 10 ** Math.ceil(Math.log10(Math.max(w, h) / 64)));
  const lines: MeasureLine[] = [];
  // Exact integer units until a labelled coarser scale is needed.
  for (let i = step; i < w - 1e-6; i += step)
    lines.push({
      from: [x - w / 2 + i, y - h / 2, z + d / 2 + 0.003],
      to: [x - w / 2 + i, y + h / 2, z + d / 2 + 0.003],
    });
  for (let i = step; i < h - 1e-6; i += step)
    lines.push({
      from: [x - w / 2, y - h / 2 + i, z + d / 2 + 0.003],
      to: [x + w / 2, y - h / 2 + i, z + d / 2 + 0.003],
    });
  return { lines, step };
}
