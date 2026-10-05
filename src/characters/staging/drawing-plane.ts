import type { Quad } from '../../ink/projective.js';
import type { Furniture, GroundPoint, Projection } from './types.js';
import { project } from './space.js';

/** The board's drawable inset is also its semantic camera/contact surface. */
const boardPlane: readonly GroundPoint[] = [
  { x: -1.76, z: -0.006, height: 3.74 },
  { x: 1.76, z: -0.006, height: 3.74 },
  { x: 1.76, z: -0.006, height: 2.06 },
  { x: -1.76, z: -0.006, height: 2.06 },
];
/** The physical picture and semantic .content target share these local corners. */
export function drawingCorners(item: Furniture): readonly GroundPoint[] | undefined {
  const art = item.art;
  const points =
    item.kind === 'prop' && art?.paint
      ? [
          { x: -art.width / 200, z: 0, height: art.height / 100 },
          { x: art.width / 200, z: 0, height: art.height / 100 },
          { x: art.width / 200, z: 0, height: 0 },
          { x: -art.width / 200, z: 0, height: 0 },
        ]
      : (item.surface?.corners ?? (item.kind === 'board' ? boardPlane : undefined));
  if (points && points.length !== 4)
    throw new Error(`Object ${item.kind} needs a drawable surface with four corners`);
  if (item.kind === 'prop' && points?.some((p) => p.z !== 0))
    throw new Error('Portable drawing surfaces use a front plane (local z = 0)');
  return points;
}

/** Portable art uses 100 drawing units per local unit, independent of the set's unit. */
export function drawingPoint(item: Furniture, space: Projection, point: GroundPoint, at = item.at) {
  const scale =
    item.kind === 'prop' ? ((item.scale ?? 0.72) * 100) / space.unit : (item.scale ?? 1);
  return {
    x: at.x + point.x * scale,
    z: at.z + point.z * scale,
    height: (at.height ?? 0) + (point.height ?? 0) * scale,
  };
}

export function drawingPlane(
  item: Furniture,
  space: Projection,
  at = item.at,
  carried?: { x: number; y: number; scale: number },
): { quad: Quad; depth: number } {
  const points = drawingCorners(item);
  if (!points) throw new Error(`Object ${item.kind} needs a drawable surface with four corners`);
  if (item.kind === 'prop' && carried) {
    return {
      quad: points.map((p) => ({
        x: carried.x + p.x * 100 * carried.scale,
        y: carried.y - (p.height ?? 0) * 100 * carried.scale,
      })) as unknown as Quad,
      depth: at.z - 0.002,
    };
  }
  const corners = points.map((p) => drawingPoint(item, space, p, at));
  return {
    quad: corners.map((p) => project(space, p)) as unknown as Quad,
    depth: corners.reduce((n, p) => n + p.z, 0) / 4 - 0.002,
  };
}
