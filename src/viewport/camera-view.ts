import * as T from './engine.js';
import { shotPose, type Shot3D, type ShotTransition3D } from './shots.js';
import type { projectedLabels } from './labels.js';
import type { orbitControls } from './orbit.js';
import type { SceneView } from '../scene-checkpoint.js';
export type CameraShot =
  | ShotTransition3D
  | ((camera: T.PerspectiveCamera, width: number, height: number) => void);
/** The existing 3D camera owns authored following, manual orbit and its local checkpoint. */
export function cameraView3D({
  stage,
  camera,
  controls,
  labels,
  invalidate,
  subjectIds,
}: {
  stage: HTMLElement;
  camera: T.PerspectiveCamera;
  controls: ReturnType<typeof orbitControls>['controls'];
  labels: ReturnType<typeof projectedLabels>;
  invalidate(): void;
  subjectIds(): string[];
}) {
  const aperture = (aspect: number) =>
    Math.sin(Math.atan(Math.tan((camera.fov * Math.PI) / 360) * Math.min(aspect, 1)));
  const range = () => ({
    near: camera.near,
    far: camera.far,
    minDistance: controls.minDistance,
    maxDistance: controls.maxDistance,
  });
  function restoreRange(value: ReturnType<typeof range>) {
    camera.near = value.near;
    camera.far = value.far;
    controls.minDistance = value.minDistance;
    controls.maxDistance = value.maxDistance;
    camera.updateProjectionMatrix();
  }
  let following = true,
    lastShot: CameraShot | undefined;
  let returning:
    | {
        start: number;
        from: { position: T.Vector3; target: T.Vector3 };
        to: { position: T.Vector3; target: T.Vector3 };
        near: number;
        far: number;
        minDistance: number;
        maxDistance: number;
      }
    | undefined;
  function fit(target?: T.Object3D) {
    if (!target) return;
    returning = undefined;
    following = true;
    shot({ target });
  }
  function reset({ animate = false, from: origin }: Parameters<SceneView['reset']>[0] = {}) {
    const saved = origin as { kind?: string; position?: number[]; target?: number[] } | undefined;
    const compatible =
      saved?.kind === 'three' &&
      saved.position?.length === 3 &&
      saved.target?.length === 3 &&
      [...saved.position, ...saved.target].every(Number.isFinite);
    const from = {
      position: compatible ? new T.Vector3(...saved.position!) : camera.position.clone(),
      target: compatible ? new T.Vector3(...saved.target!) : controls.target.clone(),
    };
    const previousNear = camera.near,
      previousFar = camera.far;
    returning = undefined;
    following = true;
    if (lastShot) shot(lastShot);
    if (
      animate &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches &&
      !(lastShot && typeof lastShot !== 'function' && lastShot.reduced) &&
      typeof lastShot !== 'function' &&
      from.position.distanceToSquared(from.target) > 1e-12 &&
      camera.position.distanceToSquared(controls.target) > 1e-12 &&
      (from.position.distanceToSquared(camera.position) > 1e-12 ||
        from.target.distanceToSquared(controls.target) > 1e-12)
    ) {
      returning = {
        start: performance.now(),
        from,
        to: { position: camera.position.clone(), target: controls.target.clone() },
        near: camera.near,
        far: camera.far,
        minDistance: controls.minDistance,
        maxDistance: controls.maxDistance,
      };
      camera.position.copy(from.position);
      controls.target.copy(from.target);
      camera.near = Math.min(previousNear, camera.near);
      camera.far = Math.max(previousFar, camera.far);
      const distance = from.position.distanceTo(from.target);
      controls.minDistance = Math.min(controls.minDistance, distance);
      controls.maxDistance = Math.max(controls.maxDistance, distance);
      camera.updateProjectionMatrix();
      controls.update();
      invalidate();
    }
  }
  function shot(options: CameraShot) {
    lastShot = options;
    if (following) applyShot(options);
  }
  function applyShot(options: CameraShot) {
    const width = stage.clientWidth,
      height = stage.clientHeight;
    if (!width || !height) return;
    if (typeof options === 'function') {
      returning = undefined;
      options(camera, width, height);
      invalidate();
      return;
    }
    const anchors = (shot: Shot3D) => [
      ...labels.anchors(shot.target, shot.bounds !== undefined),
      ...(shot.anchors ?? []),
    ];
    const pose = shotPose(camera, width, height, {
      ...options,
      anchors: anchors(options),
      from: options.from && { ...options.from, anchors: anchors(options.from) },
      reduced: options.reduced ?? matchMedia('(prefers-reduced-motion: reduce)').matches,
    });
    if (returning) {
      returning.to.position.copy(pose.position);
      returning.to.target.copy(pose.target);
      returning.near = pose.near;
      returning.far = pose.far;
      camera.near = Math.min(camera.near, pose.near);
      camera.far = Math.max(camera.far, pose.far);
    } else {
      camera.position.copy(pose.position);
      controls.target.copy(pose.target);
      camera.near = pose.near;
      camera.far = pose.far;
    }
    // Orbit limits follow the subject of this shot, including a tiny part of a large scene.
    const minDistance = pose.radius * 0.7;
    const maxDistance = Math.max(pose.radius * 30, pose.position.distanceTo(pose.target) * 4);
    if (returning) {
      returning.minDistance = minDistance;
      returning.maxDistance = maxDistance;
      controls.minDistance = Math.min(controls.minDistance, minDistance);
      controls.maxDistance = Math.max(controls.maxDistance, maxDistance);
    } else {
      controls.minDistance = minDistance;
      controls.maxDistance = maxDistance;
    }
    camera.updateProjectionMatrix();
    controls.update();
    invalidate();
  }
  function resize() {
    const width = stage.clientWidth,
      height = stage.clientHeight;
    if (!width || !height) return;
    // Preserve the user's orbit and relative zoom as the narrow dimension changes.
    if (lastShot || !following) {
      const scale = aperture(camera.aspect) / aperture(width / height);
      camera.position.sub(controls.target).multiplyScalar(scale).add(controls.target);
      if (returning)
        for (const pose of [returning.from, returning.to])
          pose.position.sub(pose.target).multiplyScalar(scale).add(pose.target);
    }
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (following && lastShot) shot(lastShot);
    invalidate();
  }
  return {
    fit,
    reset,
    shot,
    resize,
    frame() {
      if (returning) {
        const movement = returning;
        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
        const progress = reduced ? 1 : Math.min(1, (performance.now() - movement.start) / 240);
        const amount = progress * progress * (3 - 2 * progress);
        const from = movement.from.position.clone().sub(movement.from.target);
        const to = movement.to.position.clone().sub(movement.to.target);
        const distance = Math.exp(
          Math.log(from.length()) * (1 - amount) + Math.log(to.length()) * amount,
        );
        const turn = new T.Quaternion().setFromUnitVectors(
          from.clone().normalize(),
          to.clone().normalize(),
        );
        const offset = from
          .normalize()
          .applyQuaternion(new T.Quaternion().slerp(turn, amount))
          .multiplyScalar(distance);
        if (progress === 1) {
          camera.position.copy(movement.to.position);
          controls.target.copy(movement.to.target);
          controls.minDistance = movement.minDistance;
          controls.maxDistance = movement.maxDistance;
        } else {
          controls.target.copy(movement.from.target).lerp(movement.to.target, amount);
          camera.position.copy(controls.target).add(offset);
        }
        controls.update();
        if (progress < 1) invalidate();
        else {
          returning = undefined;
          camera.near = movement.near;
          camera.far = movement.far;
          camera.updateProjectionMatrix();
        }
      }
    },
    manual() {
      returning = undefined;
      following = false;
    },
    focus(target: T.Box3) {
      returning = undefined;
      following = false;
      applyShot({ target, padding: 36 });
    },
    get following() {
      return following;
    },
    get transition() {
      return returning ? ('running' as const) : ('idle' as const);
    },
    capture() {
      return {
        kind: 'three',
        following,
        position: camera.position.toArray(),
        target: controls.target.toArray(),
        aspect: camera.aspect,
        ...range(),
        subjects: subjectIds(),
      };
    },
    restore(value: unknown) {
      const state = value as {
        kind?: string;
        following?: boolean;
        position?: number[];
        target?: number[];
        aspect?: number;
        near?: number;
        far?: number;
        minDistance?: number;
        maxDistance?: number;
        subjects?: string[];
      };
      if (
        state?.kind !== 'three' ||
        typeof state.following !== 'boolean' ||
        !state.position ||
        !state.target ||
        state.position.length !== 3 ||
        state.target.length !== 3 ||
        ![...state.position, ...state.target].every(Number.isFinite) ||
        ![state.aspect, state.near, state.far, state.minDistance, state.maxDistance].every(
          (value) => typeof value === 'number' && Number.isFinite(value),
        ) ||
        state.aspect! <= 0 ||
        state.near! <= 0 ||
        state.far! <= state.near! ||
        state.minDistance! < 0 ||
        state.maxDistance! <= state.minDistance! ||
        new T.Vector3(...state.position).distanceToSquared(new T.Vector3(...state.target)) === 0
      )
        return false;
      if (state.subjects?.length && !state.subjects.some((id) => subjectIds().includes(id)))
        return false;
      if (state.following) {
        reset();
        return true;
      }
      returning = undefined;
      following = false;
      camera.position.fromArray(state.position);
      controls.target.fromArray(state.target);
      restoreRange({
        near: state.near!,
        far: state.far!,
        minDistance: state.minDistance!,
        maxDistance: state.maxDistance!,
      });
      if (state.aspect !== camera.aspect) {
        camera.position
          .sub(controls.target)
          .multiplyScalar(aperture(state.aspect!) / aperture(camera.aspect))
          .add(controls.target);
      }
      // A checkpoint may focus one cell of a much larger authored shot. The
      // current shot's orbit limits must not push that saved viewpoint away.
      const distance = camera.position.distanceTo(controls.target);
      controls.minDistance = Math.min(controls.minDistance, distance);
      controls.maxDistance = Math.max(controls.maxDistance, distance);
      controls.update();
      invalidate();
      return true;
    },
    dispose() {
      returning = undefined;
      lastShot = undefined;
    },
  };
}
