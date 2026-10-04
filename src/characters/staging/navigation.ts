import type { GroundPoint, Staging } from './types.js';
import { footprint, stairEnd, objectShape, type Footprint } from './objects.js';
import { distance } from './space.js';

const inside = (p: GroundPoint, b: Footprint) =>
  p.x > b.left && p.x < b.right && p.z > b.front && p.z < b.back;
/** Segment clipping against an open rectangle; touching a clearance corner is allowed. */
function intersects(a: GroundPoint, b: GroundPoint, box: Footprint) {
  let lo = 0,
    hi = 1;
  for (const [origin, delta, min, max] of [
    [a.x, b.x - a.x, box.left + 1e-7, box.right - 1e-7],
    [a.z, b.z - a.z, box.front + 1e-7, box.back - 1e-7],
  ] as const) {
    if (Math.abs(delta) < 1e-12) {
      if (origin <= min || origin >= max) return false;
    } else {
      const p = (min - origin) / delta,
        q = (max - origin) / delta;
      lo = Math.max(lo, Math.min(p, q));
      hi = Math.min(hi, Math.max(p, q));
      if (lo >= hi) return false;
    }
  }
  return lo < hi;
}

/** Keep an automatically chosen meeting place clear for both actors standing side by side. */
export function meetingPoint(
  staging: Staging,
  preferred: GroundPoint,
  halfWidth: number,
  radius: number,
): GroundPoint {
  if (![halfWidth, radius].every((value) => Number.isFinite(value) && value >= 0))
    throw new Error('Meeting clearance must be finite and non-negative');
  const boxes = Object.values(staging.objects).flatMap((item) => {
    if (Math.abs((item.at.height ?? 0) - (preferred.height ?? 0)) > 0.1) return [];
    const box = footprint(item);
    return box
      ? [
          {
            left: box.left - halfWidth - radius,
            right: box.right + halfWidth + radius,
            front: box.front - radius,
            back: box.back + radius,
          },
        ]
      : [];
  });
  const free = (point: GroundPoint) => !boxes.some((box) => inside(point, box));
  if (free(preferred)) return { ...preferred };
  // A nearest point outside a rectangle union lies on an edge projection, corner,
  // or edge intersection. These coordinates cover all three without a search grid.
  const xs = new Set([preferred.x, ...boxes.flatMap((box) => [box.left, box.right])]);
  const zs = new Set([preferred.z, ...boxes.flatMap((box) => [box.front, box.back])]);
  let closest: GroundPoint | undefined,
    cost = Infinity;
  for (const x of xs)
    for (const z of zs) {
      const candidate = { ...preferred, x, z };
      const next = Math.hypot(x - preferred.x, z - preferred.z);
      if (next < cost && free(candidate)) {
        closest = candidate;
        cost = next;
      }
    }
  return closest!;
}

/** A small visibility graph around physical furniture. No per-scene waypoint tuning. */
function flatRoute(
  staging: Staging,
  from: GroundPoint,
  to: GroundPoint,
  radius: number,
  omit: readonly string[] = [],
): GroundPoint[] {
  if (!Number.isFinite(radius) || radius < 0)
    throw new Error('Route clearance must be finite and non-negative');
  if (distance(from, to) < 1e-6) return [];
  const boxes = Object.entries(staging.objects).flatMap(([id, item]) => {
    if (omit.includes(id) || Math.abs((item.at.height ?? 0) - (from.height ?? 0)) > 0.1) return [];
    const physical = footprint(item);
    if (!physical) return [];
    if (inside(to, physical))
      throw new Error(`Stage destination is inside blocking furniture: ${id}`);
    const box = {
      left: physical.left - radius,
      right: physical.right + radius,
      front: physical.front - radius,
      back: physical.back + radius,
    };
    return [{ physical, box }];
  });
  const visible = (a: GroundPoint, b: GroundPoint) =>
    !boxes.some(({ physical, box }) => {
      if (!intersects(a, b, box)) return false;
      const startsAtContact = (a === from || b === from) && inside(from, box);
      const endsAtContact = (a === to || b === to) && inside(to, box);
      if (!startsAtContact && !endsAtContact) return true;
      // A seated actor may leave its support; a final hand contact may approach its edge.
      // Neither exception removes the furniture from the remainder of the route.
      if (startsAtContact && inside(from, physical)) return false;
      return intersects(a, b, physical);
    });
  if (visible(from, to)) return [];
  const nodes: GroundPoint[] = [
    from,
    to,
    ...boxes
      .flatMap(({ box: b }) => [
        { x: b.left, z: b.front, height: from.height },
        { x: b.right, z: b.front, height: from.height },
        { x: b.right, z: b.back, height: from.height },
        { x: b.left, z: b.back, height: from.height },
      ])
      .filter((p) => !boxes.some(({ box }) => inside(p, box))),
  ];
  const costs = nodes.map(() => Infinity),
    previous = nodes.map(() => -1),
    visited = new Set<number>();
  costs[0] = 0;
  while (visited.size < nodes.length) {
    let next = -1;
    for (let i = 0; i < nodes.length; i++)
      if (!visited.has(i) && (next < 0 || costs[i]! < costs[next]!)) next = i;
    if (next < 0 || !Number.isFinite(costs[next])) break;
    if (next === 1) {
      const path: GroundPoint[] = [];
      for (let i = previous[1]!; i > 0; i = previous[i]!) path.unshift(nodes[i]!);
      return path;
    }
    visited.add(next);
    for (let i = 0; i < nodes.length; i++) {
      if (visited.has(i) || !visible(nodes[next]!, nodes[i]!)) continue;
      const cost = costs[next]! + distance(nodes[next]!, nodes[i]!);
      if (cost < costs[i]!) {
        costs[i] = cost;
        previous[i] = next;
      }
    }
  }
  throw new Error('No clear stage route; move the destination or its blocking furniture');
}

