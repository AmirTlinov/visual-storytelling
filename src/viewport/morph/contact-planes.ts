import { Matrix4 } from 'three';

/** Shared source faces bound the contact; the destination cannot add clipping planes. */
export function contactPlanes(kinds: Int32Array, parameters: Float32Array) {
  const world = new Float64Array(kinds.length * 16),
    matrix = new Matrix4();
  const directions = new Float64Array(kinds.length * 3),
    centers = new Float64Array(kinds.length),
    supports = new Float64Array(kinds.length);
  return (
    transforms: Float32Array,
    tension: number,
    planes: Float32Array,
    sources: readonly number[],
    offset: number,
  ) => {
    const reference = sources.find((i) => kinds[i] === 0);
    if (sources.length < 2 || reference === undefined || tension === 0) return 0;
    for (const i of sources) {
      matrix.fromArray(transforms, i * 16).invert();
      world.set(matrix.elements, i * 16);
    }
    const basis = reference * 16;
    // Each smooth-min adds at most tension/4 outside the original union.
    const allowance = (sources.length - 1) * tension * 0.25;
    let written = 0;
    for (let axis = 0; axis < 3; axis++) {
      const ax = transforms[basis + axis]!,
        ay = transforms[basis + axis + 4]!,
        az = transforms[basis + axis + 8]!;
      const length = Math.sqrt(ax * ax + ay * ay + az * az);
      for (let sign = -1; sign <= 1; sign += 2) {
        const nx = (sign * ax) / length,
          ny = (sign * ay) / length,
          nz = (sign * az) / length;
        let outer = -Infinity,
          first = 0,
          second = 0;
        for (const i of sources) {
          const at = i * 16,
            p = i * 4;
          const center = nx * world[at + 12]! + ny * world[at + 13]! + nz * world[at + 14]!;
          const dx = nx * world[at]! + ny * world[at + 1]! + nz * world[at + 2]!;
          const dy = nx * world[at + 4]! + ny * world[at + 5]! + nz * world[at + 6]!;
          const dz = nx * world[at + 8]! + ny * world[at + 9]! + nz * world[at + 10]!;
          const norm = Math.sqrt(dx * dx + dy * dy + dz * dz);
          let support: number;
          if (kinds[i] === 0) {
            support =
              center +
              Math.abs(dx) * parameters[p]! +
              Math.abs(dy) * parameters[p + 1]! +
              Math.abs(dz) * parameters[p + 2]! +
              norm * parameters[p + 3]!;
          } else {
            support =
              center +
              norm * parameters[p]! +
              (kinds[i] === 2 ? Math.abs(dx) * parameters[p + 1]! : 0);
          }
          outer = Math.max(outer, support);
          centers[i] = center;
          supports[i] = support;
          directions.set([dx, dy, dz], i * 3);
        }
        for (const i of sources) {
          if (kinds[i] !== 0) continue;
          const p = i * 4;
          let match = 0;
          for (let face = 0; face < 3; face++) {
            if (parameters[p + ((face + 1) % 3)]! <= 0 || parameters[p + ((face + 2) % 3)]! <= 0)
              continue;
            const faceHeight =
              centers[i]! +
              Math.abs(directions[i * 3 + face]!) * (parameters[p + face]! + parameters[p + 3]!);
            // Projection spread measures a face's tilt in scene units. A small
            // translation or rotation fades the constraint across the blend width.
            const error = Math.abs(faceHeight - outer) + Math.max(0, supports[i]! - faceHeight);
            const t = Math.max(0, 1 - error / tension);
            match = Math.max(match, t * t * (3 - 2 * t));
          }
          if (match > first) {
            second = first;
            first = match;
          } else second = Math.max(second, match);
        }
        if (second === 0) continue;
        const at = offset + written++ * 4;
        planes[at] = nx;
        planes[at + 1] = ny;
        planes[at + 2] = nz;
        // This halfspace contains every source. At zero match its extra allowance
        // is at least the entire smooth-min expansion, so it has no effect.
        planes[at + 3] = -outer - (1 - second) * allowance;
      }
    }
    return written;
  };
}
