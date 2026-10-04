import { Matrix4 } from 'three';

const ease = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

/** A polynomial distance blend pinches at gap = tension / 2. Release material
 * curvature only beyond that neck, with a smooth return to its resting shape. */
export const contactRetention = (gap: number, tension: number) =>
  tension > 0 ? 1 - ease((gap / tension - 0.5) / 0.75) : 0;

/** Round facing box caps as they separate. Free faces keep their original corners.
 * A smooth union alone adds a ridge at a flat seam and severs the entire flat cap
 * at once. Receding caps instead leave a narrowing neck before losing contact. */
export function contactRounding(kinds: Int32Array, parameters: Float32Array) {
  const world = new Float64Array(kinds.length * 16);
  const matrix = new Matrix4(),
    neighbor = new Matrix4(),
    relative = new Matrix4();
  return (
    transforms: Float32Array,
    scales: Float32Array,
    tension: number,
    sources: readonly number[],
    radii: Float32Array,
  ) => {
    if (sources.length < 2 || tension === 0) return;
    for (const i of sources) {
      matrix.fromArray(transforms, i * 16).invert();
      world.set(matrix.elements, i * 16);
    }
    for (const i of sources) {
      if (kinds[i] !== 0) continue;
      const a = i * 4,
        k = tension / scales[i]!;
      const half = [0, 1, 2].map((axis) => parameters[a + axis]! + parameters[a + 3]!);
      for (const j of sources) {
        if (i === j || kinds[j] !== 0) continue;
        relative.multiplyMatrices(
          matrix.fromArray(transforms, i * 16),
          neighbor.fromArray(world, j * 16),
        );
        const e = relative.elements,
          b = j * 4;
        // Parallel faces have a flat contact patch. Tilted or curved contacts
        // already have a shrinking patch under the ordinary distance blend.
        let tilt = 0;
        const other = [0, 0, 0];
        for (let axis = 0; axis < 3; axis++) {
          const row = [0, 1, 2].map((column) => Math.abs(e[axis + column * 4]!));
          const largest = Math.max(...row);
          tilt = Math.max(
            tilt,
            Math.sqrt(Math.max(0, row.reduce((sum, v) => sum + v * v, 0) - largest * largest)) /
              Math.hypot(...row),
          );
          other[axis] = row.reduce(
            (sum, weight, column) => sum + weight * (parameters[b + column]! + parameters[b + 3]!),
            0,
          );
        }
        const alignment = 1 - ease(tilt / 0.08);
        if (alignment === 0) continue;
        for (let axis = 0; axis < 3; axis++) {
          const center = e[12 + axis]!,
            gap = Math.abs(center) - half[axis]! - other[axis]!;
          const retention = contactRetention(gap, k);
          if (gap <= -k || retention === 0 || center === 0) continue;
          const u = (axis + 1) % 3,
            v = (axis + 2) % 3;
          const coverage = ease(
            1 +
              Math.min(
                other[u]! - Math.abs(e[12 + u]!) - half[u]!,
                other[v]! - Math.abs(e[12 + v]!) - half[v]!,
              ) /
                k,
          );
          if (coverage === 0) continue;
          const maximum = Math.min(half[axis]!, half[u]!, half[v]!);
          // At zero gap this radius exactly cancels smooth-min's k/4 ridge:
          // (sqrt(2)-1)*radius = k/4. At pinch-off the cap has no flat centre.
          const joined = Math.min(maximum, ((1 + Math.SQRT2) * k) / 4);
          const neck = ease(gap / (k * 0.5));
          const weight = ease(1 + gap / k) * retention * alignment * coverage;
          const at = i * 18 + (axis * 2 + Number(center > 0)) * 3;
          // A shallow cap still contracts its full cross-section. Separate
          // transverse radii prevent thin prisms snapping across a flat plateau.
          for (const [coordinate, end] of [maximum, half[u]!, half[v]!].entries())
            radii[at + coordinate] = Math.max(
              radii[at + coordinate]!,
              (joined + (end - joined) * neck) * weight,
            );
        }
      }
    }
  };
}
