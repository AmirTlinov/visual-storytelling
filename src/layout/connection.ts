export interface ConnectionPoint {
  x: number;
  y: number;
}
export interface ConnectionBounds extends ConnectionPoint {
  width: number;
  height: number;
}
/** Page coordinates: top is decreasing y. Adapters convert their own coordinate system. */
export type ConnectionSide = 'left' | 'right' | 'top' | 'bottom';
export interface ConnectionOptions {
  gap?: number;
  clearance?: number;
  fromSide?: ConnectionSide;
  toSide?: ConnectionSide;
  avoid?: readonly ConnectionBounds[];
}
export interface ConnectionRoute {
  start: ConnectionPoint;
  end: ConnectionPoint;
  points: readonly ConnectionPoint[];
}
const epsilon = 1e-8;

/** Touching the clearance boundary is allowed; entering its interior is not. */
export function crossesBounds(a: ConnectionPoint, b: ConnectionPoint, box: ConnectionBounds) {
  let lo = 0,
    hi = 1;
  for (const axis of ['x', 'y'] as const) {
    const delta = b[axis] - a[axis];
    const min = box[axis] + epsilon,
      max = box[axis] + (axis === 'x' ? box.width : box.height) - epsilon;
    if (Math.abs(delta) < epsilon) {
      if (a[axis] < min || a[axis] > max) return false;
    } else {
      const first = (min - a[axis]) / delta,
        last = (max - a[axis]) / delta;
      lo = Math.max(lo, Math.min(first, last));
      hi = Math.min(hi, Math.max(first, last));
      if (lo > hi) return false;
    }
  }
  return true;
}

const expand = (b: ConnectionBounds, padding: number): ConnectionBounds => ({
  x: b.x - padding,
  y: b.y - padding,
  width: b.width + 2 * padding,
  height: b.height + 2 * padding,
});
function ports(b: ConnectionBounds, gap: number, clearance: number, side?: ConnectionSide) {
  const sides = {
    right: [b.x + b.width, b.y + b.height / 2, 1, 0],
    bottom: [b.x + b.width / 2, b.y + b.height, 0, 1],
    left: [b.x, b.y + b.height / 2, -1, 0],
    top: [b.x + b.width / 2, b.y, 0, -1],
  } as const;
  return (side ? [sides[side]] : Object.values(sides)).map(([x, y, dx, dy]) => ({
    anchor: { x: x + dx * gap, y: y + dy * gap },
    escape: { x: x + dx * clearance, y: y + dy * clearance },
    axis: dx ? 0 : 1,
  }));
}

