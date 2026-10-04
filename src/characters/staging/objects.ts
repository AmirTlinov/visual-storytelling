import type { Furniture, GroundPoint } from './types.js';

/** The same geometry describes rendering, approach positions and contact targets. */
export const objectShape = {
  chair: { seat: 1.1 },
  stairs: { rise: 0.28, tread: 0.38, steps: 8, landing: 1.4 },
} as const;
export function stairEnd(item: Furniture): GroundPoint {
  const s = item.scale ?? 1,
    d = objectShape.stairs;
  return {
    x: item.at.x,
    z: item.at.z + d.steps * d.tread * s,
    height: (item.at.height ?? 0) + d.steps * d.rise * s,
  };
}
export function supportPoint(item: Furniture): GroundPoint {
  if (item.kind !== 'table') throw new Error('A book needs a table support');
  return { ...item.at, height: (item.at.height ?? 0) + 1.86 * (item.scale ?? 1) + 0.04 };
}
