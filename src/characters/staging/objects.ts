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
    case 'prop':
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
  const height =
    item.support?.height ??
    (item.kind === 'table'
      ? objectShape.table.top
      : item.kind === 'chair' || item.kind === 'bench'
        ? objectShape.chair.seat
        : undefined);
  if (height === undefined) throw new Error(`Object ${item.kind} has no support surface`);
  return { ...item.at, height: (item.at.height ?? 0) + height * (item.scale ?? 1) };
}
export function seatPlaces(item: Furniture): GroundPoint[] {
  const local =
    item.seats ??
    (item.kind === 'bench'
      ? [
          { x: -0.72, z: 0 },
          { x: 0.72, z: 0 },
        ]
      : item.kind === 'chair'
        ? [{ x: 0, z: 0 }]
        : []);
  const scale = item.scale ?? 1;
  return local.map((p) => ({
    x: item.at.x + p.x * scale,
    z: item.at.z + p.z * scale,
    height: (item.at.height ?? 0) + (p.height ?? 0) * scale,
  }));
}
export function triggerPoint(item: Furniture): GroundPoint {
  if (!item.trigger) throw new Error('Object has no pressable control');
  const p = item.trigger.at,
    s = item.scale ?? 1;
  return {
    x: item.at.x + p.x * s,
    z: item.at.z + p.z * s,
    height: (item.at.height ?? 0) + (p.height ?? 0) * s,
  };
}