/** One deterministic rectilinear path for SVG and planar 3D diagrams. No frame history. */
export function connectionRoute(
  from: ConnectionBounds,
  to: ConnectionBounds,
  options: ConnectionOptions = {},
): ConnectionRoute {
  const gap = options.gap ?? 3,
    clearance = Math.max(gap, options.clearance ?? gap * 2);
  const boxes = [...new Set([from, to, ...(options.avoid ?? [])])];
  if (
    ![gap, clearance].every((v) => Number.isFinite(v) && v >= 0) ||
    (options.clearance !== undefined &&
      (!Number.isFinite(options.clearance) || options.clearance < 0)) ||
    boxes.some(
      (b) => ![b.x, b.y, b.width, b.height].every(Number.isFinite) || b.width < 0 || b.height < 0,
    )
  )
    throw new Error('Connection bounds must be finite; dimensions, gap and clearance nonnegative');
  const obstacles = boxes.map((b) => expand(b, clearance));
  const starts = ports(from, gap, clearance, options.fromSide),
    ends = ports(to, gap, clearance, options.toSide);
  const allPorts = [...starts, ...ends];
  const xs = [
    ...new Set([
      ...obstacles.flatMap((b) => [b.x, b.x + b.width]),
      ...allPorts.map((p) => p.escape.x),
    ]),
  ].sort((a, b) => a - b);
  const ys = [
    ...new Set([
      ...obstacles.flatMap((b) => [b.y, b.y + b.height]),
      ...allPorts.map((p) => p.escape.y),
    ]),
  ].sort((a, b) => a - b);
  const width = xs.length;
  const points = ys.flatMap((y) => xs.map((x) => ({ x, y })));
  const inside = points.map((p) => obstacles.some((b) => crossesBounds(p, p, b)));
  const index = (p: ConnectionPoint) => ys.indexOf(p.y) * width + xs.indexOf(p.x);
  const neighbors = new Map<number, { id: number; axis: number; length: number }[]>();
  function adjacent(id: number) {
    if (neighbors.has(id)) return neighbors.get(id)!;
    const x = id % width,
      y = Math.floor(id / width);
    const list = [
      ...(x > 0 ? [id - 1] : []),
      ...(x + 1 < width ? [id + 1] : []),
      ...(y > 0 ? [id - width] : []),
      ...(y + 1 < ys.length ? [id + width] : []),
    ].flatMap((next) => {
      if (inside[next] || obstacles.some((b) => crossesBounds(points[id]!, points[next]!, b)))
        return [];
      return [
        {
          id: next,
          axis: points[id]!.y === points[next]!.y ? 0 : 1,
          length:
            Math.abs(points[id]!.x - points[next]!.x) + Math.abs(points[id]!.y - points[next]!.y),
        },
      ];
    });
    neighbors.set(id, list);
    return list;
  }
  // A direction is part of the search state so a cheap bend cannot erase a straighter route.
  // A feedback edge must return through a different port. Keep source identity in its search.
  const copies = from === to ? starts.length : 1;
  const costs = new Float64Array(points.length * 2 * copies).fill(Infinity),
    previous = new Int32Array(costs.length).fill(-1),
    origin = new Int32Array(costs.length).fill(-1);
  const bend = Math.max(clearance, gap, 0.001) * 2;
  const queue: { state: number; cost: number }[] = [];
  function push(state: number, cost: number) {
    let i = queue.length;
    queue.push({ state, cost });
    while (i > 0) {
      const parent = (i - 1) >>> 1;
      if (queue[parent]!.cost <= cost) break;
      queue[i] = queue[parent]!;
      i = parent;
    }
    queue[i] = { state, cost };
  }
  function pop() {
    const first = queue[0]!,
      last = queue.pop()!;
    if (queue.length) {
      let i = 0;
      while (i * 2 + 1 < queue.length) {
        let child = i * 2 + 1;
        if (child + 1 < queue.length && queue[child + 1]!.cost < queue[child]!.cost) child++;
        if (queue[child]!.cost >= last.cost) break;
        queue[i] = queue[child]!;
        i = child;
      }
      queue[i] = last;
    }
    return first;
  }
  starts.forEach((port, i) => {
    const id = index(port.escape);
    // A stub may cross its own expanded body, but no other visible object.
    if (
      inside[id] ||
      obstacles.some((b, j) => boxes[j] !== from && crossesBounds(port.anchor, port.escape, b))
    )
      return;
    const state = (id + (copies > 1 ? i * points.length : 0)) * 2 + port.axis;
    costs[state] = clearance - gap;
    origin[state] = i;
    push(state, costs[state]!);
  });
  let best = Infinity,
    finish = -1,
    endPort = -1;
  while (queue.length) {
    const { state, cost } = pop();
    if (cost !== costs[state] || cost > best) continue;
    const id = (state >>> 1) % points.length,
      axis = state % 2;
    ends.forEach((port, i) => {
      if (
        index(port.escape) !== id ||
        obstacles.some((b, j) => boxes[j] !== to && crossesBounds(port.anchor, port.escape, b))
      )
        return;
      const start = starts[origin[state]!]!;
      if (Math.hypot(start.anchor.x - port.anchor.x, start.anchor.y - port.anchor.y) < epsilon)
        return;
      const total = cost + clearance - gap + (axis === port.axis ? 0 : bend);
      if (total < best) {
        best = total;
        finish = state;
        endPort = i;
      }
    });
    for (const next of adjacent(id)) {
      const target = (next.id + (copies > 1 ? origin[state]! * points.length : 0)) * 2 + next.axis,
        value = cost + next.length + (axis === next.axis ? 0 : bend);
      if (value >= costs[target]!) continue;
      costs[target] = value;
      previous[target] = state;
      origin[target] = origin[state]!;
      push(target, value);
    }
  }
  if (finish < 0)
    throw new Error('No clear connection: separate overlapping bodies or free a port');
  const route = [ends[endPort]!.anchor];
  for (let state = finish; state >= 0; state = previous[state]!)
    route.push(points[(state >>> 1) % points.length]!);
  route.push(starts[origin[finish]!]!.anchor);
  route.reverse();
  const simplified: ConnectionPoint[] = [];
  for (const point of route) {
    const b = simplified.at(-1),
      a = simplified.at(-2);
    if (b && Math.hypot(point.x - b.x, point.y - b.y) < epsilon) continue;
    if (
      a &&
      b &&
      ((Math.abs(a.x - b.x) < epsilon && Math.abs(b.x - point.x) < epsilon) ||
        (Math.abs(a.y - b.y) < epsilon && Math.abs(b.y - point.y) < epsilon))
    )
      simplified.pop();
    simplified.push(point);
  }
  return { start: simplified[0]!, end: simplified.at(-1)!, points: simplified };
}
