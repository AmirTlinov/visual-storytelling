import { project } from './space.js';
import type { Furniture, Projection } from './types.js';

export interface Part {
  svg: string;
  polygons: { points: { x: number; y: number }[]; fill: string; stroke: number }[];
  depth: number;
  bounds: { x: number; y: number; width: number; height: number };
}
export const stageInk = '#2a4145';
export type WorldPath = (vertices: number[][], fill: string, stroke?: number) => string;
/** Authored vertices, rendered contours and depth all share one world projection. */
export function projectedParts(item: Furniture, space: Projection) {
  const scale = item.scale ?? 1,
    at = item.at,
    parts: Part[] = [];
  const group = (depth: number, draw: (path: WorldPath) => string) => {
    const points: { x: number; y: number }[] = [],
      polygons: Part['polygons'] = [];
    const path: WorldPath = (vertices, fill, stroke = 3) => {
      const ps = vertices.map(([x, y, z]) =>
        project(space, {
          x: at.x + x! * scale,
          z: at.z + z! * scale,
          height: (at.height ?? 0) + y! * scale,
        }),
      );
      points.push(...ps);
      polygons.push({ points: ps, fill, stroke });
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
