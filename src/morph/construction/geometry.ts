import type { DiagramPoint, DiagramBounds } from './types.js';

export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
export const number = (x: number) => Number(x.toFixed(2)).toString().replace('-', '−');
export function finite(...values: number[]) {
  if (!values.every(Number.isFinite)) throw new Error('Construction values must be finite');
}
export function positive(...values: number[]) {
  finite(...values);
  if (values.some((v) => v <= 0)) throw new Error('Construction dimensions must be positive');
}
export function sample(fn: (t: number) => DiagramPoint, from: number, to: number, count = 96) {
  return Array.from({ length: count + 1 }, (_, i) => fn(lerp(from, to, i / count)));
}
export function boundsOf(points: readonly DiagramPoint[]): DiagramBounds {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y] of points) {
    finite(x, y);
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  finite(x0, y0, x1, y1);
  return [
    [x0, y0],
    [x1, y1],
  ];
}
export function padded(bounds: DiagramBounds, fraction = 0.12): DiagramBounds {
  const [[x0, y0], [x1, y1]] = bounds;
  const dx = Math.max(0.5, x1 - x0) * fraction,
    dy = Math.max(0.5, y1 - y0) * fraction;
  finite(x0 - dx, y0 - dy, x1 + dx, y1 + dy);
  return [
    [x0 - dx, y0 - dy],
    [x1 + dx, y1 + dy],
  ];
}
