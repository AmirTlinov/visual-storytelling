import { arrange } from '../characters/staging/layout.js';
import { furnitureParts } from '../characters/staging/furniture.js';
import { notebookGeometry, notebookParts } from '../characters/staging/notebook.js';
import { portableBounds } from '../characters/staging/portable.js';
import { footprint, supportPoint } from '../characters/staging/objects.js';
import { project } from '../characters/staging/space.js';
import type { StageSet } from '../characters/types.js';
import type { Furniture, GroundPoint } from '../characters/staging/types.js';

type Box = { x: number; y: number; width: number; height: number };
type Interval = readonly [number, number];
const gap = 6;
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width + gap &&
  a.x + a.width + gap > b.x &&
  a.y < b.y + b.height + gap &&
  a.y + a.height + gap > b.y;
const exclude = (intervals: Interval[], left: number, right: number): Interval[] =>
  intervals.flatMap(([a, b]) => {
    if (right <= a || left >= b) return [[a, b]];
    return [...(left > a ? [[a, left] as const] : []), ...(right < b ? [[right, b] as const] : [])];
  });

/** Place only the automatic notebook; authored furniture and relationships remain untouched. */
export function placeNotebook(set: StageSet, bookId: string, deskId: string): StageSet {
  const staging = set.staging!,
    space = staging.projection,
    objects = Object.entries(staging.objects),
    book: Furniture = { kind: 'book', at: { x: 0, z: 0 }, scale: 0.72, color: '#385c63' };
  const measure = (item: Furniture): Box | undefined => {
    if (item.kind === 'prop') {
      if (!item.art) return undefined;
      const at = project(space, item.at);
      return portableBounds(
        { ...at, portable: true, id: '', scale: at.scale * (item.scale ?? 0.72) },
        item.art,
      );
    }
    const parts =
      item.kind === 'book' ? notebookParts(item, space) : furnitureParts(item, space, item.open);
    if (!parts.length) return undefined;
    const x = Math.min(...parts.map((p) => p.bounds.x)),
      y = Math.min(...parts.map((p) => p.bounds.y));
    return {
      x,
      y,
      width: Math.max(...parts.map((p) => p.bounds.x + p.bounds.width)) - x,
      height: Math.max(...parts.map((p) => p.bounds.y + p.bounds.height)) - y,
    };
  };
  const occupied = objects.flatMap(([id, item]) => {
    const bounds = measure(item);
    return bounds ? [{ id, bounds }] : [];
  });
  const visible = (b: Box) =>
    b.x >= 0 && b.y >= 0 && b.x + b.width <= set.width && b.y + b.height <= set.height;
  // Seats remain available to the cast. An empty table supplies a real, large enough plane.
  for (const [id, support] of objects) {
    if (support.kind !== 'table') continue;
    const candidate = { ...book, at: supportPoint(support) },
      plane = footprint(support)!,
      model = notebookGeometry(candidate),
      points = model.faces.flatMap((face) => face.points),
      bounds = measure(candidate)!;
    if (
      points.every(
        (p) => p.x >= plane.left && p.x <= plane.right && p.z >= plane.front && p.z <= plane.back,
      ) &&
      visible(bounds) &&
      !occupied.some((p) => p.id !== id && overlaps(bounds, p.bounds))
    )
      return arrange(set, { objects: { [bookId]: { ...book, at: { of: id, side: 'on' } } } });
  }

  const paper = notebookGeometry(book).faces.flatMap((face) => face.points),
    blank: Furniture = { kind: 'table', at: { x: 0, z: 0 } },
    top = footprint(blank)!,
    clearance = (2 * gap) / space.unit,
    desk: Furniture = {
      ...blank,
      color: '#9e8667',
      scale: Math.max(
        (Math.max(...paper.map((p) => p.x)) - Math.min(...paper.map((p) => p.x)) + clearance) /
          (top.right - top.left),
        (Math.max(...paper.map((p) => p.z)) - Math.min(...paper.map((p) => p.z)) + clearance) /
          (top.back - top.front),
      ),
    },
    baseParts = furnitureParts(desk, space),
    vertices = baseParts.flatMap((p) => p.polygons.flatMap((polygon) => polygon.world)),
    base = footprint(desk)!,
    depths = new Set<number>();
  // Candidate rows follow the frame and existing silhouettes. Furniture edges add
  // physical aisles; horizontal intervals below solve their exact projected clearance.
  for (const bottom of [set.height, ...occupied.map((p) => p.bounds.y - gap)]) {
    if (bottom <= space.horizon + gap) continue;
    depths.add(
      Math.max(
        ...vertices.map(
          (p) =>
            space.distance *
              ((space.floor - space.horizon - (p.height ?? 0) * space.unit) /
                (bottom - gap - space.horizon) -
                1) -
            p.z,
        ),
      ),
    );
  }
  for (const [, item] of objects) {
    depths.add(item.at.z);
    const box = footprint(item);
    if (box) {
      depths.add(box.front - base.back);
      depths.add(box.back - base.front);
    }
  }
  const floorEnd =
    set.backdrop && set.backdrop.divide > space.horizon
      ? space.distance * ((space.floor - space.horizon) / (set.backdrop.divide - space.horizon) - 1)
      : Infinity;
  for (const z of [...depths].sort((a, b) => a - b)) {
    if (z + base.front <= -space.distance || z + base.back > floorEnd) continue;
    const at = { ...desk, at: { x: 0, z } },
      bounds = measure(at)!;
    if (bounds.y < 0 || bounds.y + bounds.height > set.height + 1e-7) continue;
    // Every vertex gives an exact root-x constraint under the existing perspective.
    const roots = (edge: number) =>
      vertices.map(
        (p) =>
          ((edge - space.center) * (space.distance + z + p.z)) / (space.unit * space.distance) -
          p.x,
      );
    const leftOf = (edge: number) => Math.min(...roots(edge - gap)),
      rightOf = (edge: number) => Math.max(...roots(edge + gap));
    let intervals: Interval[] = [[rightOf(0), leftOf(set.width)]];
    for (const { bounds: other } of occupied)
      if (bounds.y < other.y + other.height + gap && bounds.y + bounds.height + gap > other.y)
        intervals = exclude(intervals, leftOf(other.x - gap), rightOf(other.x + other.width + gap));
    for (const [, object] of objects) {
      const box = footprint(object);
      if (box && z + base.front < box.back && z + base.back > box.front)
        intervals = exclude(intervals, box.left - base.right, box.right - base.left);
    }
    // Named floor destinations stay usable after the automatic furniture is inserted.
    for (const spot of Object.values(staging.spots))
      if (!(spot.height ?? 0) && spot.z >= z + base.front && spot.z <= z + base.back)
        intervals = exclude(intervals, spot.x - base.right, spot.x - base.left);
    for (const [left, right] of intervals.sort((a, b) => b[1] - b[0] - (a[1] - a[0]))) {
      if (right <= left) continue;
      const point: GroundPoint = { x: (left + right) / 2, z },
        candidate = { ...desk, at: point },
        box = measure(candidate)!;
      if (!visible(box) || occupied.some((p) => overlaps(box, p.bounds))) continue;
      return arrange(set, {
        objects: {
          [deskId]: candidate,
          [bookId]: { ...book, at: { of: deskId, side: 'on' } },
        },
      });
    }
  }
  throw new Error(
    "No free support or visible space for the story notebook. Add a book on your chosen support with arrange(set, { objects: { book: { kind: 'book', at: { of: 'table-id', side: 'on' } } } }).",
  );
}
