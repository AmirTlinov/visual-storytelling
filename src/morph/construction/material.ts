import { fusionText } from '../../ink/fusion/text.js';
import type { MaterialPatch } from './types.js';

export type UV = readonly [number, number];
/** Fixed material coordinates. Both renderers transport exactly these contours, grid and glyphs. */
export function materialDrawing() {
  let previous = '',
    writing: ReturnType<typeof fusionText> | undefined;
  return (patch: MaterialPatch) => {
    const [[x0, y0], [x1, y1]] = patch.domain;
    const edge = (a: UV, b: UV, closed = false): UV[] =>
      Array.from({ length: closed ? 32 : 33 }, (_, i) => [
        a[0] + ((b[0] - a[0]) * i) / 32,
        a[1] + ((b[1] - a[1]) * i) / 32,
      ]);
    const boundary = [
      ...edge([x0, y0], [x1, y0], true),
      ...edge([x1, y0], [x1, y1], true),
      ...edge([x1, y1], [x0, y1], true),
      ...edge([x0, y1], [x0, y0], true),
    ];
    const grid: UV[][] = [];
    if (patch.grid)
      for (const axis of [0, 1] as const)
        for (let i = 1; i < patch.grid[axis]; i++) {
          const v =
            patch.domain[0][axis] +
            ((patch.domain[1][axis] - patch.domain[0][axis]) * i) / patch.grid[axis];
          grid.push(axis === 0 ? edge([v, y0], [v, y1]) : edge([x0, v], [x1, v]));
        }
    if (previous !== patch.text) {
      previous = patch.text ?? '';
      writing = previous ? fusionText(previous, { size: 100, maxWidth: 1200 }) : undefined;
    }
    const k = writing
      ? Math.min(
          ((x1 - x0) * 0.66) / writing.bounds.width,
          ((y1 - y0) * 0.5) / writing.bounds.height,
        )
      : 0;
    const strokes: UV[][] =
      writing?.paths.map((stroke) =>
        stroke.map(([x, y]): UV => [(x0 + x1) / 2 + x * k, (y0 + y1) / 2 - y * k]),
      ) ?? [];
    return { boundary, grid, strokes, weight: k * 2.8 };
  };
}
