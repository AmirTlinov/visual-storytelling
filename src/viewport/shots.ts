import * as T from './engine.js';
import {
  readableFrame,
  geometryFrameAnchors,
  type FrameAnchor,
  type ReadableFrame,
} from './framing.js';

export interface Shot3D {
  target: T.Object3D | T.Box3 | readonly T.Object3D[];
  /** Direction from the target towards the camera. */
  direction?: readonly [number, number, number];
  /** Safe margin in screen pixels. */
  padding?: number;
  anchors?: readonly FrameAnchor[];
  insets?: ReadableFrame['insets'];
}
export interface ShotTransition3D extends Shot3D {
  from?: Shot3D;
  progress?: number;
  reduced?: boolean;
}

const corners = (bounds: T.Box3): FrameAnchor[] => {
  const result: FrameAnchor[] = [];
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z])
        result.push({ position: new T.Vector3(x, y, z), padding: [0, 0] });
  return result;
};

/** Fit authored targets, then interpolate a pose at the existing story time. */
export function shotPose(
  camera: T.PerspectiveCamera,
  width: number,
  height: number,
  shot: ShotTransition3D,
) {
  function frame(options: Shot3D) {
    const bounds = new T.Box3();
    if (options.target instanceof T.Box3) bounds.copy(options.target);
    else
      for (const anchor of geometryFrameAnchors(
        Array.isArray(options.target) ? options.target : [options.target],
      ))
        bounds.expandByPoint(anchor.position);
    if (bounds.isEmpty()) throw new Error('A camera shot needs a non-empty object or bounds');
    const sphere = bounds.getBoundingSphere(new T.Sphere()),
      radius = Math.max(sphere.radius, 0.1);
    const margin = options.padding ?? 24;
    const direction = new T.Vector3(...(options.direction ?? [3.2, 2, 4.5])).normalize();
    const up = camera.up.clone().normalize();
    if (Math.abs(direction.dot(up)) > 1 - 1e-12) {
      // Preserve the turn's approach at the pole, where lookAt otherwise changes roll abruptly.
      const other = options === shot ? shot.from : shot;
      const side = new T.Vector3(...(other?.direction ?? [0, 0, 1]));
      side.addScaledVector(up, -side.dot(up));
      if (side.lengthSq() < 1e-12) {
        side.set(Math.abs(up.x) < 0.9 ? 1 : 0, 0, Math.abs(up.x) < 0.9 ? 0 : 1);
        side.addScaledVector(up, -side.dot(up));
      }
      direction.addScaledVector(side.normalize(), 1e-4).normalize();
    }
    const insets = { top: margin, right: margin, bottom: margin, left: margin, ...options.insets };
    const pose = readableFrame(camera, {
      center: sphere.center,
      direction,
      width,
      height,
      insets,
      anchors: [...corners(bounds), ...(options.anchors ?? [])],
    });
    return {
      target: pose.target,
      direction: direction.normalize(),
      distance: pose.position.distanceTo(pose.target),
      radius,
      bounds,
      insets,
    };
  }
  const to = frame(shot),
    from = shot.from ? frame(shot.from) : to;
  const progress = Math.max(0, Math.min(1, shot.progress ?? 1));
  const t = shot.reduced ? Number(progress > 0) : progress * progress * (3 - 2 * progress);
  const target = from.target.clone().lerp(to.target, t);
  const rotation = new T.Quaternion().setFromUnitVectors(from.direction, to.direction);
  const direction =
    t === 1
      ? to.direction.clone()
      : from.direction.clone().applyQuaternion(new T.Quaternion().slerp(rotation, t));
  let distance = Math.exp(Math.log(from.distance) * (1 - t) + Math.log(to.distance) * t);
  if (t > 0 && t < 1) {
    // Endpoint fits alone can clip a long object halfway through a turn.
    const bounds = new T.Box3(
      from.bounds.min.clone().lerp(to.bounds.min, t),
      from.bounds.max.clone().lerp(to.bounds.max, t),
    );
    const insets = Object.fromEntries(
      (['top', 'right', 'bottom', 'left'] as const).map((key) => [
        key,
        from.insets[key] + (to.insets[key] - from.insets[key]) * t,
      ]),
    );
    const fit = readableFrame(camera, {
      center: target,
      direction,
      width,
      height,
      insets,
      anchors: corners(bounds),
    });
    target.copy(fit.target);
    distance = Math.max(distance, fit.position.distanceTo(fit.target));
  }
  const radius = Math.max(from.radius, to.radius);
  return {
    target,
    position: target.clone().addScaledVector(direction, distance),
    radius: Math.exp(Math.log(from.radius) * (1 - t) + Math.log(to.radius) * t),
    near: Math.min(from.radius, to.radius) / 100,
    far: distance + radius * 100,
  };
}
