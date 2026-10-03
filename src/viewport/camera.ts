import { Box3, Vector3, PerspectiveCamera, type Object3D } from './engine.js';
import { corners } from './projection.js';
import type { Viewport } from './three.js';
import type { Cue } from '../story/cues.js';
export interface Framing {
  target: Object3D | readonly Object3D[];
  direction?: readonly [number, number, number];
  padding?: number;
  inset?: Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>;
}
export interface CameraShot extends Framing {
  cue: Cue;
  travel?: number;
}
const smooth = (p: number) => {
  p = Math.max(0, Math.min(1, p));
  return p * p * (3 - 2 * p);
};
/** Frame named objects, including depth, in the remaining screen area. */
export function framePose(
  camera: PerspectiveCamera,
  width: number,
  height: number,
  options: Framing,
) {
  const objects = Array.isArray(options.target) ? options.target : [options.target],
    box = new Box3();
  for (const object of objects) {
    object.updateWorldMatrix(true, true);
    box.union(new Box3().setFromObject(object));
  }
  if (box.isEmpty()) throw new Error('Cannot frame an empty object');
  const center = box.getCenter(new Vector3()),
    direction = new Vector3(...(options.direction ?? [0.15, 0.08, 1])).normalize();
  if (direction.lengthSq() === 0) throw new Error('Camera direction must be nonzero');
  const vertical = Math.abs(direction.y) > 0.999 ? new Vector3(0, 0, -1) : new Vector3(0, 1, 0);
  const right = vertical.cross(direction).normalize(),
    up = direction.clone().cross(right);
  const padding = options.padding ?? 36,
    horizontal = Math.min(padding, width * 0.06);
  const inset = {
    top: padding,
    right: horizontal,
    bottom: padding,
    left: horizontal,
    ...options.inset,
  };
  const usableW = Math.max(1, width - inset.left - inset.right),
    usableH = Math.max(1, height - inset.top - inset.bottom);
  const tan = Math.tan((camera.fov * Math.PI) / 360),
    tanX = tan * (width / height);
  let distance = 0.1;
  for (const corner of corners(box)) {
    const point = corner.sub(center),
      z = point.dot(direction);
    distance = Math.max(
      distance,
      Math.abs(point.dot(right)) / ((tanX * usableW) / width) + z,
      Math.abs(point.dot(up)) / ((tan * usableH) / height) + z,
    );
  }
  distance *= 1.05;
  const target = center
    .clone()
    .addScaledVector(right, ((inset.right - inset.left) / width) * distance * tanX)
    .addScaledVector(up, ((inset.top - inset.bottom) / height) * distance * tan);
  return { position: target.clone().addScaledVector(direction, distance), target, up };
}
/** Story time drives camera motion; manual orbit never owns or stops that clock. */
export function cameraTrack(view: Viewport, initial: Framing, shots: readonly CameraShot[] = []) {
  const ordered = [...shots].sort((a, b) => a.cue.start - b.cue.start);
  let manual = false,
    lastTime = 0,
    lastReduced = false,
    returning: { time: number; position: Vector3; target: Vector3 } | undefined;
  const pose = (options: Framing) =>
    framePose(view.camera, view.stage.clientWidth, view.stage.clientHeight, options);
  const mix = (
    a: { position: Vector3; target: Vector3; up?: Vector3 },
    b: ReturnType<typeof pose>,
    p: number,
  ) => ({
    position: a.position.clone().lerp(b.position, p),
    target: a.target.clone().lerp(b.target, p),
    up: (a.up ?? view.camera.up).clone().lerp(b.up, p).normalize(),
  });
  function render(time: number, reduced = false) {
    lastTime = time;
    lastReduced = reduced;
    if (manual) return;
    let current = pose(initial);
    for (const shot of ordered) {
      const travel = shot.travel ?? 0.85,
        start = Math.max(0, shot.cue.start - travel);
      if (time < start) break;
      const amount = reduced
        ? Number(time >= shot.cue.start)
        : smooth((time - start) / Math.max(0.001, shot.cue.start - start));
      current = mix(current, pose(shot), amount);
      if (amount < 1) break;
    }
    if (returning) {
      const p = reduced ? 1 : smooth((time - returning.time) / 0.65);
      current = mix(returning, current, p);
      if (p >= 1) returning = undefined;
    }
    view.camera.up.copy(current.up);
    view.camera.position.copy(current.position);
    view.controls.target.copy(current.target);
    view.camera.near = 0.01;
    view.camera.far = Math.max(1000, current.position.distanceTo(current.target) * 10);
    view.camera.updateProjectionMatrix();
    view.controls.update();
    view.invalidate();
  }
  const stopInteract = view.onInteract(() => {
    manual = true;
    returning = undefined;
  });
  const stopResize = view.onResize(() => render(lastTime, lastReduced));
  return {
    render,
    explore() {
      manual = true;
      returning = undefined;
    },
    resume(time = lastTime, { animate = false } = {}) {
      manual = false;
      returning = animate
        ? { time, position: view.camera.position.clone(), target: view.controls.target.clone() }
        : undefined;
      render(time, lastReduced);
    },
    get following() {
      return !manual;
    },
    dispose() {
      stopInteract();
      stopResize();
    },
  };
}
