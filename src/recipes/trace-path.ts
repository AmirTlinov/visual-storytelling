import type { Point } from '../ink/pen.js';

/** Follow an already computed route. No routing or dependency semantics belong to this drawing aid. */
export function tracePath(route: readonly Point[], progress: number) {
  if (
    !route.length ||
    !Number.isFinite(progress) ||
    progress < 0 ||
    progress > 1 ||
    route.some((point) => point.length !== 2 || !point.every(Number.isFinite))
  )
    throw new Error('tracePath: provide finite route points and progress in [0, 1].');
  const lengths = route
    .slice(1)
    .map((point, index) => Math.hypot(point[0] - route[index]![0], point[1] - route[index]![1]));
  const distance = lengths.reduce((sum, length) => sum + length, 0) * progress;
  let remaining = distance;
  for (let index = 0; index < lengths.length; index++) {
    const length = lengths[index]!;
    if (remaining <= length && length > 0) {
      const from = route[index]!,
        to = route[index + 1]!;
      const amount = remaining / length;
      return {
        point: [
          from[0] + (to[0] - from[0]) * amount,
          from[1] + (to[1] - from[1]) * amount,
        ] as Point,
        segment: index,
        amount,
        distance,
      };
    }
    remaining -= length;
  }
  return { point: route.at(-1)!, segment: Math.max(0, route.length - 2), amount: 1, distance };
}
