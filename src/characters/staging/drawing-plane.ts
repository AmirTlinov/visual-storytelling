import type { Quad } from '../../ink/projective.js';
import type { Furniture, GroundPoint, Projection } from './types.js';
import { project } from './space.js';

/** The board's drawable inset is also its semantic camera/contact surface. */
export const boardPlane: readonly GroundPoint[] = [
  { x: -1.76, z: -0.006, height: 3.74 },
  { x: 1.76, z: -0.006, height: 3.74 },
  { x: 1.76, z: -0.006, height: 2.06 },
  { x: -1.76, z: -0.006, height: 2.06 },
];
export function drawingPlane(
  item: Furniture,
  space: Projection,
  at = item.at,
  carried?: { x: number; y: number; scale: number },
): { quad: Quad; depth: number } {
  const points = item.surface?.corners ?? (item.kind === 'board' ? boardPlane : undefined);
  if (!points || points.length !== 4)
    throw new Error(`Object ${item.kind} needs a drawable surface with four corners`);
  const s = item.scale ?? 1;
  if (item.kind === 'prop') {
    if (points.some((p) => p.z !== 0))
      throw new Error('Portable drawing surfaces use a front plane (local z = 0)');
    const anchor = project(space, at);
    const frame = carried ?? { ...anchor, scale: anchor.scale * (item.scale ?? 0.72) };
    return {
      quad: points.map((p) => ({
        x: frame.x + p.x * 100 * frame.scale,
        y: frame.y - (p.height ?? 0) * 100 * frame.scale,
      })) as unknown as Quad,
      depth: at.z - 0.002,
    };
  }
  return {
    quad: points.map((p) =>
      project(space, {
        x: at.x + p.x * s,
        z: at.z + p.z * s,
        height: (at.height ?? 0) + (p.height ?? 0) * s,
      }),
    ) as unknown as Quad,
    depth: at.z + (points.reduce((n, p) => n + p.z, 0) / 4) * s - 0.002,
  };
}
