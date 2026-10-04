import type { Coordinate } from './types.js';

// Uneven interior probes avoid synchronized endpoint/midpoint sampling in both
// curve space and the mathematical states through which it moves.
export const interiorProbes = [(1 - 1 / Math.sqrt(3)) / 2, 0.5, (1 + 1 / Math.sqrt(3)) / 2];

/** Prepare one parameter mesh for the whole movement, so refinement never shuffles live vertices. */
export function curveParameters(
  domain: readonly [number, number],
  read: (parameter: number) => readonly Coordinate[],
  equalAspect: boolean,
) {
  const cache = new Map<number, readonly Coordinate[]>();
  const bounds: { lo: number[]; hi: number[]; dimension: number }[] = [];
  const at = (t: number) => {
    let points = cache.get(t);
    if (!points) {
      points = read(t);
      cache.set(t, points);
      points.forEach((point, frame) => {
        const box = (bounds[frame] ??= {
          lo: [Infinity, Infinity, Infinity],
          hi: [-Infinity, -Infinity, -Infinity],
          dimension: 2,
        });
        box.dimension = Math.max(box.dimension, point.length);
        for (let axis = 0; axis < 3; axis++) {
          const value = point[axis] ?? 0;
          box.lo[axis] = Math.min(box.lo[axis]!, value);
          box.hi[axis] = Math.max(box.hi[axis]!, value);
        }
      });
    }
    return points;
  };
  const knots = Array.from(
    { length: 17 },
    (_, i) => domain[0] + ((domain[1] - domain[0]) * i) / 16,
  );
  for (let i = 0; i < knots.length - 1; i++) {
    const a = knots[i]!,
      b = knots[i + 1]!;
    at(a);
    for (const t of interiorProbes) at(a + (b - a) * t);
  }
  const frames = at(domain[1]).length;
  const scales = bounds.map(({ lo, hi }) => {
    const spans = hi.map((v, axis) => v - lo[axis]!);
    const largest = Math.max(...spans) || 1;
    return spans.map((span) => (equalAspect ? largest : Math.max(span, largest * 1e-8)));
  });
  const error = (
    a: readonly Coordinate[],
    b: readonly Coordinate[],
    points: readonly Coordinate[],
  ) => {
    let worst = 0;
    for (let frame = 0; frame < frames; frame++) {
      const scale = scales[frame]!,
        start = a[frame]!,
        end = b[frame]!,
        point = points[frame]!;
      const dx = (end[0]! - start[0]!) / scale[0]!,
        dy = (end[1]! - start[1]!) / scale[1]!,
        dz = ((end[2] ?? 0) - (start[2] ?? 0)) / scale[2]!,
        px = (point[0]! - start[0]!) / scale[0]!,
        py = (point[1]! - start[1]!) / scale[1]!,
        pz = ((point[2] ?? 0) - (start[2] ?? 0)) / scale[2]!;
      const length = dx * dx + dy * dy + dz * dz;
      const fraction = length
        ? Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / length))
        : 0;
      const x = px - fraction * dx,
        y = py - fraction * dy,
        z = pz - fraction * dz;
      worst = Math.max(worst, x * x + y * y + z * z);
    }
    return worst;
  };
  const result = [domain[0]];
  let segments = 16;
  function refine(a: number, b: number, depth: number) {
    const start = at(a),
      end = at(b);
    const unresolved = interiorProbes.some(
      (t) => error(start, end, at(a + (b - a) * t)) > 1 / 1200 ** 2,
    );
    if (unresolved) {
      if (segments >= 8192 || depth >= 18)
        throw new Error(
          'The curve exceeds the readable detail budget; use a smaller mathematical domain',
        );
      segments++;
      const middle = (a + b) / 2;
      refine(a, middle, depth + 1);
      refine(middle, b, depth + 1);
    } else result.push(b);
  }
  for (let i = 0; i < knots.length - 1; i++) refine(knots[i]!, knots[i + 1]!, 0);
  return {
    parameters: result,
    bounds: bounds.map(({ lo, hi, dimension }) => [lo.slice(0, dimension), hi.slice(0, dimension)]),
    ends: at(domain[1]),
  };
}