/** A raised destination must belong to a floor or a stair landing. */
function floorSupports(staging: Staging) {
  return [
    ...Object.values(staging.supports ?? {}),
    ...Object.values(staging.objects)
      .filter((item) => item.kind === 'stairs')
      .map((item) => {
        const at = stairEnd(item),
          s = item.scale ?? 1;
        return {
          at: { ...at, z: at.z + (objectShape.stairs.landing * s) / 2 },
          width: objectShape.stairs.halfWidth * 2 * s,
          depth: objectShape.stairs.landing * s,
        };
      }),
  ];
}
export function supported(staging: Staging, p: GroundPoint): boolean {
  if (Math.abs(p.height ?? 0) < 0.05) return true;
  return floorSupports(staging).some(
    (f) =>
      Math.abs((f.at.height ?? 0) - (p.height ?? 0)) < 0.05 &&
      Math.abs(p.x - f.at.x) <= f.width / 2 + 0.001 &&
      Math.abs(p.z - f.at.z) <= f.depth / 2 + 0.001,
  );
}
/** Exact interval coverage catches small gaps that point sampling would miss. */
function supportedSegment(staging: Staging, a: GroundPoint, b: GroundPoint) {
  if (Math.abs(a.height ?? 0) < 0.05) return true;
  const intervals: [number, number][] = [];
  for (const floor of floorSupports(staging)) {
    if (Math.abs((floor.at.height ?? 0) - (a.height ?? 0)) > 0.05) continue;
    let lo = 0,
      hi = 1;
    for (const [origin, delta, center, extent] of [
      [a.x, b.x - a.x, floor.at.x, floor.width / 2],
      [a.z, b.z - a.z, floor.at.z, floor.depth / 2],
    ]) {
      if (Math.abs(delta!) < 1e-10) {
        if (Math.abs(origin! - center!) > extent! + 1e-8) hi = -1;
      } else {
        const p = (center! - extent! - origin!) / delta!,
          q = (center! + extent! - origin!) / delta!;
        lo = Math.max(lo, Math.min(p, q));
        hi = Math.min(hi, Math.max(p, q));
      }
    }
    if (lo <= hi) intervals.push([lo, hi]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let end = 0;
  for (const [lo, hi] of intervals) {
    if (lo > end + 1e-8) return false;
    end = Math.max(end, hi);
  }
  return end >= 1 - 1e-8;
}

/** Connect floor routes through prepared stairs; height never interpolates through empty space. */
export function route(
  staging: Staging,
  from: GroundPoint,
  to: GroundPoint,
  radius: number,
  omit: readonly string[] = [],
): GroundPoint[] {
  if (!supported(staging, from) || !supported(staging, to))
    throw new Error('A walking destination needs a floor or stair landing support');
  const levelRoute = (a: GroundPoint, b: GroundPoint, excluded: readonly string[]) => {
    const via = flatRoute(staging, a, b, radius, excluded),
      path = [a, ...via, b];
    for (let i = 1; i < path.length; i++) {
      const p = path[i - 1]!,
        q = path[i]!;
      if (!supportedSegment(staging, p, q))
        throw new Error('Walking route leaves its floor support');
    }
    return via;
  };
  if (Math.abs((from.height ?? 0) - (to.height ?? 0)) < 0.05) return levelRoute(from, to, omit);
  const nodes: { at: GroundPoint; stairs?: string }[] = [{ at: from }, { at: to }];
  for (const [id, item] of Object.entries(staging.objects))
    if (item.kind === 'stairs')
      nodes.push({ at: item.at, stairs: id }, { at: stairEnd(item), stairs: id });
  const costs = nodes.map(() => Infinity),
    paths: GroundPoint[][] = nodes.map(() => []),
    visited = new Set<number>();
  costs[0] = 0;
  while (visited.size < nodes.length) {
    let index = -1;
    for (let i = 0; i < nodes.length; i++)
      if (!visited.has(i) && (index < 0 || costs[i]! < costs[index]!)) index = i;
    if (index < 0 || !Number.isFinite(costs[index])) break;
    if (index === 1) return paths[index]!.slice(0, -1);
    visited.add(index);
    const a = nodes[index]!;
    for (const [i, b] of nodes.entries()) {
      if (visited.has(i)) continue;
      let leg: GroundPoint[];
      if (a.stairs && a.stairs === b.stairs) leg = [b.at];
      else if (Math.abs((a.at.height ?? 0) - (b.at.height ?? 0)) < 0.05) {
        try {
          leg = [
            ...levelRoute(a.at, b.at, [
              ...omit,
              ...[a.stairs, b.stairs].filter((id): id is string => !!id),
            ]),
            b.at,
          ];
        } catch {
          continue;
        }
      } else continue;
      const points = [a.at, ...leg],
        cost = costs[index]! + leg.reduce((n, p, j) => n + distance(points[j]!, p), 0);
      if (cost < costs[i]!) {
        costs[i] = cost;
        paths[i] = [...paths[index]!, ...leg];
      }
    }
  }
  throw new Error('No connected walking route between floors; add a stair or landing support');
}
