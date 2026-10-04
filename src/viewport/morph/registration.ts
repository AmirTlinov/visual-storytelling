import { Box3 } from 'three';

/** Source and target materials share one moving frame before their contours blend.
 * Each row is scale XYZ, translation XYZ in that material group's axes. */
export function registerBounds(from: Box3, to: Box3, progress: number, out: Float64Array) {
  for (const [axis, key] of ['x', 'y', 'z'].entries()) {
    const k = key as 'x' | 'y' | 'z';
    const start = from.min[k] * (1 - progress) + to.min[k] * progress;
    const extent =
      (from.max[k] - from.min[k]) * (1 - progress) + (to.max[k] - to.min[k]) * progress;
    for (const [side, box] of [from, to].entries()) {
      const scale = extent / (box.max[k] - box.min[k]);
      out[side * 6 + axis] = scale;
      out[side * 6 + axis + 3] = start - box.min[k] * scale;
    }
  }
}

/** Nearest counterparts form independent material groups (e.g. each vector pair).
 * World-space centers keep membership independent of the first group's orientation. */
export function materialGroups(
  boxes: readonly Box3[],
  count: number,
  ids?: readonly (string | undefined)[],
) {
  if (ids?.some((id) => id !== undefined)) {
    if (ids.length !== boxes.length || ids.some((id) => !id))
      throw new Error('Every surface needs a material group when explicit groups are used');
    const materials = new Map<string, { sources: number[]; targets: number[] }>();
    ids.forEach((id, i) => {
      if (!materials.has(id!)) materials.set(id!, { sources: [], targets: [] });
      (i < count ? materials.get(id!)!.sources : materials.get(id!)!.targets).push(i);
    });
    if ([...materials.values()].some((group) => !group.sources.length || !group.targets.length))
      throw new Error('A material group needs both an origin and a destination');
    return [...materials.values()];
  }
  const root = boxes.map((_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i]!)));
  const join = (a: number, b: number) => {
    root[find(a)] = find(b);
  };
  const distance = (a: Box3, b: Box3) =>
    ['x', 'y', 'z'].reduce((sum, axis) => {
      const k = axis as 'x' | 'y' | 'z';
      return sum + (a.min[k] + a.max[k] - b.min[k] - b.max[k]) ** 2;
    }, 0);
  for (let i = 0; i < boxes.length; i++) {
    let nearest = i < count ? count : 0,
      best = Infinity;
    for (let j = i < count ? count : 0; j < (i < count ? boxes.length : count); j++) {
      const d = distance(boxes[i]!, boxes[j]!);
      if (d < best) {
        best = d;
        nearest = j;
      }
    }
    join(i, nearest);
  }
  const groups = new Map<number, { sources: number[]; targets: number[] }>();
  for (let i = 0; i < boxes.length; i++) {
    const key = find(i);
    if (!groups.has(key)) groups.set(key, { sources: [], targets: [] });
    (i < count ? groups.get(key)!.sources : groups.get(key)!.targets).push(i);
  }
  return [...groups.values()];
}

/** Bound the moving half-extent plus contact reach. The scale numerator uses the
 * contact frame, its denominator the apart frame, so approach may overlap morph.
 * H(m) is concave for a >= b; its endpoints and single maximum cover every frame. */
export function registeredEnvelope(
  from: number,
  to: number,
  a: number,
  b: number,
  allowance: number,
) {
  const A = a - 1,
    D = b - 1,
    slope = to - from;
  const d0 = slope + allowance * (a - b - 1);
  const d1 = slope - (allowance * a) / b;
  if (d0 <= 0) return from + allowance;
  if (d1 >= 0) return to;
  const q = allowance * A - slope * D;
  const m = d0 / (q * (1 + Math.sqrt((allowance * b * (a - b)) / q)));
  const scale = 1 + A * m;
  return from + slope * m + (allowance * (1 - m) * scale) / (1 + D * m);
}
