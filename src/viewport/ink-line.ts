import * as T from './engine.js';
import type { Viewport3DHandle } from './three.js';

type StrokePoint = readonly [number, number] | readonly [number, number, number];
export interface InkStrokeOptions {
  color?: string;
  width?: number;
  opacity?: number;
  dashed?: boolean;
  /** Dash and gap lengths in world units. Width remains in screen pixels. */
  dashSize?: number;
  gapSize?: number;
}
interface StrokeState {
  points: number[][];
  lengths: number[];
  partial: number;
}
const strokes = new WeakMap<T.Line2, StrokeState>();

/** Screen-sized ink with subpixel depth tolerance. Back-facing/hidden curves still occlude. */
export function inkLine(dashed: boolean) {
  const material = new T.LineMaterial({
    linewidth: 1.8,
    transparent: true,
    depthWrite: false,
    dashed,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      'gl_Position = clip;',
      `
      gl_Position = clip;
      // A curve and its tessellated host can differ by a fraction of a screen pixel.
      // Bias by that visual tolerance, independent of scene units and camera distance.
      gl_Position.z += projectionMatrix[3][2] * 1.5 / (projectionMatrix[1][1] * resolution.y);
    `,
    );
  };
  return new T.Line2(new T.LineGeometry(), material);
}

export function updateInkLine(line: T.Line2, points: readonly (readonly number[])[]) {
  if (points.some((p) => p.length < 2 || p.length > 3 || p.some((v) => !Number.isFinite(v))))
    throw new Error('An ink line needs finite 2D or 3D points');
  const state: StrokeState = {
    points: points.map((p) => [p[0]!, p[1]!, p[2] ?? 0]),
    lengths: [0],
    partial: -1,
  };
  strokes.set(line, state);
  let geometry = line.geometry;
  if (points.length < 2) {
    geometry.instanceCount = 0;
    geometry.boundingBox = new T.Box3();
    geometry.boundingSphere = new T.Sphere(new T.Vector3(), 0);
    return;
  }
  let start = geometry.getAttribute('instanceStart'),
    end = geometry.getAttribute('instanceEnd');
  if (!start || start.count !== points.length - 1) {
    // Three caches GPU capacity on the geometry. Replacing only attributes clips a longer path.
    geometry.dispose();
    geometry = line.geometry = new T.LineGeometry();
    geometry.setPositions(state.points.flat());
    start = geometry.getAttribute('instanceStart');
    end = geometry.getAttribute('instanceEnd');
  } else {
    state.points.slice(0, -1).forEach((a, i) => {
      const b = state.points[i + 1]!;
      start.setXYZ(i, a[0]!, a[1]!, a[2]!);
      end.setXYZ(i, b[0]!, b[1]!, b[2]!);
    });
    start.needsUpdate = end.needsUpdate = true;
  }
  for (let i = 1; i < points.length; i++) {
    const a = state.points[i - 1]!,
      b = state.points[i]!;
    state.lengths[i] =
      state.lengths[i - 1]! + Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!);
  }
  geometry.instanceCount = points.length - 1;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  if (line.material.dashed) {
    if (!geometry.getAttribute('instanceDistanceStart')) line.computeLineDistances();
    const from = geometry.getAttribute('instanceDistanceStart'),
      to = geometry.getAttribute('instanceDistanceEnd');
    for (let i = 0; i < points.length - 1; i++) {
      from.setX(i, state.lengths[i]!);
      to.setX(i, state.lengths[i + 1]!);
    }
    from.needsUpdate = to.needsUpdate = true;
  }
}

