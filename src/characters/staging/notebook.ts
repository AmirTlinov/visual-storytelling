import type { Furniture, GroundPoint, Projection } from './types.js';
import { project } from './space.js';
import type { Quad } from '../../ink/projective.js';
import type { Part } from './geometry.js';

export type NotebookFace =
  | 'back'
  | 'side'
  | 'end'
  | 'spine'
  | 'head'
  | 'paper'
  | 'page'
  | 'cover'
  | 'label';
export const notebookPageAspect = (0.6 - 0.012) / (0.84 - 0.016);

/** A resting notebook shares its support plane with furniture. The hinge never leaves the binding. */
export function notebookGeometry(item: Furniture, open = item.open ?? 0) {
  const s = item.scale ?? 0.72,
    w = 0.6 * s,
    d = 0.84 * s,
    h = 0.035 * s;
  const x = item.at.x - w / 2,
    z = item.at.z,
    y = item.at.height ?? 0;
  const point = (u: number, v: number, lift = h): GroundPoint => ({
    x: x + u,
    z: z + d / 2 - v,
    height: y + lift,
  });
  const rectangle = (left: number, top: number, width: number, depth: number, lift = h) =>
    [
      point(left, top, lift),
      point(left + width, top, lift),
      point(left + width, top + depth, lift),
      point(left, top + depth, lift),
    ] as const;
  const page = rectangle(0.006 * s, 0.008 * s, w - 0.012 * s, d - 0.016 * s);
  const angle = Math.PI * Math.max(0, Math.min(1, open));
  const coverHeight = h + 0.003 * s;
  const front = [
    point(0, 0, coverHeight),
    point(w * Math.cos(angle), 0, coverHeight + w * Math.sin(angle)),
    point(w * Math.cos(angle), d, coverHeight + w * Math.sin(angle)),
    point(0, d, coverHeight),
  ] as const;
  const faces = [
    {
      name: 'back' as const,
      points: rectangle(-0.009 * s, -0.009 * s, w + 0.018 * s, d + 0.018 * s, 0.003 * s),
      fill: item.color ?? '#385c63',
    },
    {
      name: 'side' as const,
      points: [point(w, 0, 0), point(w, d, 0), point(w, d), point(w, 0)],
      fill: '#d6dbd8',
    },
    {
      name: 'end' as const,
      points: [point(0, d, 0), point(w, d, 0), point(w, d), point(0, d)],
      fill: '#e3e5df',
    },
    {
      name: 'spine' as const,
      points: [point(0, 0, 0), point(0, 0), point(0, d), point(0, d, 0)],
      fill: item.color ?? '#385c63',
    },
    {
      name: 'head' as const,
      points: [point(0, 0, 0), point(w, 0, 0), point(w, 0), point(0, 0)],
      fill: '#d6dbd8',
    },
    { name: 'paper' as const, points: rectangle(0, 0, w, d), fill: '#f5f5ef' },
    { name: 'page' as const, points: page, fill: '#f5f5ef' },
  ];
  const content = (aspect: number) => {
    const width = Math.min(w - 0.012 * s, (d - 0.016 * s) * aspect),
      height = width / aspect;
    return rectangle((w - width) / 2, (d - height) / 2, width, height, h + 0.001 * s);
  };
  return { faces, page, front, content, open, color: item.color ?? '#385c63' };
}
export function notebookFaces(item: Furniture, space: Projection) {
  const model = notebookGeometry(item);
  const faces: { name: NotebookFace; points: readonly GroundPoint[]; fill: string }[] = [
    ...model.faces,
    { name: 'cover', points: model.front, fill: model.open < 0.5 ? model.color : '#f6f4e9' },
  ];
  // A small paper label follows the cover, including when viewed obliquely on a table.
  if (model.open < 0.08) {
    const [a, b, , d] = model.front;
    const at = (u: number, v: number) => ({
      x: a.x + (b.x - a.x) * u + (d.x - a.x) * v,
      z: a.z + (b.z - a.z) * u + (d.z - a.z) * v,
      height:
        (a.height ?? 0) +
        ((b.height ?? 0) - (a.height ?? 0)) * u +
        ((d.height ?? 0) - (a.height ?? 0)) * v,
    });
    faces.push({
      name: 'label',
      points: [at(0.2, 0.19), at(0.83, 0.19), at(0.83, 0.55), at(0.2, 0.55)],
      fill: '#f0f0e9',
    });
  }
  return faces.map((face) => ({
    name: face.name,
    points: notebookQuad(face.points, space),
    world: face.points,
    fill: face.fill,
    stroke: 0.6,
  }));
}
export function notebookParts(item: Furniture, space: Projection): Part[] {
  const polygons = notebookFaces(item, space);
  const all = polygons.flatMap((p) => p.points);
  const x = Math.min(...all.map((p) => p.x)),
    y = Math.min(...all.map((p) => p.y));
  return [
    {
      polygons,
      svg: '',
      depth: item.at.z - 0.001,
      bounds: {
        x,
        y,
        width: Math.max(...all.map((p) => p.x)) - x,
        height: Math.max(...all.map((p) => p.y)) - y,
      },
    },
  ];
}
export const notebookQuad = (points: readonly GroundPoint[], space: Projection): Quad =>
  points.map((p) => project(space, p)) as unknown as Quad;
