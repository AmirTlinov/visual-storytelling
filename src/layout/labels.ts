export interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Fading labels yield space to opaque neighbours; fully transparent labels reserve no space. */
  opacity?: number;
  /** Higher priority keeps its preferred position first when hard constraints require repacking. */
  priority?: number;
}

/** Protected-space boundaries, in the same coordinates as the area. */
export interface LabelLimits {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}
export interface LabelSegment {
  from: readonly [number, number];
  to: readonly [number, number];
  width?: number;
}
export interface LabelPlacementOptions {
  limits?: readonly LabelLimits[];
  obstacles?: readonly LabelBox[];
  segments?: readonly LabelSegment[];
  /** An additional convex visible boundary, in the same coordinates as the area. */
  boundary?: readonly { x: number; y: number }[];
  gap?: number;
}
export interface LabelPlacement extends LabelBox {
  /** Overflow is explicit; its finite position is a suggestion and must not be drawn as placed. */
  status: 'placed' | 'overflow';
}

type Point = { x: number; y: number };
type Bounds = { left: number; right: number; top: number; bottom: number };
type Edge = readonly [Point, Point];
const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));
const visible = (box: LabelBox) => (box.opacity ?? 1) > 0;
const cross = (a: Point, b: Point, p: Point) =>
  (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
const tolerance = (...values: number[]) =>
  Math.max(1, ...values.map(Math.abs)) * Number.EPSILON * 64;
const rectangle = (left: number, top: number, right: number, bottom: number): Point[] => [
  { x: left, y: top },
  { x: right, y: top },
  { x: right, y: bottom },
  { x: left, y: bottom },
];

function hull(points: Point[]) {
  const sorted = points.sort((a, b) => a.x - b.x || a.y - b.y);
  const half = (list: Point[]) => {
    const result: Point[] = [];
    for (const p of list) {
      while (result.length > 1 && cross(result.at(-2)!, result.at(-1)!, p) <= 0) result.pop();
      result.push(p);
    }
    return result.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

/** The parts of the rectangular area outside its convex visible boundary. */
function outsideBoundary(area: LabelBox, boundary: readonly Point[] = []): Point[][] {
  if (!boundary.length) return [];
  if (boundary.length < 3 || boundary.some((p) => ![p.x, p.y].every(Number.isFinite)))
    throw new Error('Label boundary must be a finite convex polygon');
  const signedArea = boundary
    .slice(1, -1)
    .reduce((sum, p, i) => sum + cross(boundary[0]!, p, boundary[i + 2]!), 0);
  if (!signedArea) throw new Error('Label boundary must have positive area');
  const points = signedArea > 0 ? boundary : [...boundary].reverse();
  return points.flatMap((a, i) => {
    const b = points[(i + 1) % points.length]!;
    if (points.some((p) => cross(a, b, p) < -tolerance(a.x, a.y, b.x, b.y, p.x, p.y)))
      throw new Error('Label boundary must be a convex polygon in perimeter order');
    const rectanglePoints = rectangle(area.x, area.y, area.x + area.width, area.y + area.height);
    const outside: Point[] = [];
    for (let j = 0; j < rectanglePoints.length; j++) {
      const p = rectanglePoints[j]!,
        q = rectanglePoints[(j + 1) % rectanglePoints.length]!,
        dp = cross(a, b, p),
        dq = cross(a, b, q);
      if (dp <= 0) outside.push(p);
      if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
        const t = dp / (dp - dq);
        outside.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      }
    }
    return outside.length ? [outside] : [];
  });
}

/** Top-left positions whose label footprint crosses a protected polygon. */
const expanded = (box: LabelBox, polygons: readonly Point[][]) =>
  polygons.map((polygon) =>
    hull(polygon.flatMap((p) => rectangle(p.x - box.width, p.y - box.height, p.x, p.y))),
  );
function inside(point: Point, polygon: readonly Point[]) {
  return (
    polygon.length >= 3 &&
    polygon.every((a, i) => {
      const b = polygon[(i + 1) % polygon.length]!;
      return (
        cross(a, b, point) >
        tolerance(a.x, a.y, b.x, b.y, point.x, point.y) * Math.hypot(b.x - a.x, b.y - a.y)
      );
    })
  );
}
function clip(edge: Edge, bounds: Bounds): Edge | undefined {
  const [a, b] = edge;
  let lo = 0,
    hi = 1;
  for (const [axis, min, max] of [
    ['x', bounds.left, bounds.right],
    ['y', bounds.top, bounds.bottom],
  ] as const) {
    const delta = b[axis] - a[axis];
    if (!delta) {
      if (a[axis] < min || a[axis] > max) return;
    } else {
      const first = (min - a[axis]) / delta,
        last = (max - a[axis]) / delta;
      lo = Math.max(lo, Math.min(first, last));
      hi = Math.min(hi, Math.max(first, last));
      if (lo > hi) return;
    }
  }
  const at = (t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  return [at(lo), at(hi)];
}
function intersect([a, b]: Edge, [c, d]: Edge): Point | undefined {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    ex = d.x - c.x,
    ey = d.y - c.y;
  const determinant = dx * ey - dy * ex;
  if (!determinant) return;
  const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / determinant;
  const u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / determinant;
  if (t < 0 || t > 1 || u < 0 || u > 1) return;
  return { x: a.x + t * dx, y: a.y + t * dy };
}
const project = (p: Point, [a, b]: Edge) => {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return { x: a.x + t * dx, y: a.y + t * dy };
};

/** Forbidden top-left positions. A segment sweeps the expanded label, preserving its diagonal. */
function forbidden(
  box: LabelBox,
  obstacles: readonly LabelBox[],
  segments: readonly LabelSegment[],
  gap: number,
) {
  return [
    ...obstacles.map((other) =>
      rectangle(
        other.x - box.width - gap,
        other.y - box.height - gap,
        other.x + other.width + gap,
        other.y + other.height + gap,
      ),
    ),
    ...segments.map(({ from, to, width = 0 }) => {
      const padding = gap + width / 2;
      return hull(
        [from, to].flatMap(([x, y]) =>
          rectangle(x - box.width - padding, y - box.height - padding, x + padding, y + padding),
        ),
      );
    }),
  ];
}

/** Finite nearest-boundary search; only obstacles actually blocking a nearer candidate are expanded. */
function nearest(box: LabelBox, bounds: Bounds, polygons: readonly Point[][]): Point | undefined {
  const queue: (Point & { distance: number })[] = [],
    seen = new Set<string>(),
    expanded = new Set<number>();
  const edges: Edge[] = [];
  const push = (p: Point) => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    const x = clamp(p.x, bounds.left, bounds.right),
      y = clamp(p.y, bounds.top, bounds.bottom);
    const key = `${x}/${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    queue.push({ x, y, distance: Math.hypot(x - box.x, y - box.y) });
  };
  push(box);
  while (queue.length) {
    queue.sort((a, b) => b.distance - a.distance || b.y - a.y || b.x - a.x);
    const point = queue.pop()!;
    const blocking = polygons.flatMap((polygon, i) => (inside(point, polygon) ? [i] : []));
    if (!blocking.length) return { x: point.x, y: point.y };
    for (const i of blocking) {
      if (expanded.has(i)) continue;
      expanded.add(i);
      const polygon = polygons[i]!;
      const added: Edge[] = [];
      polygon.forEach((a, j) => {
        const edge = clip([a, polygon[(j + 1) % polygon.length]!], bounds);
        if (!edge) return;
        push(edge[0]);
        push(edge[1]);
        push(project(box, edge));
        for (const other of edges) {
          const crossing = intersect(edge, other);
          if (crossing) push(crossing);
        }
        added.push(edge);
      });
      edges.push(...added);
    }
  }
}

/** Preserve smooth prepared order when feasible; otherwise place by priority and report overflow. */
export function placeLabels(
  preferred: readonly LabelBox[],
  area: LabelBox,
  { limits = [], obstacles = [], segments = [], boundary, gap = 8 }: LabelPlacementOptions = {},
): LabelPlacement[] {
  if (
    !Number.isFinite(gap) ||
    gap < 0 ||
    [area, ...preferred, ...obstacles].some(
      (b) =>
        ![
          b.x,
          b.y,
          b.width,
          b.height,
          b.x + b.width,
          b.y + b.height,
          b.opacity ?? 1,
          b.priority ?? 0,
        ].every(Number.isFinite) ||
        b.width < 0 ||
        b.height < 0,
    ) ||
    limits.some((b) =>
      Object.values(b).some((value) => value !== undefined && !Number.isFinite(value)),
    ) ||
    segments.some(
      (s) => ![...s.from, ...s.to, s.width ?? 0].every(Number.isFinite) || (s.width ?? 0) < 0,
    )
  )
    throw new Error('Label geometry must be finite; dimensions, gap and stroke width nonnegative');
  const bounds = preferred.map((box, i): Bounds => {
    const bound = {
      left: Math.max(area.x, limits[i]?.left ?? area.x),
      right: Math.min(area.x + area.width, limits[i]?.right ?? area.x + area.width) - box.width,
      top: Math.max(area.y, limits[i]?.top ?? area.y),
      bottom:
        Math.min(area.y + area.height, limits[i]?.bottom ?? area.y + area.height) - box.height,
    };
    // Measured x + width - width can fall one ulp below x. Preserve an exact-position limit.
    if (bound.left > bound.right && bound.left - bound.right <= tolerance(bound.left, bound.right))
      bound.right = bound.left;
    if (bound.top > bound.bottom && bound.top - bound.bottom <= tolerance(bound.top, bound.bottom))
      bound.bottom = bound.top;
    return bound;
  });
  const fits = (b: Bounds) => b.left <= b.right && b.top <= b.bottom;
  const placed: LabelPlacement[] = preferred.map((box, i) => ({
    ...box,
    x: clamp(box.x, bounds[i]!.left, Math.max(bounds[i]!.left, bounds[i]!.right)),
    y: clamp(box.y, bounds[i]!.top, Math.max(bounds[i]!.top, bounds[i]!.bottom)),
    status: fits(bounds[i]!) ? 'placed' : 'overflow',
  }));
  const active = preferred.flatMap((box, i) => (visible(box) ? [i] : []));
  const fixed = obstacles.filter(visible);
  const outside = outsideBoundary(area, boundary);
  const boundaries = preferred.map((box) => expanded(box, outside));
  const polygons = preferred.map((box, i) => [
    ...forbidden(box, fixed, segments, gap),
    ...boundaries[i]!,
  ]);
  const centers = preferred.map((box) => box.y + box.height / 2);
  // Opacity weights displacement, never the readable gap. An arriving label takes
  // the free position first and gradually shares displacement as it becomes opaque.
  const mobility = preferred.map(
    (box) => 1 / Math.max(Number.EPSILON, Math.min(1, box.opacity ?? 1)),
  );
  const constraints: {
    i: number;
    j?: number;
    sign: number;
    distance: number;
    dual: number;
  }[] = [];
  for (const i of active) {
    const box = placed[i]!,
      bound = bounds[i]!;
    if (!fits(bound)) continue;
    constraints.push(
      { i, sign: 1, distance: bound.top + box.height / 2, dual: 0 },
      { i, sign: -1, distance: -(bound.bottom + box.height / 2), dual: 0 },
    );
    for (const j of active) {
      if (j <= i || !fits(bounds[j]!)) continue;
      const other = placed[j]!;
      const clearance =
        Math.abs(box.x + box.width / 2 - other.x - other.width / 2) - (box.width + other.width) / 2;
      const ramp = gap * 3;
      const t = ramp ? clamp((gap + ramp - clearance) / ramp, 0, 1) : Number(clearance <= 0);
      if (!t) continue;
      const contact = t * t * (3 - 2 * t);
      constraints.push({
        i,
        j,
        sign: -1,
        distance: contact * ((box.height + other.height) / 2 + gap) - (1 - contact) * area.height,
        dual: 0,
      });
    }
  }
  // Difference constraints follow the input order, so a forward/backward pass detects infeasibility.
  const lower = bounds.map((b, i) => b.top + placed[i]!.height / 2);
  const upper = bounds.map((b, i) => b.bottom + placed[i]!.height / 2);
  const pairs = constraints.filter((c): c is typeof c & { j: number } => c.j !== undefined);
  for (const { i, j, distance } of pairs) lower[j] = Math.max(lower[j]!, lower[i]! + distance);
  for (const { i, j, distance } of [...pairs].reverse())
    upper[i] = Math.min(upper[i]!, upper[j]! - distance);
  let feasible = active.every(
    (i) => fits(bounds[i]!) && lower[i]! <= upper[i]! + tolerance(lower[i]!, upper[i]!),
  );
  if (feasible) {
    for (let iteration = 0; iteration < Math.max(256, 64 * active.length ** 2); iteration++) {
      let change = 0;
      for (const constraint of constraints) {
        const { i, j, sign, distance } = constraint;
        const value = sign * centers[i]! + (j === undefined ? 0 : centers[j]!);
        const norm = mobility[i]! + (j === undefined ? 0 : mobility[j]!);
        const dual = Math.max(0, constraint.dual + (distance - value) / norm);
        const step = dual - constraint.dual;
        centers[i]! += sign * step * mobility[i]!;
        if (j !== undefined) centers[j]! += step * mobility[j]!;
        constraint.dual = dual;
        change = Math.max(change, Math.abs(step) * norm);
      }
      if (change < 1e-7) break;
    }
    // Remove the last floating-point residual without changing the prepared ordering.
    for (const i of active) {
      centers[i] = clamp(centers[i]!, lower[i]!, upper[i]!);
      for (const pair of pairs)
        if (pair.i === i) centers[pair.j] = Math.max(centers[pair.j]!, centers[i]! + pair.distance);
      placed[i]!.y = clamp(centers[i]! - placed[i]!.height / 2, bounds[i]!.top, bounds[i]!.bottom);
    }
    feasible = active.every(
      (i) =>
        ![
          ...polygons[i]!,
          ...forbidden(
            placed[i]!,
            active.filter((j) => j < i).map((j) => placed[j]!),
            [],
            gap,
          ),
        ].some((polygon) => inside(placed[i]!, polygon)),
    );
    if (feasible) return placed;
  }
  const occupied = [...fixed];
  for (const i of [...active].sort(
    (a, b) => (preferred[b]!.priority ?? 0) - (preferred[a]!.priority ?? 0) || a - b,
  )) {
    const point = fits(bounds[i]!)
      ? nearest(preferred[i]!, bounds[i]!, [
          ...forbidden(preferred[i]!, occupied, segments, gap),
          ...boundaries[i]!,
        ])
      : undefined;
    if (point) {
      Object.assign(placed[i]!, point, { status: 'placed' });
      occupied.push(placed[i]!);
    } else placed[i]!.status = 'overflow';
  }
  return placed;
}
