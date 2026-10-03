export interface Point2 {
  x: number;
  y: number;
}
export interface Rect extends Point2 {
  width: number;
  height: number;
}
export const center = (r: Rect): Point2 => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
export const inflate = (r: Rect, gap: number): Rect => ({
  x: r.x - gap,
  y: r.y - gap,
  width: r.width + gap * 2,
  height: r.height + gap * 2,
});
export const overlaps = (a: Rect, b: Rect, gap = 0) =>
  a.x < b.x + b.width + gap &&
  b.x < a.x + a.width + gap &&
  a.y < b.y + b.height + gap &&
  b.y < a.y + a.height + gap;
export const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;
export function bounds(points: readonly Point2[]): Rect {
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y),
    x = Math.min(...xs),
    y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
export function inPolygon(point: Point2, polygon: readonly Point2[]) {
  let sign = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!,
      b = polygon[(i + 1) % polygon.length]!;
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (Math.abs(cross) < 0.01) continue;
    if (sign && Math.sign(cross) !== sign) return false;
    sign = Math.sign(cross);
  }
  return true;
}
export function rectInPolygon(r: Rect, p: readonly Point2[], padding = 0) {
  const q = inflate(r, padding);
  return [
    { x: q.x, y: q.y },
    { x: q.x + q.width, y: q.y },
    { x: q.x + q.width, y: q.y + q.height },
    { x: q.x, y: q.y + q.height },
  ].every((v) => inPolygon(v, p));
}
export function boundary(
  r: Rect,
  toward: Point2,
  shape: 'rect' | 'ellipse' = 'rect',
  gap = 0,
): Point2 {
  const c = center(r),
    dx = toward.x - c.x,
    dy = toward.y - c.y,
    length = Math.hypot(dx, dy) || 1;
  const rx = Math.max(0.001, r.width / 2),
    ry = Math.max(0.001, r.height / 2);
  const f =
    shape === 'ellipse'
      ? 1 / Math.hypot(dx / rx, dy / ry)
      : 1 / Math.max(Math.abs(dx) / rx, Math.abs(dy) / ry);
  return {
    x: c.x + dx * (Number.isFinite(f) ? f : 0) + (gap * dx) / length,
    y: c.y + dy * (Number.isFinite(f) ? f : 0) + (gap * dy) / length,
  };
}
/** Open interior intersection: travelling along an inflated obstacle edge is safe. */
export function crosses(a: Point2, b: Point2, r: Rect) {
  const q = inflate(r, -0.01);
  let lo = 0,
    hi = 1;
  for (const [start, delta, min, max] of [
    [a.x, b.x - a.x, q.x, q.x + q.width],
    [a.y, b.y - a.y, q.y, q.y + q.height],
  ]) {
    if (Math.abs(delta!) < 1e-9) {
      if (start! <= min! || start! >= max!) return false;
      continue;
    }
    const first = (min! - start!) / delta!,
      last = (max! - start!) / delta!;
    lo = Math.max(lo, Math.min(first, last));
    hi = Math.min(hi, Math.max(first, last));
    if (lo >= hi) return false;
  }
  return hi > 0 && lo < 1;
}
/** Shortest visible route around occupied rectangles; no scene coordinates are encoded. */
export function route(start: Point2, end: Point2, obstacles: readonly Rect[]): Point2[] {
  return visibleRoute([start], [end], obstacles);
}
function visibleRoute(
  starts: readonly Point2[],
  ends: readonly Point2[],
  obstacles: readonly Rect[],
): Point2[] {
  obstacles = obstacles.filter(
    (r, i) =>
      !obstacles.some(
        (other, j) =>
          j !== i &&
          contains(other, r) &&
          (other.width * other.height > r.width * r.height || j < i),
      ),
  );
  const direct = starts
    .flatMap((start) =>
      ends.map((end) => ({ start, end, length: Math.hypot(start.x - end.x, start.y - end.y) })),
    )
    .sort((a, b) => a.length - b.length);
  const clear = direct.find(({ start, end }) => !obstacles.some((r) => crosses(start, end, r)));
  if (clear) return [clear.start, clear.end];
  const nodes = [
    ...starts,
    ...ends,
    ...obstacles.flatMap((r) => [
      { x: r.x, y: r.y },
      { x: r.x + r.width, y: r.y },
      { x: r.x + r.width, y: r.y + r.height },
      { x: r.x, y: r.y + r.height },
    ]),
  ];
  const distances = nodes.map((_, i) => (i < starts.length ? 0 : Infinity)),
    previous = nodes.map(() => -1),
    visited = new Set<number>();
  for (let count = 0; count < nodes.length; count++) {
    let current = -1;
    for (let i = 0; i < nodes.length; i++)
      if (!visited.has(i) && (current < 0 || distances[i]! < distances[current]!)) current = i;
    if (current < 0 || !Number.isFinite(distances[current]!)) break;
    if (current >= starts.length && current < starts.length + ends.length) {
      const path: Point2[] = [];
      for (let i = current; i >= 0; i = previous[i]!) path.unshift(nodes[i]!);
      return path;
    }
    visited.add(current);
    for (let i = 0; i < nodes.length; i++) {
      if (visited.has(i) || obstacles.some((r) => crosses(nodes[current]!, nodes[i]!, r))) continue;
      const d =
        distances[current]! +
        Math.hypot(nodes[current]!.x - nodes[i]!.x, nodes[current]!.y - nodes[i]!.y) +
        0.2;
      if (d < distances[i]!) {
        distances[i] = d;
        previous[i] = current;
      }
    }
  }
  return [];
}
export function connector(
  a: Rect,
  b: Rect,
  obstacles: readonly Rect[] = [],
  {
    gap = 5,
    fromShape = 'rect',
    toShape = 'rect',
  }: { gap?: number; fromShape?: 'rect' | 'ellipse'; toShape?: 'rect' | 'ellipse' } = {},
) {
  if (overlaps(a, b)) return [];
  const ports = (r: Rect, toward: Point2, shape: 'rect' | 'ellipse') => {
    const c = center(r),
      q = inflate(r, gap);
    return [
      toward,
      { x: c.x - 1, y: c.y },
      { x: c.x + 1, y: c.y },
      { x: c.x, y: c.y - 1 },
      { x: c.x, y: c.y + 1 },
    ].map((p) => boundary(q, p, shape));
  };
  return visibleRoute(ports(a, center(b), fromShape), ports(b, center(a), toShape), [
    ...(fromShape === 'rect' ? [inflate(a, gap - 0.1)] : []),
    ...(toShape === 'rect' ? [inflate(b, gap - 0.1)] : []),
    ...obstacles.map((r) => inflate(r, gap)),
  ]);
}
export const pathData = (points: readonly Point2[]) =>
  points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
