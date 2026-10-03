import type { FusionPose } from './shape.js';
import type { InkRoute } from './transport.js';

export interface InkPatch {
  readonly source: 0 | 1;
  readonly target: number;
  /** Contiguous segment ranges in the source's vertex buffer. */
  readonly ranges: readonly [offset: number, length: number][];
}
export type InkVertices = [Float32Array, Float32Array];

type Pose = { c: number; s: number; x: number; y: number; scale: number };
const pose = (): Pose => ({ c: 1, s: 0, x: 0, y: 0, scale: 1 });
function update(out: Pose, input: FusionPose) {
  out.scale = input.scale ?? 1;
  out.c = Math.cos(input.rotation ?? 0) * out.scale;
  out.s = Math.sin(input.rotation ?? 0) * out.scale;
  out.x = input.x;
  out.y = input.y;
}
const x = (p: Pose, a: number, b: number) => p.c * a - p.s * b;
const y = (p: Pose, a: number, b: number) => p.s * a + p.c * b;

export function inkGather(morph: number) {
  const phase = Math.max(0, Math.min(1, morph / 0.65));
  return phase * phase * (3 - 2 * phase);
}

/** Compile correspondence once. Sampling reuses buffers and transforms each pose once. */
export function inkMotion(routes: InkRoute[]) {
  const groups = new Map<number, InkRoute[]>(),
    glyphs = new Map<number, InkRoute[]>(),
    words = new Map<number, InkRoute[]>();
  for (const route of routes) {
    if (!groups.has(route.target)) groups.set(route.target, []);
    groups.get(route.target)!.push(route);
    if (!route.text) continue;
    for (const [map, id, origin] of [
      [glyphs, route.text.glyph, 'origin'],
      [words, route.text.word, 'originWord'],
    ] as const) {
      if (!map.has(id)) map.set(id, []);
      const items = map.get(id)!;
      if (!items.some((r) => r.text![origin] === route.text![origin])) items.push(route);
    }
  }
  const vertices: InkVertices = [new Float32Array(0), new Float32Array(0)];
  const counts: [number, number] = [0, 0],
    patches: InkPatch[] = [];
  const patchMap = new Map<string, { source: 0 | 1; target: number; ranges: [number, number][] }>();
  // x, y and translation weight for each source. Local vectors have weight zero.
  function mean(items: InkRoute[], point: (r: InkRoute) => readonly number[], translate = false) {
    const result = new Float64Array(6);
    for (const r of items) {
      const p = point(r),
        at = r.source * 3;
      result[at]! += p[0]! / items.length;
      result[at + 1]! += p[1]! / items.length;
      result[at + 2]! += translate ? 1 / items.length : 0;
    }
    return result;
  }
  const carriers = new Map<number, Float64Array>(),
    wordCarriers = new Map<number, Float64Array>();
  for (const [id, items] of glyphs) {
    const same = items.filter((r) => r.text!.same);
    carriers.set(
      id,
      mean(same.length ? same : items, (r) => [
        r.text!.from[0] - r.text!.fromWord[0],
        r.text!.from[1] - r.text!.fromWord[1],
      ]),
    );
  }
  for (const [id, items] of words) {
    const same = items.filter((r) => r.text!.wordSame);
    wordCarriers.set(
      id,
      mean(same.length ? same : items, (r) => r.text!.fromWord, true),
    );
  }
  const compiled = [...groups.values()].map((group) => {
    const text = group[0]!.text,
      n = group[0]!.from.length;
    const selected = group.filter((r) => r.attachment === undefined);
    const common = new Float64Array(n * 6),
      current = new Float64Array(n * 2),
      contour = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
      const m = mean(
        selected,
        (r) =>
          text ? [r.from[i]![0] - r.text!.from[0], r.from[i]![1] - r.text!.from[1]] : r.from[i]!,
        !text,
      );
      const carrier = text ? carriers.get(text.glyph)! : undefined;
      for (let j = 0; j < 6; j++) common[i * 6 + j] = m[j]! + (carrier?.[j] ?? 0);
    }
    // The complete contour is sampled before ink that is absorbed by it.
    const inputs = [...selected, ...group.filter((r) => r.attachment !== undefined)].map(
      (route) => {
        const offset = counts[route.source]!,
          length = (route.from.length - 1) * 6;
        counts[route.source]! += length;
        const key = route.text
          ? `${route.source}:${route.text.originWord}:${route.text.word}`
          : `${route.source}`;
        if (!patchMap.has(key))
          patchMap.set(key, { source: route.source, target: route.text?.word ?? 0, ranges: [] });
        patchMap.get(key)!.ranges.push([offset, length]);
        const center = route.from.reduce(
          (sum, p) => [sum[0]! + p[0] / n, sum[1]! + p[1] / n],
          [0, 0],
        );
        const extent = Math.max(
          ...route.from.map((p) => Math.hypot(p[0] - center[0]!, p[1] - center[1]!)),
        );
        return { route, offset, center, extent };
      },
    );
    return {
      inputs,
      common,
      current,
      contour,
      n,
      text,
      word: text ? wordCarriers.get(text.word)! : undefined,
    };
  });
  patches.push(...patchMap.values());
  vertices[0] = new Float32Array(counts[0]);
  vertices[1] = new Float32Array(counts[1]);
  const poses = [pose(), pose()] as const,
    destination = pose();
  function transformedMean(values: Float64Array, at: number, out: Float64Array, offset: number) {
    const a = poses[0],
      b = poses[1];
    out[offset] =
      x(a, values[at]!, values[at + 1]!) +
      a.x * values[at + 2]! +
      x(b, values[at + 3]!, values[at + 4]!) +
      b.x * values[at + 5]!;
    out[offset + 1] =
      y(a, values[at]!, values[at + 1]!) +
      a.y * values[at + 2]! +
      y(b, values[at + 3]!, values[at + 4]!) +
      b.y * values[at + 5]!;
  }
  const word = new Float64Array(2);
  function sample(sources: readonly [FusionPose, FusionPose], target: FusionPose, morph: number) {
    update(poses[0], sources[0]);
    update(poses[1], sources[1]);
    update(destination, target);
    const gather = inkGather(morph);
    for (const group of compiled) {
      const s = group.text ? gather : morph;
      for (let i = 0; i < group.n; i++) transformedMean(group.common, i * 6, group.current, i * 2);
      let wx = 0,
        wy = 0,
        tx = 0,
        ty = 0;
      if (group.text) {
        transformedMean(group.word!, 0, word, 0);
        wx = word[0]! * (1 - morph) * gather;
        wy = word[1]! * (1 - morph) * gather;
        tx = (x(destination, ...group.text.toWord) + destination.x) * (morph - s);
        ty = (y(destination, ...group.text.toWord) + destination.y) * (morph - s);
      }
      const own = (1 - s) * (1 - gather),
        shared = (1 - s) * gather;
      for (const { route, offset, center, extent } of group.inputs) {
        const p = poses[route.source],
          buffer = vertices[route.source];
        let dx = 0,
          dy = 0;
        if (group.text) {
          const weight = (s - morph) * (1 - gather);
          dx = wx + tx + (x(p, ...route.text!.fromWord) + p.x) * weight;
          dy = wy + ty + (y(p, ...route.text!.fromWord) + p.y) * weight;
        }
        let contraction = own;
        const centerX = x(p, center[0]!, center[1]!),
          centerY = y(p, center[0]!, center[1]!);
        if (route.attachment !== undefined && extent > 0) {
          const at = route.attachment * 2,
            to = route.to[0]!;
          const cx =
            dx +
            own * (centerX + p.x) +
            shared * group.current[at]! +
            s * (x(destination, to[0], to[1]) + destination.x);
          const cy =
            dy +
            own * (centerY + p.y) +
            shared * group.current[at + 1]! +
            s * (y(destination, to[0], to[1]) + destination.y);
          const distance = Math.hypot(cx - group.contour[at]!, cy - group.contour[at + 1]!);
          // Keep travelling ink substantial. It contracts only inside its own
          // contact radius, so a tiny remnant cannot fly across the sentence.
          const contact = Math.min(1, distance / (extent * p.scale));
          contraction = own + (1 - own) * contact * (2 - contact);
        }
        const baseX = dx + own * p.x - (contraction - own) * centerX + s * destination.x,
          baseY = dy + own * p.y - (contraction - own) * centerY + s * destination.y;
        let previousX = 0,
          previousY = 0,
          previousRadius = 0,
          at = offset;
        for (let i = 0; i < group.n; i++) {
          const a = route.from[i]!,
            b = route.to[i]!,
            commonIndex = (route.attachment ?? i) * 2;
          const px =
            baseX +
            contraction * x(p, a[0], a[1]) +
            shared * group.current[commonIndex]! +
            s * x(destination, b[0], b[1]);
          const py =
            baseY +
            contraction * y(p, a[0], a[1]) +
            shared * group.current[commonIndex + 1]! +
            s * y(destination, b[0], b[1]);
          if (route.attachment === undefined) {
            group.contour[i * 2] = px;
            group.contour[i * 2 + 1] = py;
          }
          const radius = a[2] * p.scale * (1 - s) + b[2] * destination.scale * s;
          if (i) {
            buffer[at++] = previousX;
            buffer[at++] = previousY;
            buffer[at++] = px;
            buffer[at++] = py;
            buffer[at++] = previousRadius;
            buffer[at++] = radius;
          }
          previousX = px;
          previousY = py;
          previousRadius = radius;
        }
      }
    }
    return vertices;
  }
  return Object.assign(sample, { patches });
}
