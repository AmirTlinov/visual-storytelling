import type { FusionPose, FusionShape } from './shape.js';
import type { InkRoute } from './transport.js';
import { inkRoutes } from './transport.js';
import { textRoutes } from './text-routing.js';

/** Shared correspondence for all surfaces that carry transforming ink. */
export function compileInkMotion(sources: readonly FusionShape[], targets: readonly FusionShape[]) {
  if (!sources.length || !targets.length || [...sources, ...targets].some((s) => !s.paths.length))
    throw new Error('Fusion needs visible source and target shapes');
  return inkMotion(
    [...sources, ...targets].every((s) => s.text)
      ? textRoutes(sources, targets)
      : inkRoutes(
          sources.map((s) => s.paths),
          targets.map((s) => s.paths),
        ),
  );
}

export interface InkPatch {
  readonly source: number;
  readonly destination: number;
  readonly target: number;
  /** Contiguous ranges and whether they carry established ink rather than a growing seed. */
  readonly ranges: readonly [offset: number, length: number, established: boolean][];
}
/** One borrowed segment buffer per source: ax, ay, bx, by, radiusA, radiusB. */
export type InkVertices = Float32Array[];

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
  const phase = Math.max(0, Math.min(1, morph / 0.7));
  return phase * phase * (3 - 2 * phase);
}

