import type { Furniture, GroundPoint } from './types.js';

/** The same geometry describes rendering, approach positions and contact targets. */
export const objectShape = {
  chair: { seat: 1.1 },
  door: { width: 2.2, height: 4.6, handleX: 1.88, handleHeight: 2.12 },
  stairs: { rise: 0.28, tread: 0.38, steps: 8 },
} as const;
export function doorHandle(item: Furniture, open: number): GroundPoint {
  const s = item.scale ?? 1,
    a = open * Math.PI * 0.47,
    d = objectShape.door;
  return {
    x: item.at.x + (-d.width / 2 + d.handleX * Math.cos(a)) * s,
    z: item.at.z + d.handleX * Math.sin(a) * s,
    height: (item.at.height ?? 0) + d.handleHeight * s,
  };
}
export function stairEnd(item: Furniture): GroundPoint {
  const s = item.scale ?? 1,
    d = objectShape.stairs;
  return {
    x: item.at.x,
    z: item.at.z + d.steps * d.tread * s,
    height: (item.at.height ?? 0) + d.steps * d.rise * s,
  };
}
export function approach(item: Furniture, scale: number, open = 0): GroundPoint {
  if (item.kind === 'door') {
    const handle = doorHandle(item, open);
    return { x: handle.x - 0.72 * scale, z: handle.z - 0.8, height: item.at.height ?? 0 };
  }
  return { ...item.at, height: item.at.height ?? 0 };
}

export function supportPoint(item: Furniture): GroundPoint {
  if (item.kind !== 'table') throw new Error('A book needs a table support');
  return { ...item.at, height: (item.at.height ?? 0) + 1.86 * (item.scale ?? 1) + 0.04 };
}