/** Shared distance parameter for the visible tip and objects travelling with it. */
function strokeLocation(state: StrokeState | undefined, progress: number) {
  if (!Number.isFinite(progress)) throw new Error('Stroke progress must be finite');
  if (!state?.points.length) return;
  const p = Math.max(0, Math.min(1, progress)),
    total = state.lengths.at(-1)!,
    distance = p * total;
  let segment = 0,
    fraction = 0;
  if (total > 0 && p > 0) {
    let low = 1,
      high = state.lengths.length - 1;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (state.lengths[mid]! < distance) low = mid + 1;
      else high = mid;
    }
    segment = low - 1;
    fraction =
      (distance - state.lengths[segment]!) /
      (state.lengths[segment + 1]! - state.lengths[segment]!);
  }
  const a = state.points[segment]!,
    b = state.points[segment + 1] ?? a;
  const point: [number, number, number] = [
    a[0]! + (b[0]! - a[0]!) * fraction,
    a[1]! + (b[1]! - a[1]!) * fraction,
    a[2]! + (b[2]! - a[2]!) * fraction,
  ];
  let direction = b.map((v, i) => v - a[i]!) as [number, number, number];
  let size = Math.hypot(...direction);
  // A path may begin with repeated points. Its first real segment still owns the direction.
  for (let i = segment + 1; size === 0 && i < state.points.length; i++) {
    direction = state.points[i]!.map((v, axis) => v - a[axis]!) as [number, number, number];
    size = Math.hypot(...direction);
  }
  const tangent = direction.map((v) => v / (size || 1)) as [number, number, number];
  return { progress: p, total, distance, segment, point, tangent };
}

/** Reveal by arc length, retaining the complete path for camera framing and reverse seeks. */
export function drawInkLine(line: T.Line2, progress: number) {
  const state = strokes.get(line),
    location = strokeLocation(state, progress);
  if (!state || state.points.length < 2) return;
  const geometry = line.geometry,
    end = geometry.getAttribute('instanceEnd');
  const distanceEnd = geometry.getAttribute('instanceDistanceEnd');
  if (state.partial >= 0) {
    const b = state.points[state.partial + 1]!;
    end.setXYZ(state.partial, b[0]!, b[1]!, b[2]!);
    distanceEnd?.setX(state.partial, state.lengths[state.partial + 1]!);
  }
  state.partial = -1;
  const { progress: p, total, distance, segment: i, point } = location!;
  geometry.instanceCount = p > 0 ? state.points.length - 1 : 0;
  if (p > 0 && p < 1 && total > 0) {
    end.setXYZ(i, ...point);
    distanceEnd?.setX(i, distance);
    geometry.instanceCount = i + 1;
    state.partial = i;
  }
  end.needsUpdate = true;
  if (distanceEnd) distanceEnd.needsUpdate = true;
}

/** Attach root to the viewport's object; the viewport owns GPU resources and the theme. */
function create(
  view: Viewport3DHandle,
  points: readonly StrokePoint[],
  options: InkStrokeOptions = {},
) {
  const {
    color = 'ink',
    width = 1.8,
    opacity = 1,
    dashed = false,
    dashSize = 0.1,
    gapSize = 0.08,
  } = options;
  if (
    ![width, dashSize, gapSize].every((n) => Number.isFinite(n) && n > 0) ||
    !Number.isFinite(opacity) ||
    opacity < 0 ||
    opacity > 1
  )
    throw new Error('Stroke dimensions must be positive and opacity between 0 and 1');
  const root = inkLine(dashed);
  let progress = 1;
  try {
    updateInkLine(root, points);
    view.ink(root.material, color);
  } catch (error) {
    root.geometry.dispose();
    root.material.dispose();
    throw error;
  }
  Object.assign(root.material, { linewidth: width, opacity, dashSize, gapSize });
  return {
    root,
    /** Position in root-local coordinates at the same distance fraction as draw(). */
    pointAt(progress: number) {
      return strokeLocation(strokes.get(root), progress)?.point;
    },
    /** Direction of the same segment used by draw(), including immediately after a corner. */
    tangentAt(progress: number) {
      return strokeLocation(strokes.get(root), progress)?.tangent;
    },
    points(next: readonly StrokePoint[]) {
      updateInkLine(root, next);
      drawInkLine(root, progress);
      view.invalidate();
    },
    draw(next: number) {
      drawInkLine(root, next);
      progress = Math.max(0, Math.min(1, next));
      view.invalidate();
    },
  };
}
export const InkStroke3D = { create };
