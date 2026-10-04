import type { volumeField } from './field.js';

type Point = readonly [number, number];
// Keep true corners; a straight face should remain one pen stroke rather than a raster staircase.
function simplify(path: Point[], epsilon: number): Point[] {
  const points = [...path];
  let changed = true;
  while (changed && points.length > 3) {
    changed = false;
    for (let i = points.length - 1; i >= 0 && points.length > 3; i--) {
      const a = points[(i + points.length - 1) % points.length]!,
        b = points[i]!,
        c = points[(i + 1) % points.length]!;
      const dx = c[0] - a[0],
        dy = c[1] - a[1],
        length = Math.hypot(dx, dy);
      const ux = b[0] - a[0],
        uy = b[1] - a[1],
        vx = c[0] - b[0],
        vy = c[1] - b[1];
      if (
        length &&
        ux * vx + uy * vy > 0 &&
        Math.abs(ux * vy - uy * vx) < Math.hypot(ux, uy) * Math.hypot(vx, vy) * 0.05 &&
        Math.abs(dx * (a[1] - b[1]) - (a[0] - b[0]) * dy) / length < epsilon
      ) {
        points.splice(i, 1);
        changed = true;
      }
    }
  }
  return points;
}

/** Marching cells connect the two sides of a sharp corner with a small bevel.
 * Restore their intersection only when the field confirms it belongs to the surface. */
function corners(
  path: Point[],
  field: ReturnType<typeof volumeField>,
  z: number,
  dx: number,
  dy: number,
) {
  const reach = Math.hypot(dx, dy) * 1.01;
  const tolerance = Math.min(dx, dy) * 1e-4 + 1e-8;
  let changed = true;
  while (changed && path.length > 3) {
    changed = false;
    for (let i = 0; i < path.length; i++) {
      const a = path[(i + path.length - 1) % path.length]!,
        b = path[i]!,
        c = path[(i + 1) % path.length]!,
        d = path[(i + 2) % path.length]!;
      if (Math.hypot(c[0] - b[0], c[1] - b[1]) > reach) continue;
      const ux = b[0] - a[0],
        uy = b[1] - a[1],
        vx = d[0] - c[0],
        vy = d[1] - c[1];
      const lengths = Math.hypot(ux, uy) * Math.hypot(vx, vy);
      const cross = ux * vy - uy * vx;
      if (!lengths || Math.abs(cross) < lengths * 0.2) continue;
      const x = c[0] - b[0],
        y = c[1] - b[1];
      const t = (x * vy - y * vx) / cross;
      const s = (x * uy - y * ux) / cross;
      if (t < 0 || s > 0) continue;
      const point: Point = [b[0] + t * ux, b[1] + t * uy];
      if (
        Math.hypot(point[0] - b[0], point[1] - b[1]) > reach ||
        Math.hypot(point[0] - c[0], point[1] - c[1]) > reach ||
        Math.abs(field.distance(point[0], point[1], z)) > tolerance
      )
        continue;
      path[i] = point;
      path.splice((i + 1) % path.length, 1);
      changed = true;
      break;
    }
  }
  return path;
}
/** A planar section of the same distance field that the GPU and contact solver use. */
export function fieldSection(
  field: ReturnType<typeof volumeField>,
  z = 0,
  resolution = 112,
): Point[][] {
  const { min, max } = field.bounds;
  const width = max.x - min.x,
    height = max.y - min.y;
  const step = Math.max(width, height) / resolution;
  const nx = Math.max(16, Math.ceil(width / step)),
    ny = Math.max(16, Math.ceil(height / step));
  const dx = width / (nx - 2),
    dy = height / (ny - 2);
  const x0 = min.x - dx,
    y0 = min.y - dy;
  const values = new Float64Array((nx + 1) * (ny + 1));
  for (let y = 0; y <= ny; y++)
    for (let x = 0; x <= nx; x++)
      values[y * (nx + 1) + x] = field.distance(x0 + x * dx, y0 + y * dy, z);
  const vertices = new Map<string, Point>();
  const links = new Map<string, string[]>();
  const connect = (a: string, b: string) => {
    if (!links.has(a)) links.set(a, []);
    if (!links.has(b)) links.set(b, []);
    links.get(a)!.push(b);
    links.get(b)!.push(a);
  };
  const cases: Record<number, readonly number[]> = {
    1: [3, 0],
    2: [0, 1],
    3: [3, 1],
    4: [1, 2],
    6: [0, 2],
    7: [3, 2],
    8: [2, 3],
    9: [2, 0],
    11: [2, 1],
    12: [1, 3],
    13: [1, 0],
    14: [0, 3],
  };
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      const coords: Point[] = [
        [x, y],
        [x + 1, y],
        [x + 1, y + 1],
        [x, y + 1],
      ];
      const v = coords.map(([xx, yy]) => values[yy * (nx + 1) + xx]!);
      // A shared zero-distance face belongs to the solid, including exact lattice contacts.
      const mask = v.reduce((m, value, i) => m | (value <= 0 ? 1 << i : 0), 0);
      if (mask === 0 || mask === 15) continue;
      const inside = field.distance(x0 + (x + 0.5) * dx, y0 + (y + 0.5) * dy, z) <= 0;
      const edges =
        mask === 5
          ? inside
            ? [0, 1, 2, 3]
            : [3, 0, 1, 2]
          : mask === 10
            ? inside
              ? [3, 0, 1, 2]
              : [0, 1, 2, 3]
            : cases[mask]!;
      const edge = (e: number) => {
        const key =
          e === 0
            ? `h${x},${y}`
            : e === 1
              ? `v${x + 1},${y}`
              : e === 2
                ? `h${x},${y + 1}`
                : `v${x},${y}`;
        if (!vertices.has(key)) {
          const a = coords[e]!,
            b = coords[(e + 1) % 4]!;
          let low = 0,
            high = 1,
            t = v[e]! / (v[e]! - v[(e + 1) % 4]!);
          // A thin shape has a flat interior distance; linear interpolation alone clips its ends.
          for (let i = 0; i < 14; i++) {
            const d = field.distance(
              x0 + (a[0] + (b[0] - a[0]) * t) * dx,
              y0 + (a[1] + (b[1] - a[1]) * t) * dy,
              z,
            );
            if (Math.abs(d) < 1e-8) break;
            if (d <= 0 === v[e]! <= 0) low = t;
            else high = t;
            t = (low + high) / 2;
          }
          vertices.set(key, [
            x0 + (a[0] + (b[0] - a[0]) * t) * dx,
            y0 + (a[1] + (b[1] - a[1]) * t) * dy,
          ]);
        }
        return key;
      };
      for (let i = 0; i < edges.length; i += 2) connect(edge(edges[i]!), edge(edges[i + 1]!));
    }
  const paths: Point[][] = [];
  const visited = new Set<string>();
  for (const start of links.keys()) {
    if (visited.has(start)) continue;
    const path: Point[] = [];
    let current = start,
      previous = '';
    while (!visited.has(current)) {
      visited.add(current);
      path.push(vertices.get(current)!);
      const next = links.get(current)!.find((key) => key !== previous);
      if (!next) break;
      previous = current;
      current = next;
    }
    if (path.length >= 3)
      paths.push(corners(simplify(path, Math.min(dx, dy) * 1e-4 + 1e-8), field, z, dx, dy));
  }
  return paths;
}
