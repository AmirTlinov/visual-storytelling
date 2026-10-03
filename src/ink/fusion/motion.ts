import type { FusionPose } from './shape.js';
import type { InkPoint, InkRoute } from './transport.js';

const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
// Readable text settles early; contact smoothing uses this same phase.
export const textProgress = (morph: number) => 1 - (1 - morph) ** 10;
function transformed(point: InkPoint, pose: FusionPose): InkPoint {
  const scale = pose.scale ?? 1,
    c = Math.cos(pose.rotation ?? 0),
    s = Math.sin(pose.rotation ?? 0);
  return [
    pose.x + (point[0] * c - point[1] * s) * scale,
    pose.y + (point[0] * s + point[1] * c) * scale,
    point[2] * scale,
  ];
}
function mean(points: readonly InkPoint[]): InkPoint {
  return [
    points.reduce((s, p) => s + p[0], 0) / points.length,
    points.reduce((s, p) => s + p[1], 0) / points.length,
    0,
  ];
}

/** Glyph motion owns placement; its pen strokes only change inside that glyph. */
export function inkMotion(routes: InkRoute[]) {
  const groups = new Map<number, InkRoute[]>(),
    glyphs = new Map<number, InkRoute[]>(),
    words = new Map<number, InkRoute[]>();
  for (const route of routes) {
    if (!groups.has(route.target)) groups.set(route.target, []);
    groups.get(route.target)!.push(route);
    if (route.text) {
      if (!glyphs.has(route.text.glyph)) glyphs.set(route.text.glyph, []);
      if (!words.has(route.text.word)) words.set(route.text.word, []);
      const wordItems = words.get(route.text.word)!;
      if (!wordItems.some((r) => r.text!.originWord === route.text!.originWord))
        wordItems.push(route);
      const items = glyphs.get(route.text.glyph)!;
      if (!items.some((r) => r.text!.origin === route.text!.origin)) items.push(route);
    }
  }
  const vertices = [0, 1].map(
    (source) =>
      new Float32Array(
        routes.filter((r) => r.source === source).reduce((n, r) => n + (r.from.length - 1) * 6, 0),
      ),
  ) as [Float32Array, Float32Array];
  return (sources: readonly [FusionPose, FusionPose], target: FusionPose, morph: number) => {
    const cursor = [0, 0],
      carriers = new Map<number, InkPoint>(),
      wordCarriers = new Map<number, InkPoint>();
    for (const [id, items] of glyphs) {
      const same = items.filter((r) => r.text!.same),
        selected = same.length ? same : items;
      carriers.set(
        id,
        mean(
          selected.map((r) =>
            (() => {
              const a = transformed([...r.text!.from, 0], sources[r.source]),
                w = transformed([...r.text!.fromWord, 0], sources[r.source]);
              return [a[0] - w[0], a[1] - w[1], 0] as InkPoint;
            })(),
          ),
        ),
      );
    }
    for (const [id, items] of words) {
      const same = items.filter((r) => r.text!.wordSame),
        selected = same.length ? same : items;
      wordCarriers.set(
        id,
        mean(selected.map((r) => transformed([...r.text!.fromWord, 0], sources[r.source]))),
      );
    }
    for (const group of groups.values()) {
      const last: (InkPoint | undefined)[] = group.map(() => undefined);
      const text = group[0]!.text;
      const gather = smooth(text ? morph / 0.12 : morph / 0.65);
      const shapeProgress = text ? textProgress(morph) : morph;
      const placement = shapeProgress;
      const anchors = text
        ? group.map((r) => transformed([...r.text!.from, 0], sources[r.source]))
        : [];
      const finalAnchor = text ? transformed([...text.to, 0], target) : undefined;
      for (let i = 0; i < group[0]!.from.length; i++) {
        const origins = group.map((r) => transformed(r.from[i]!, sources[r.source]));
        const locals = text
          ? origins.map((p, j): InkPoint => [p[0] - anchors[j]![0], p[1] - anchors[j]![1], p[2]])
          : origins;
        const preferred = group.flatMap((r, j) => (r.text?.same ? [locals[j]!] : []));
        const common = mean(preferred.length ? preferred : locals);
        const b = transformed(group[0]!.to[i]!, target);
        for (let r = 0; r < group.length; r++) {
          const route = group[r]!,
            a = origins[r]!;
          let x: number, y: number;
          if (text) {
            const anchor = anchors[r]!,
              carrier = carriers.get(text.glyph)!;
            const wordAnchor = transformed([...route.text!.fromWord, 0], sources[route.source]);
            const finalWord = transformed([...text.toWord, 0], target),
              wordCarrier = wordCarriers.get(text.word)!;
            const wx = wordAnchor[0] + (wordCarrier[0] - wordAnchor[0]) * gather,
              wy = wordAnchor[1] + (wordCarrier[1] - wordAnchor[1]) * gather;
            const ax = anchor[0] - wordAnchor[0],
              ay = anchor[1] - wordAnchor[1];
            const cx = ax + (carrier[0] - ax) * gather,
              cy = ay + (carrier[1] - ay) * gather;
            const local = locals[r]!,
              lx = local[0] + (common[0] - local[0]) * gather,
              ly = local[1] + (common[1] - local[1]) * gather;
            x =
              wx +
              (finalWord[0] - wx) * placement +
              cx +
              (finalAnchor![0] - finalWord[0] - cx) * shapeProgress +
              lx +
              (b[0] - finalAnchor![0] - lx) * shapeProgress;
            y =
              wy +
              (finalWord[1] - wy) * placement +
              cy +
              (finalAnchor![1] - finalWord[1] - cy) * shapeProgress +
              ly +
              (b[1] - finalAnchor![1] - ly) * shapeProgress;
          } else {
            const ax = a[0] + (common[0] - a[0]) * gather,
              ay = a[1] + (common[1] - a[1]) * gather;
            x = ax + (b[0] - ax) * morph;
            y = ay + (b[1] - ay) * morph;
          }
          const point: InkPoint = [x, y, a[2] + (b[2] - a[2]) * shapeProgress],
            previous = last[r];
          if (previous) {
            vertices[route.source].set(
              [previous[0], previous[1], point[0], point[1], previous[2], point[2]],
              cursor[route.source],
            );
            cursor[route.source]! += 6;
          }
          last[r] = point;
        }
      }
    }
    return vertices;
  };
}
