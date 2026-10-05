import {
  Color,
  GLTexture,
  type SceneRenderer,
  type ManagedWebGLRenderingContext,
} from '@esotericsoftware/spine-webgl';
import { objectShape } from './objects.js';
import type { Furniture, Projection } from './types.js';

import { projectedParts, cuboid, stageInk as ink, type Part } from './geometry.js';
import { doorwayParts } from './doorway.js';

/** Furniture keeps its physical contacts in the same projected world as its artwork. */
export function furnitureParts(item: Furniture, space: Projection, open?: number): Part[] {
  if (item.kind === 'door') return doorwayParts(item, space, open);
  const { parts, group } = projectedParts(item, space);
  const wood = item.color ?? '#aa8057';
  if (item.kind === 'chair' || item.kind === 'bench') {
    const w = objectShape[item.kind].halfWidth;
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
  } else if (item.kind === 'stairs') {
    const d = objectShape.stairs,
      w = d.halfWidth,
      top = d.steps * d.rise,
      end = d.steps * d.tread;
    group(
      end + d.landing / 2,
      (path) =>
        path(
          [
            [-w, top, end],
            [w, top, end],
            [w, top, end + d.landing],
            [-w, top, end + d.landing],
          ],
          '#d2c19c',
        ) +
        path(
          [
            [-w, 0, end],
            [w, 0, end],
            [w, top, end],
            [-w, top, end],
          ],
          '#a29d84',
        ) +
        path(
          [
            [-w, 0, end],
            [-w, top, end],
            [-w, top, end + d.landing],
            [-w, 0, end + d.landing],
          ],
          '#899784',
        ),
    );
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
    // Rail follows the stair pitch and continues across its usable landing.
    for (let i = 0; i <= d.steps; i += 2)
      group(i * d.tread - 0.015, (path) => {
        const z = i * d.tread,
          y = Math.min(top, (i + 1) * d.rise),
          next = Math.min(end, z + 2 * d.tread);
        let svg = path(
          [
            [-w - 0.04, y, z],
            [-w + 0.04, y, z],
            [-w + 0.04, y + 1.05, z],
            [-w - 0.04, y + 1.05, z],
          ],
          '#5c7668',
          1.6,
        );
        if (i < d.steps)
          svg += path(
            [
              [-w, y + 0.97, z],
              [-w, y + 1.05, z],
              [-w, Math.min(top, (i + 3) * d.rise) + 1.05, next],
              [-w, Math.min(top, (i + 3) * d.rise) + 0.97, next],
            ],
            '#5c7668',
            1.6,
          );
        else
          svg += path(
            [
              [-w, top + 0.97, end],
              [-w, top + 1.05, end],
              [-w, top + 1.05, end + d.landing],
              [-w, top + 0.97, end + d.landing],
            ],
            '#5c7668',
            1.6,
          );
        return svg;
      });
  } else if (item.kind === 'table') {
    group(0, (path) => {
      let out = '';
      for (const z of [0.34, -0.34])
        for (const x of [-0.78, 0.78])
          out += cuboid(path, [x - 0.055, 0, z - 0.055], [x + 0.055, 1.8, z + 0.055], wood);
      out += cuboid(path, [-0.95, 1.74, -0.48], [0.95, 1.86, 0.48], wood, '#c5a573');
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
