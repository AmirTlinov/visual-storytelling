import type { Point } from '@visual-storytelling/core';

export function circuitGeometry(width: number) {
  const compact = width < 520;
  const left = width * 0.25,
    right = width * 0.75;
  const top = 68,
    bottom = compact ? 308 : 350;
  const middle = (top + bottom) / 2;
  const plateHalf = Math.min(72, width * 0.12),
    plateTop = middle - 21,
    plateBottom = middle + 21;
  const radius = Math.min(49, width * 0.071),
    turns = 7,
    samples = turns * 80;
  const upper: Point[] = [
    [left, plateTop],
    [left, top + 4],
    [left + 4, top],
    [right, top],
  ];
  const lower: Point[] = [
    [right, bottom],
    [left + 4, bottom],
    [left, bottom - 4],
    [left, plateBottom],
  ];
  const coil = Array.from({ length: samples + 1 }, (_, i) => {
    const theta = (i / samples) * 2 * Math.PI * turns;
    const x = right + radius * Math.sin(theta),
      y = top + ((bottom - top) * i) / samples;
    return {
      point: [x, y + 7 * (1 - Math.cos(theta))] as Point,
      world: [x, -y, -radius * Math.cos(theta)],
      front: Math.cos(theta) < 0,
      depth: 0.65 + (0.35 * (1 - Math.cos(theta))) / 2,
    };
  });
  const lane = [
    ...upper.map((point) => ({ point, world: [point[0], -point[1], -radius], depth: 1 })),
    ...coil.slice(1),
    ...lower.slice(1).map((point) => ({ point, world: [point[0], -point[1], -radius], depth: 1 })),
  ];
  const lengths = [0];
  for (let i = 1; i < lane.length; i++) {
    const a = lane[i - 1]!.world,
      b = lane[i]!.world;
    lengths.push(lengths[i - 1]! + Math.hypot(...b.map((v, axis) => v - a[axis]!)));
  }
  const length = lengths.at(-1)!;
  function at(distance: number) {
    let low = 0,
      high = lengths.length - 1;
    const d = Math.max(0, Math.min(length, distance));
    while (high - low > 1) {
      const mid = (low + high) >> 1;
      if (lengths[mid]! < d) low = mid;
      else high = mid;
    }
    const a = lane[low]!,
      b = lane[high]!,
      p = (d - lengths[low]!) / (lengths[high]! - lengths[low]!);
    return {
      x: a.point[0] + (b.point[0] - a.point[0]) * p,
      y: a.point[1] + (b.point[1] - a.point[1]) * p,
      depth: a.depth + (b.depth - a.depth) * p,
    };
  }
  return {
    compact,
    left,
    right,
    top,
    bottom,
    plateTop,
    plateBottom,
    plateHalf,
    radius,
    upper,
    lower,
    coil,
    length,
    at,
  };
}
export const linePath = (points: readonly Point[]) =>
  points.map((p, i) => `${i ? 'L' : 'M'}${p.join(' ')}`).join(' ');
