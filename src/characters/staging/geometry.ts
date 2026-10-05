import { project } from './space.js';
import type { Furniture, GroundPoint, Projection } from './types.js';

export interface Part {
  svg: string;
  polygons: {
    points: readonly { x: number; y: number }[];
    /** Absolute world vertices; alternate cameras project these without inverting a flattened face. */
    world: readonly GroundPoint[];
    fill: string;
    stroke: number;
  }[];
  depth: number;
  bounds: { x: number; y: number; width: number; height: number };
}
export const stageInk = '#2a4145';
export type WorldPath = (
  vertices: readonly (readonly number[])[],
  fill: string,
  stroke?: number,
) => string;

/** Closed solid: every view uses the same six faces, including furniture sides and undersides. */
export function cuboid(
  path: WorldPath,
  lo: readonly [number, number, number],
  hi: readonly [number, number, number],
  fill: string,
  top = fill,
) {
  const [x, y, z] = lo,
    [X, Y, Z] = hi;
  return [
    [
      [x, y, Z],
      [X, y, Z],
      [X, Y, Z],
      [x, Y, Z],
    ],
    [
      [x, y, z],
      [X, y, z],
      [X, y, Z],
      [x, y, Z],
    ],
    [
      [x, y, z],
      [x, y, Z],
      [x, Y, Z],
      [x, Y, z],
    ],
    [
      [X, y, z],
      [X, y, Z],
      [X, Y, Z],
      [X, Y, z],
    ],
    [
      [x, Y, z],
      [X, Y, z],
      [X, Y, Z],
      [x, Y, Z],
    ],
    [
      [x, y, z],
      [X, y, z],
      [X, Y, z],
      [x, Y, z],
    ],
  ]
    .map((face, i) => path(face, i === 4 ? top : fill))
    .join('');
}
/** Authored vertices, rendered contours and depth all share one world projection. */
export function projectedParts(item: Furniture, space: Projection) {
  const scale = item.scale ?? 1,
    at = item.at,
    parts: Part[] = [];
  const group = (depth: number, draw: (path: WorldPath) => string) => {
    const points: { x: number; y: number }[] = [],
      polygons: Part['polygons'] = [];
    const path: WorldPath = (vertices, fill, stroke = 3) => {
      const world = vertices.map(([x, y, z]) => ({
          x: at.x + x! * scale,
          z: at.z + z! * scale,
          height: (at.height ?? 0) + y! * scale,
        })),
        ps = world.map((point) => project(space, point));
      points.push(...ps);
      polygons.push({ points: ps, world, fill, stroke });
      return `<path d="${ps.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('')}Z" fill="${fill}" stroke="${stageInk}" stroke-width="${stroke}" stroke-linejoin="round"/>`;
    };
    const svg = draw(path);
    const left = Math.min(...points.map((p) => p.x)) - 6,
      top = Math.min(...points.map((p) => p.y)) - 6;
    parts.push({
      svg,
      polygons,
      depth: at.z + depth * scale,
      bounds: {
        x: left,
        y: top,
        width: Math.max(...points.map((p) => p.x)) - left + 6,
        height: Math.max(...points.map((p) => p.y)) - top + 6,
      },
    });
  };
  return { parts, group };
}
