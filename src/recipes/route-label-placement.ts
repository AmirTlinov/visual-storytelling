import type { Point } from '../ink/pen.js';

type Bounds = { x: number; y: number; width: number; height: number };

/** Labels stay outside the swept order, using all declared routes so conditions cannot move them. */
export function routeLabelPlacement(
  ink: Bounds,
  center: Point,
  edges: readonly (readonly [Point, Point])[],
  viewport: Point,
  radius: number,
  packet: Point,
  gap: number,
): Point {
  const intersects = (a: Point, b: Point, box: Bounds) => {
    let low = 0,
      high = 1;
    for (let axis = 0; axis < 2; axis++) {
      const start = a[axis]!,
        delta = b[axis]! - start;
      const min = axis ? box.y : box.x;
      const max = min + (axis ? box.height : box.width);
      if (Math.abs(delta) < 1e-9) {
        if (start < min || start > max) return false;
      } else {
        const u = (min - start) / delta,
          v = (max - start) / delta;
        low = Math.max(low, Math.min(u, v));
        high = Math.min(high, Math.max(u, v));
        if (low > high) return false;
      }
    }
    return true;
  };
  let best: Point | undefined,
    score = Infinity;
  for (const extra of [0, gap, gap * 2, gap * 3, gap * 4]) {
    const distance = radius + gap + extra;
    const candidates: Point[] = [
      [0, distance - ink.y],
      [0, -distance - ink.y - ink.height],
      [-distance - ink.x - ink.width, -ink.y - ink.height / 2],
      [distance - ink.x, -ink.y - ink.height / 2],
    ];
    for (const candidate of candidates) {
      const box = {
        ...ink,
        x: center[0] + candidate[0] + ink.x,
        y: center[1] + candidate[1] + ink.y,
      };
      if (
        box.x < gap ||
        box.y < gap ||
        box.x + box.width > viewport[0] - gap ||
        box.y + box.height > viewport[1] - gap
      )
        continue;
      const swept = {
        x: box.x - packet[0] / 2 - gap / 2,
        y: box.y - packet[1] / 2 - gap / 2,
        width: box.width + packet[0] + gap,
        height: box.height + packet[1] + gap,
      };
      const collisions = edges.filter(([a, b]) => intersects(a, b, swept)).length;
      if (collisions) continue;
      const cost = extra / gap;
      if (cost < score) {
        best = candidate;
        score = cost;
      }
    }
  }
  if (!best) throw new Error('The route label needs room outside the moving order.');
  return best;
}
