import type { Furniture, GroundPoint } from './types.js';
import { doorway } from './doorway.js';

/** The same geometry describes rendering, approach positions and contact targets. */
export const objectShape = {
  chair: { seat: 1.1, halfWidth: 0.68, halfDepth: 0.28 },
  bench: { halfWidth: 1.45 },
  table: { halfWidth: 0.95, halfDepth: 0.48, top: 1.86 },
  stairs: { rise: 0.28, tread: 0.38, steps: 8, landing: 1.4, halfWidth: 1.03 },
} as const;
export interface Footprint {
  left: number;
  right: number;
  front: number;
  back: number;
}
/** Physical footprint, excluding foliage and other artwork above a walker's feet. */
export function footprint(item: Furniture): Footprint | undefined {
  const s = item.scale ?? 1,
    a = item.at;
  let w: number, front: number, back: number;
  switch (item.kind) {
    case 'book':
      return undefined;
    case 'table':
      w = objectShape.table.halfWidth;
      front = -objectShape.table.halfDepth;
      back = -front;
      break;
    case 'chair':
    case 'bench':
      w = objectShape[item.kind].halfWidth;
      front = -objectShape.chair.halfDepth;
      back = -front;
      break;
    case 'stairs':
      w = objectShape.stairs.halfWidth;
      front = 0;
      back = objectShape.stairs.steps * objectShape.stairs.tread + objectShape.stairs.landing;
      break;
    case 'door':
      w = doorway.wallWidth / 2;
      front = -0.15;
      back = doorway.reveal;
      break;
    case 'board':
      w = 1.8;
      front = -0.12;
      back = 0.12;
      break;
    case 'tree':
      w = 0.14;
      front = -0.12;
      back = 0.12;
      break;
    case 'lamp':
      w = 0.25;
      front = -0.12;
      back = 0.12;
      break;
  }
  return { left: a.x - w * s, right: a.x + w * s, front: a.z + front * s, back: a.z + back * s };
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
export function supportPoint(item: Furniture): GroundPoint {
  if (item.kind !== 'table') throw new Error('A book needs a table support');
  return {
    ...item.at,
    height: (item.at.height ?? 0) + objectShape.table.top * (item.scale ?? 1) + 0.04,
  };
}