/** Compile correspondence once. Sampling reuses buffers and transforms each pose once. */
export function inkMotion(routes: InkRoute[]) {
  const groups = new Map<string, InkRoute[]>(),
    glyphs = new Map<number, InkRoute[]>(),
    words = new Map<number, InkRoute[]>();
  for (const route of routes) {
    const contour = `${route.target}:${route.part ?? 'whole'}`;
    if (!groups.has(contour)) groups.set(contour, []);
    groups.get(contour)!.push(route);
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
  const sourceCount = Math.max(...routes.map((route) => route.source)) + 1;
  const targetCount = Math.max(...routes.map((route) => route.destination)) + 1;
  const stride = sourceCount * 3;
  const counts = Array<number>(sourceCount).fill(0);
  const patchMap = new Map<
    string,
    { source: number; destination: number; target: number; ranges: [number, number, boolean][] }
  >();
  type End = {
    source: number;
    offset: number;
    points: number;
    end: number;
    dx: number;
    dy: number;
  };
  const seams = new Map<string, End[]>();
  // x, y and translation weight for each source. Local vectors have weight zero.
  function mean(items: InkRoute[], point: (r: InkRoute) => readonly number[], translate = false) {
    const result = new Float64Array(stride);
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
    const owner = group.find((r) => r.attachment === undefined)!,
      carrier = text ? carriers.get(text.glyph)! : undefined;
    const common = new Float64Array(n * stride),
      current = new Float64Array(n * 2),
      contour = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
      const at = i * stride + owner.source * 3,
        point = owner.from[i]!;
      common[at] = point[0] - (owner.text?.from[0] ?? 0);
      common[at + 1] = point[1] - (owner.text?.from[1] ?? 0);
      common[at + 2] = text ? 0 : 1;
      if (carrier) for (let j = 0; j < stride; j++) common[i * stride + j]! += carrier[j]!;
    }
    // The complete contour is sampled before ink that is absorbed by it.
    const inputs = [owner, ...group.filter((r) => r.attachment !== undefined)].map((route) => {
      const offset = counts[route.source]!,
        length = (route.from.length - 1) * 6;
      counts[route.source]! += length;
      const key = route.text
        ? `${route.source}:${route.text.originWord}:${route.text.word}`
        : `${route.source}:${route.destination}`;
      if (!patchMap.has(key))
        patchMap.set(key, {
          source: route.source,
          destination: route.destination,
          target: route.text?.word ?? route.destination,
          ranges: [],
        });
      patchMap.get(key)!.ranges.push([offset, length, route.text?.established ?? false]);
      if (route.part !== undefined)
        for (const end of [0, route.to.length - 1]) {
          const point = route.to[end]!;
          const key = `${route.destination}:${route.target}:${point
            .slice(0, 2)
            .map((v) => Math.round(v * 1e5))
            .join(',')}`;
          if (!seams.has(key)) seams.set(key, []);
          seams
            .get(key)!
            .push({ source: route.source, offset, points: route.to.length, end, dx: 0, dy: 0 });
        }
      const center = route.from.reduce(
        (sum, p) => [sum[0]! + p[0] / n, sum[1]! + p[1] / n],
        [0, 0],
      );
      const extent = Math.max(
        ...route.from.map((p) => Math.hypot(p[0] - center[0]!, p[1] - center[1]!)),
      );
      return { route, offset, center, extent };
    });
    return {
      inputs,
      common,
      current,
      contour,
      n,
      text,
      destination: owner.destination,
      word: text ? wordCarriers.get(text.word)! : undefined,
    };
  });
  const patches: InkPatch[] = [...patchMap.values()];
  const vertices: InkVertices = counts.map((count) => new Float32Array(count));
  const joins = [...seams.values()].filter(
    (ends) => new Set(ends.map((end) => `${end.source}:${end.offset}`)).size > 1,
  );
  const poses = Array.from({ length: sourceCount }, pose),
    destinations = Array.from({ length: targetCount }, pose);
  function transformedMean(values: Float64Array, at: number, out: Float64Array, offset: number) {
    let px = 0,
      py = 0;
    for (let i = 0; i < sourceCount; i++) {
      const p = poses[i]!,
        index = at + i * 3;
      px += x(p, values[index]!, values[index + 1]!) + p.x * values[index + 2]!;
      py += y(p, values[index]!, values[index + 1]!) + p.y * values[index + 2]!;
    }
    out[offset] = px;
    out[offset + 1] = py;
  }
  const word = new Float64Array(2);
  function sample(sources: readonly FusionPose[], targets: readonly FusionPose[], morph: number) {
    if (sources.length !== sourceCount || targets.length !== targetCount)
      throw new Error('Fusion poses must match source and target shape counts');
    if (!Number.isFinite(morph)) throw new Error('Fusion progress must be finite');
    for (const p of [...sources, ...targets])
      if (
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        !Number.isFinite(p.rotation ?? 0) ||
        !Number.isFinite(p.scale ?? 1) ||
        (p.scale ?? 1) <= 0
      )
        throw new Error('Fusion poses need finite coordinates and positive scales');
    sources.forEach((input, i) => update(poses[i]!, input));
    targets.forEach((input, i) => update(destinations[i]!, input));
    morph = Math.max(0, Math.min(1, morph));
    const gather = inkGather(morph);
    for (const group of compiled) {
      const destination = destinations[group.destination]!;
      const s = group.text ? gather : morph;
      for (let i = 0; i < group.n; i++)
        transformedMean(group.common, i * stride, group.current, i * 2);
      let wx = 0,
        wy = 0;
      if (group.text) {
        transformedMean(group.word!, 0, word, 0);
        wx = word[0]! * (1 - s) * gather;
        wy = word[1]! * (1 - s) * gather;
      }
      const own = (1 - s) * (1 - gather),
        shared = (1 - s) * gather;
      for (const { route, offset, center, extent } of group.inputs) {
        const p = poses[route.source]!,
          buffer = vertices[route.source]!;
        const dx = wx, dy = wy;
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
    // Destination spans meet as one pen line. Move a short neighbourhood with
    // each endpoint so contact does not leave a fork or a sharp isolated tip.
    const joined = gather;
    for (const ends of joins) {
      let cx = 0,
        cy = 0;
      for (const end of ends) {
        const data = vertices[end.source]!;
        const at = end.offset + (end.end ? (end.points - 2) * 6 + 2 : 0);
        cx += data[at]! / ends.length;
        cy += data[at + 1]! / ends.length;
      }
      for (const end of ends) {
        const data = vertices[end.source]!;
        const at = end.offset + (end.end ? (end.points - 2) * 6 + 2 : 0);
        end.dx = (cx - data[at]!) * joined;
        end.dy = (cy - data[at + 1]!) * joined;
      }
    }
    for (const ends of joins)
      for (const end of ends) {
        const data = vertices[end.source]!,
          reach = Math.max(1, (end.points - 1) * 0.35);
        for (let segment = 0; segment < end.points - 1; segment++)
          for (let side = 0; side < 2; side++) {
            const weight = Math.max(0, 1 - Math.abs(segment + side - end.end) / reach) ** 2;
            const at = end.offset + segment * 6 + side * 2;
            data[at]! += end.dx * weight;
            data[at + 1]! += end.dy * weight;
          }
      }
    return vertices;
  }
  return Object.assign(sample, { patches, sourceCount, targetCount });
}
