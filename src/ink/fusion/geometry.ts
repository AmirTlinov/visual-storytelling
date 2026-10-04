import type { InkPatch } from './motion.js';

/** Already transported ink, shared by the canvas and the solid's GPU material. */
export interface InkFieldFrame {
  readonly segments: readonly Float32Array[];
  readonly visibility: readonly Float32Array[];
  /** Each contiguous range joins its own sources; different materials form a hard union. */
  readonly groups: readonly { start: number; end: number; tension: number }[];
  readonly details: boolean;
  readonly label: string;
  readonly marks: { segments: Float32Array; visibility: Float32Array };
}

/** The canvas and solid atlas share this order, retaining at most four reusable fields. */
export function composeInkField(
  groups: InkFieldFrame['groups'],
  draw: (source: number, target: number) => void,
  combine: (first: number, second: number, target: number, tension: number) => void,
) {
  let aggregate = -1;
  for (const group of groups) {
    if (group.start === group.end) continue;
    // Reserve the completed materials while the next material uses the other three slots.
    let local = aggregate === 0 ? 1 : 0;
    let spare = local + 1;
    if (spare === aggregate) spare++;
    let incoming = spare + 1;
    if (incoming === aggregate) incoming++;
    draw(group.start, local);
    for (let source = group.start + 1; source < group.end; source++) {
      draw(source, incoming);
      combine(local, incoming, spare, group.tension);
      const previous = local;
      local = spare;
      spare = previous;
    }
    if (aggregate >= 0) {
      combine(aggregate, local, spare, 0);
      aggregate = spare;
    } else aggregate = local;
  }
  return Math.max(0, aggregate);
}

/** Borrowed displayed buffers. Values remain valid until the next render. */
export interface FusionGeometry {
  /** Each source buffer stores ax, ay, bx, by, radiusA, radiusB per segment. */
  readonly segments: readonly Float32Array[];
  readonly visibility: readonly Float32Array[];
  readonly patches: readonly InkPatch[];
  readonly tension: number;
  readonly revision: number;
  readonly bounds: { left: number; top: number; right: number; bottom: number };
  distance(x: number, y: number): number;
}

function segmentDistance(values: Float32Array, at: number, x: number, y: number) {
  const ax = values[at]!,
    ay = values[at + 1]!;
  const dx = values[at + 2]! - ax,
    dy = values[at + 3]! - ay;
  const t = Math.max(
    0,
    Math.min(1, ((x - ax) * dx + (y - ay) * dy) / Math.max(dx * dx + dy * dy, 0.00001)),
  );
  return (
    Math.hypot(x - ax - t * dx, y - ay - t * dy) - values[at + 4]! * (1 - t) - values[at + 5]! * t
  );
}

function join(a: number, b: number, tension: number) {
  if (!Number.isFinite(a)) return b;
  if (!Number.isFinite(b)) return a;
  const h = tension ? Math.max(tension - Math.abs(a - b), 0) / tension : 0;
  return Math.min(a, b) - h * h * tension * 0.25;
}

/** The CPU reference uses the same capsules and smooth union as the visible GPU field. */
export function inkGeometry(
  segments: readonly Float32Array[],
  visibility: readonly Float32Array[],
  patches: readonly InkPatch[],
  tension: number,
  revision: number,
): FusionGeometry {
  const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  segments.forEach((data, source) => {
    for (let at = 0; at < data.length; at += 6) {
      if (visibility[source]![at / 6]! < 0.5) continue;
      const r = Math.max(data[at + 4]!, data[at + 5]!) + tension;
      bounds.left = Math.min(bounds.left, data[at]! - r, data[at + 2]! - r);
      bounds.top = Math.min(bounds.top, data[at + 1]! - r, data[at + 3]! - r);
      bounds.right = Math.max(bounds.right, data[at]! + r, data[at + 2]! + r);
      bounds.bottom = Math.max(bounds.bottom, data[at + 1]! + r, data[at + 3]! + r);
    }
  });
  return {
    segments,
    visibility,
    patches,
    tension,
    revision,
    bounds,
    distance(x, y) {
      let distance = Infinity;
      segments.forEach((data, source) => {
        let local = Infinity;
        for (let at = 0; at < data.length; at += 6)
          if (visibility[source]![at / 6]! >= 0.5)
            local = Math.min(local, segmentDistance(data, at, x, y));
        distance = join(distance, local, tension);
      });
      return distance;
    },
  };
}

/** Sample only each stroke's neighbourhood; avoid a full strokes × grid scan. */
export function inkVoxels(geometry: FusionGeometry, cellSize: number) {
  if (!(cellSize > 0) || !Number.isFinite(cellSize))
    throw new Error('Fusion cell size must be positive and finite');
  const { bounds, segments, visibility, tension } = geometry;
  if (!Number.isFinite(bounds.left)) return new Int32Array();
  const padding = cellSize / Math.SQRT2;
  const left = Math.floor((bounds.left - padding) / cellSize),
    top = Math.floor((bounds.top - padding) / cellSize);
  const right = Math.ceil((bounds.right + padding) / cellSize),
    bottom = Math.ceil((bounds.bottom + padding) / cellSize);
  const width = right - left + 1,
    height = bottom - top + 1,
    count = width * height;
  if (!Number.isSafeInteger(count) || count > 1_000_000)
    throw new Error('Fusion collider exceeds one million cells; increase cellSize');
  const field = new Float32Array(count).fill(Infinity),
    local = new Float32Array(count);
  segments.forEach((data, source) => {
    local.fill(Infinity);
    for (let at = 0; at < data.length; at += 6) {
      if (visibility[source]![at / 6]! < 0.5) continue;
      const radius = Math.max(data[at + 4]!, data[at + 5]!) + tension + padding;
      const x0 = Math.max(
        left,
        Math.floor((Math.min(data[at]!, data[at + 2]!) - radius) / cellSize),
      );
      const x1 = Math.min(
        right,
        Math.ceil((Math.max(data[at]!, data[at + 2]!) + radius) / cellSize),
      );
      const y0 = Math.max(
        top,
        Math.floor((Math.min(data[at + 1]!, data[at + 3]!) - radius) / cellSize),
      );
      const y1 = Math.min(
        bottom,
        Math.ceil((Math.max(data[at + 1]!, data[at + 3]!) + radius) / cellSize),
      );
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const i = (y - top) * width + x - left;
          local[i] = Math.min(
            local[i]!,
            segmentDistance(data, at, (x + 0.5) * cellSize, (y + 0.5) * cellSize),
          );
        }
    }
    for (let i = 0; i < count; i++) field[i] = join(field[i]!, local[i]!, tension);
  });
  const cells: number[] = [];
  for (let i = 0; i < count; i++)
    if (field[i]! <= padding) cells.push(left + (i % width), top + Math.floor(i / width));
  return Int32Array.from(cells);
}
