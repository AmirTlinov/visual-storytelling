import {
  Color,
  GLTexture,
  type SceneRenderer,
  type ManagedWebGLRenderingContext,
} from '@esotericsoftware/spine-webgl';
import { objectShape } from './objects.js';
import { project } from './space.js';
import type { Furniture, Projection } from './types.js';

export interface Part {
  svg: string;
  polygons: { points: { x: number; y: number }[]; fill: string; stroke: number }[];
  depth: number;
  bounds: { x: number; y: number; width: number; height: number };
}
const ink = '#2a4145';
/** Geometry and contacts use the same metres and projection. No perspective is painted by eye. */
export function furnitureParts(item: Furniture, space: Projection, open?: number): Part[] {
  const s = item.scale ?? 1,
    a = item.at,
    parts: Part[] = [];
  const p = (x: number, y: number, z: number) =>
    project(space, { x: a.x + x * s, z: a.z + z * s, height: (a.height ?? 0) + y * s });
  const group = (
    depth: number,
    draw: (path: (points: number[][], fill: string, stroke?: number) => string) => string,
  ) => {
    const points: { x: number; y: number }[] = [],
      polygons: Part['polygons'] = [];
    const path = (vertices: number[][], fill: string, stroke = 3) => {
      const ps = vertices.map((v) => p(v[0]!, v[1]!, v[2]!));
      points.push(...ps);
      polygons.push({ points: ps, fill, stroke });
      return `<path d="${ps.map((v, i) => `${i ? 'L' : 'M'}${v.x.toFixed(2)} ${v.y.toFixed(2)}`).join('')}Z" fill="${fill}" stroke="${ink}" stroke-width="${stroke}" stroke-linejoin="round"/>`;
    };
    const svg = draw(path);
    const left = Math.min(...points.map((p) => p.x)) - 6,
      top = Math.min(...points.map((p) => p.y)) - 6;
    parts.push({
      svg,
      polygons,
      depth: a.z + depth * s,
      bounds: {
        x: left,
        y: top,
        width: Math.max(...points.map((p) => p.x)) - left + 6,
        height: Math.max(...points.map((p) => p.y)) - top + 6,
      },
    });
  };
  const wood = item.color ?? '#aa8057';
  if (item.kind === 'chair' || item.kind === 'bench') {
    const w = item.kind === 'bench' ? 1.45 : 0.68;
    group(0.24, (path) => {
      let out = '';
      for (const x of [-w, w])
        out += path(
          [
            [x - 0.06, 0, 0.25],
            [x + 0.06, 0, 0.25],
            [x + 0.08, 2.45, 0.25],
            [x - 0.08, 2.45, 0.25],
          ],
          wood,
        );
      out += path(
        [
          [-w, 1.57, 0.27],
          [w, 1.57, 0.27],
          [w, 2.36, 0.27],
          [-w, 2.36, 0.27],
        ],
        wood,
      );
      out += path(
        [
          [-w, 1.08, -0.28],
          [w, 1.08, -0.28],
          [w, 1.08, 0.28],
          [-w, 1.08, 0.28],
        ],
        '#cfab76',
      );
      return out;
    });
    group(-0.29, (path) => {
      let out = path(
        [
          [-w, 1.1, -0.28],
          [w, 1.1, -0.28],
          [w, 0.98, -0.28],
          [-w, 0.98, -0.28],
        ],
        wood,
      );
      for (const x of [-w + 0.09, w - 0.09])
        out += path(
          [
            [x - 0.07, 0, -0.25],
            [x + 0.07, 0, -0.25],
            [x + 0.07, 1.04, -0.25],
            [x - 0.07, 1.04, -0.25],
          ],
          wood,
        );
      return out;
    });
  } else if (item.kind === 'door') {
    const d = objectShape.door,
      w = d.width / 2,
      h = d.height;
    if (open === undefined) {
      group(5, (path) =>
        path(
          [
            [-w, 0, 0],
            [w, 0, 0],
            [w, h, 0],
            [-w, h, 0],
          ],
          '#233f40',
        ),
      );
      group(
        0.05,
        (path) =>
          path(
            [
              [-w - 0.14, 0, 0],
              [-w, 0, 0],
              [-w, h + 0.14, 0],
              [-w - 0.14, h + 0.14, 0],
            ],
            '#b49b70',
          ) +
          path(
            [
              [w, 0, 0],
              [w + 0.14, 0, 0],
              [w + 0.14, h + 0.14, 0],
              [w, h + 0.14, 0],
            ],
            '#b49b70',
          ) +
          path(
            [
              [-w, h, 0],
              [w, h, 0],
              [w, h + 0.14, 0],
              [-w, h + 0.14, 0],
            ],
            '#b49b70',
          ),
      );
    } else
      group(Math.sin(open * Math.PI * 0.47) * w, (path) => {
        const a = open * Math.PI * 0.47,
          cs = Math.cos(a),
          sn = Math.sin(a);
        const quad = (x: number, y: number, width: number, height: number, fill: string) =>
          path(
            [
              [x, y, 0],
              [x + width, y, 0],
              [x + width, y + height, 0],
              [x, y + height, 0],
            ].map(([x, y]) => [-w + x! * cs, y!, x! * sn]),
            fill,
          );
        return (
          quad(0, 0, d.width, h, wood) +
          quad(0.2, 0.25, d.width - 0.4, 1.65, '#907754') +
          quad(0.2, 2.5, d.width - 0.4, 1.75, '#bea275') +
          quad(d.handleX - 0.1, d.handleHeight - 0.07, 0.2, 0.14, '#edce82')
        );
      });
  } else if (item.kind === 'stairs') {
    const d = objectShape.stairs,
      w = 0.85;
    for (let i = d.steps - 1; i >= 0; i--)
      group((i + 0.5) * d.tread, (path) => {
        const y = (i + 1) * d.rise,
          z = i * d.tread;
        return (
          path(
            [
              [-w, y, z],
              [w, y, z],
              [w, y, z + d.tread],
              [-w, y, z + d.tread],
            ],
            '#c7b390',
          ) +
          path(
            [
              [-w, i * d.rise, z],
              [w, i * d.rise, z],
              [w, y, z],
              [-w, y, z],
            ],
            '#9c8f76',
          )
        );
      });
  } else if (item.kind === 'table') {
    group(0, (path) => {
      let out = '';
      for (const x of [-0.78, 0.78])
        for (const z of [-0.34, 0.34])
          out += path(
            [
              [x - 0.055, 0, z],
              [x + 0.055, 0, z],
              [x + 0.055, 1.8, z],
              [x - 0.055, 1.8, z],
            ],
            wood,
          );
      out += path(
        [
          [-0.95, 1.74, -0.48],
          [0.95, 1.74, -0.48],
          [0.95, 1.86, -0.48],
          [-0.95, 1.86, -0.48],
        ],
        wood,
      );
      out += path(
        [
          [-0.95, 1.86, -0.48],
          [0.95, 1.86, -0.48],
          [0.95, 1.86, 0.48],
          [-0.95, 1.86, 0.48],
        ],
        '#c5a573',
      );
      return out;
    });
  } else if (item.kind === 'tree') {
    group(
      0,
      (path) =>
        path(
          [
            [-0.11, 0, 0],
            [0.14, 0, 0],
            [0.09, 2.5, 0],
            [-0.06, 2.5, 0],
          ],
          '#89724f',
        ) +
        path(
          [
            [-0.82, 1.7, 0],
            [-1.14, 2.34, 0],
            [-0.8, 2.91, 0],
            [-0.64, 3.58, 0],
            [0, 3.9, 0],
            [0.58, 3.62, 0],
            [0.91, 2.85, 0],
            [1.02, 2.16, 0],
            [0.54, 1.66, 0],
          ],
          '#709378',
        ) +
        path(
          [
            [-0.57, 2.5, 0.001],
            [-0.56, 3.14, 0.001],
            [-0.08, 3.49, 0.001],
            [0.4, 3.13, 0.001],
            [0.45, 2.56, 0.001],
            [0.01, 2.2, 0.001],
          ],
          '#8ba37f',
          0,
        ),
    );
  } else if (item.kind === 'lamp') {
    group(
      0,
      (path) =>
        path(
          [
            [-0.055, 0, 0],
            [0.055, 0, 0],
            [0.055, 4.7, 0],
            [-0.055, 4.7, 0],
          ],
          '#536e69',
        ) +
        path(
          [
            [-0.25, 0, 0],
            [0.25, 0, 0],
            [0.14, 0.2, 0],
            [-0.14, 0.2, 0],
          ],
          '#465d57',
        ) +
        path(
          [
            [-0.23, 4.04, 0],
            [0.23, 4.04, 0],
            [0.35, 4.67, 0],
            [-0.35, 4.67, 0],
          ],
          '#f4daa0',
        ) +
        path(
          [
            [-0.43, 4.67, 0],
            [0.43, 4.67, 0],
            [0.16, 4.95, 0],
            [-0.16, 4.95, 0],
          ],
          '#58716a',
        ),
    );
  } else if (item.kind === 'board') {
    group(
      0,
      (path) =>
        path(
          [
            [-1.8, 0.6, 0],
            [-1.7, 0.6, 0],
            [-1.3, 3.5, 0],
            [-1.4, 3.5, 0],
          ],
          wood,
        ) +
        path(
          [
            [1.8, 0.6, 0],
            [1.7, 0.6, 0],
            [1.3, 3.5, 0],
            [1.4, 3.5, 0],
          ],
          wood,
        ) +
        path(
          [
            [-2, 1.8, 0],
            [2, 1.8, 0],
            [2, 4, 0],
            [-2, 4, 0],
          ],
          wood,
        ) +
        path(
          [
            [-1.86, 1.96, 0],
            [1.86, 1.96, 0],
            [1.86, 3.84, 0],
            [-1.86, 3.84, 0],
          ],
          '#385855',
        ),
    );
  }
  return parts;
}
export async function loadFurniture(
  context: ManagedWebGLRenderingContext,
  objects: Readonly<Record<string, Furniture>>,
  space: Projection,
) {
  const parts: { id: string; depth: number; texture: GLTexture; bounds: Part['bounds'] }[] = [];
  try {
    for (const [id, object] of Object.entries(objects))
      for (const part of furnitureParts(object, space)) {
        const b = part.bounds,
          image = new Image();
        image.src =
          'data:image/svg+xml;charset=utf-8,' +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(b.width * 2)}" height="${Math.ceil(b.height * 2)}" viewBox="${b.x} ${b.y} ${b.width} ${b.height}">${part.svg}</svg>`,
          );
        await image.decode();
        parts.push({
          id,
          depth: part.depth,
          bounds: b,
          texture: new GLTexture(context, image, false),
        });
      }
    return { parts, dispose: () => parts.forEach((p) => p.texture.dispose()) };
  } catch (error) {
    parts.forEach((p) => p.texture.dispose());
    throw error;
  }
}
export const color = (hex: string, alpha = 1) => {
  const c = Color.fromString(hex);
  c.a = alpha;
  return c;
};
export interface BookFrame {
  id: string;
  x: number;
  y: number;
  scale: number;
  turn: number;
  handTurn: number;
  color: string;
}
export function bookHands(book: BookFrame) {
  const w = 82 * book.scale,
    h = 42 * book.scale;
  return {
    left: { x: book.x - w, y: book.y + h * 0.15 },
    right: {
      x: book.x + Math.cos(Math.PI * book.handTurn) * w * 0.72,
      y: book.y + h * 0.2256 - Math.sin(Math.PI * book.handTurn) * h * 1.3 * 0.72,
    },
  };
}
export function drawBook(renderer: SceneRenderer, book: BookFrame, height: number) {
  const s = book.scale,
    w = 82 * s,
    h = 42 * s,
    cx = book.x,
    cy = book.y;
  const poly = (xy: number[][], fill: string, stroke = ink) => {
    const points = xy.flatMap(([x, y]) => [cx + x!, height - (cy + y!)]);
    const fillColor = color(fill);
    for (let i = 2; i < xy.length; i++)
      renderer.triangle(
        true,
        points[0]!,
        points[1]!,
        points[(i - 1) * 2]!,
        points[(i - 1) * 2 + 1]!,
        points[i * 2]!,
        points[i * 2 + 1]!,
        fillColor,
        fillColor,
        fillColor,
      );
    for (let i = 0; i < xy.length; i++) {
      const a = xy[i]!,
        b = xy[(i + 1) % xy.length]!;
      renderer.rectLine(
        true,
        cx + a[0]!,
        height - cy - a[1]!,
        cx + b[0]!,
        height - cy - b[1]!,
        2.7 * s,
        color(stroke),
      );
    }
  };
  poly(
    [
      [-w - 5 * s, -h * 0.9],
      [0, -h * 0.63],
      [w + 5 * s, -h * 0.9],
      [w + 5 * s, h * 0.38],
      [0, h * 0.62],
      [-w - 5 * s, h * 0.38],
    ],
    book.color,
  );
  poly(
    [
      [-w, -h],
      [0, -h * 0.65],
      [0, h * 0.42],
      [-w, h * 0.15],
    ],
    '#e3d8b6',
  );
  poly(
    [
      [0, -h * 0.65],
      [w, -h],
      [w, h * 0.15],
      [0, h * 0.42],
    ],
    '#f7eccb',
  );
  for (const side of [-1, 1])
    for (let row = 0; row < 4; row++) {
      const x1 = side * 12 * s,
        x2 = side * 59 * s,
        y = -h * 0.43 + row * 8 * s;
      renderer.rectLine(
        true,
        cx + x1,
        height - cy - y,
        cx + x2,
        height - cy - y + (side > 0 ? 6 : -6) * s,
        1.5 * s,
        color('#a89e7e'),
      );
    }
  if (book.turn > 0.001 && book.turn < 0.999) {
    const x = Math.cos(Math.PI * book.turn) * w,
      raise = Math.sin(Math.PI * book.turn) * h * 1.3;
    poly(
      [
        [0, -h * 0.65],
        [x, -h - raise],
        [x, h * 0.15 - raise],
        [0, h * 0.42],
      ],
      book.turn < 0.5 ? '#fff4d6' : '#ddd1af',
    );
  }
}

export function drawFurniture(renderer: SceneRenderer, part: Part, height: number) {
  for (const polygon of part.polygons) {
    const points = polygon.points,
      fillColor = color(polygon.fill);
    for (let i = 2; i < points.length; i++)
      renderer.triangle(
        true,
        points[0]!.x,
        height - points[0]!.y,
        points[i - 1]!.x,
        height - points[i - 1]!.y,
        points[i]!.x,
        height - points[i]!.y,
        fillColor,
        fillColor,
        fillColor,
      );
    if (polygon.stroke)
      for (let i = 0; i < points.length; i++) {
        const a = points[i]!,
          b = points[(i + 1) % points.length]!;
        renderer.rectLine(true, a.x, height - a.y, b.x, height - b.y, polygon.stroke, color(ink));
      }
  }
}
