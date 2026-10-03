import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { contactPlanes } from './contact-planes.js';

export type VolumePoint = readonly [number, number, number];
export type VolumeShape =
  | { readonly kind: 'box'; readonly size: VolumePoint; readonly rounding: number }
  | { readonly kind: 'sphere'; readonly radius: number }
  | { readonly kind: 'capsule'; readonly radius: number; readonly length: number };
export interface VolumePose {
  position?: VolumePoint;
  /** Euler angles in radians, applied in XYZ order. */
  rotation?: VolumePoint;
  scale?: number;
}
export interface VolumeFrame {
  sources: readonly VolumePose[];
  target?: VolumePose;
  morph: number;
  /** Contact blend width in scene units; zero disables the contact blend. */
  tension?: number;
}
function positive(...values: number[]) {
  if (values.some((n) => !Number.isFinite(n) || n <= 0))
    throw new Error('Volume dimensions must be positive and finite');
}
function finitePoint(point: VolumePoint) {
  if (
    point?.length !== 3 ||
    !Number.isFinite(point[0]) ||
    !Number.isFinite(point[1]) ||
    !Number.isFinite(point[2])
  )
    throw new Error('Volume points must contain three finite coordinates');
}
function boxDimensions(size: VolumePoint, rounding: number) {
  finitePoint(size);
  positive(...size);
  if (!Number.isFinite(rounding) || rounding < 0 || rounding > Math.min(...size) / 2)
    throw new Error('Rounding must fit inside the box');
}
export function volumeBox(size: VolumePoint, rounding = 0): VolumeShape {
  boxDimensions(size, rounding);
  return Object.freeze({ kind: 'box', size: Object.freeze([...size]) as VolumePoint, rounding });
}
export function volumeSphere(radius: number): VolumeShape {
  positive(radius);
  return Object.freeze({ kind: 'sphere', radius });
}
/** Capsule along X; length includes its round ends. */
export function volumeCapsule(radius: number, length: number): VolumeShape {
  positive(radius, length);
  if (length < radius * 2) throw new Error('Capsule length must contain its round ends');
  return Object.freeze({ kind: 'capsule', radius, length });
}

/** Shared field parameters: the renderer uploads these arrays directly to the GPU.
 * distance() is the CPU reference for geometry checks and renderer comparisons. */
export function volumeField(sources: readonly VolumeShape[], target: VolumeShape) {
  if (!sources.length) throw new Error('Volume morph needs at least one source');
  const count = sources.length,
    shapes = [...sources, target];
  const kinds = new Int32Array(shapes.length),
    parameters = new Float32Array(shapes.length * 4);
  const transforms = new Float32Array(shapes.length * 16),
    scales = new Float32Array(shapes.length);
  const nextTransforms = new Float32Array(transforms.length),
    nextScales = new Float32Array(scales.length);
  const planes = new Float32Array(24),
    nextPlanes = new Float32Array(24);
  shapes.forEach((shape, i) => {
    const at = i * 4;
    if (!shape || typeof shape !== 'object') throw new Error('Invalid volume shape');
    if (shape.kind === 'box') {
      boxDimensions(shape.size, shape.rounding);
      kinds[i] = 0;
      parameters.set(
        shape.size.map((n) => n / 2 - shape.rounding),
        at,
      );
      parameters[at + 3] = shape.rounding;
    } else if (shape.kind === 'sphere') {
      positive(shape.radius);
      kinds[i] = 1;
      parameters[at] = shape.radius;
    } else if (shape.kind === 'capsule') {
      positive(shape.radius, shape.length);
      if (shape.length < shape.radius * 2)
        throw new Error('Capsule length must contain its round ends');
      kinds[i] = 2;
      parameters[at] = shape.radius;
      parameters[at + 1] = shape.length / 2 - shape.radius;
    } else throw new Error('Unknown volume shape kind');
    if (
      !parameters.subarray(at, at + 4).every(Number.isFinite) ||
      (shape.kind === 'box'
        ? [0, 1, 2].some((axis) => parameters[at + axis]! + parameters[at + 3]! <= 0)
        : parameters[at]! <= 0)
    )
      throw new Error('Volume dimensions must fit positive GPU floats');
    transforms[i * 16] =
      transforms[i * 16 + 5] =
      transforms[i * 16 + 10] =
      transforms[i * 16 + 15] =
        1;
    scales[i] = 1;
  });
  const matrix = new Matrix4(),
    position = new Vector3(),
    scale = new Vector3(),
    rotation = new Euler(),
    quaternion = new Quaternion();
  const updatePlanes = contactPlanes(kinds, parameters);
  let progress = 0,
    tension = 0,
    planeCount = 0;
  function updatePose(pose: VolumePose = {}, i: number) {
    const p = pose.position ?? [0, 0, 0],
      r = pose.rotation ?? [0, 0, 0],
      s = pose.scale ?? 1;
    positive(s);
    finitePoint(p);
    finitePoint(r);
    if (!Number.isFinite(Math.fround(s)) || Math.fround(s) <= 0)
      throw new Error('Volume scales must fit positive GPU floats');
    matrix
      .compose(position.set(...p), quaternion.setFromEuler(rotation.set(...r)), scale.setScalar(s))
      .invert();
    nextTransforms.set(matrix.elements, i * 16);
    nextScales[i] = s;
  }
  function primitive(i: number, x: number, y: number, z: number) {
    const m = i * 16,
      a = i * 4;
    const px =
      transforms[m]! * x + transforms[m + 4]! * y + transforms[m + 8]! * z + transforms[m + 12]!;
    const py =
      transforms[m + 1]! * x +
      transforms[m + 5]! * y +
      transforms[m + 9]! * z +
      transforms[m + 13]!;
    const pz =
      transforms[m + 2]! * x +
      transforms[m + 6]! * y +
      transforms[m + 10]! * z +
      transforms[m + 14]!;
    let d: number;
    if (kinds[i] === 0) {
      const qx = Math.abs(px) - parameters[a]!,
        qy = Math.abs(py) - parameters[a + 1]!,
        qz = Math.abs(pz) - parameters[a + 2]!;
      const ox = Math.max(qx, 0),
        oy = Math.max(qy, 0),
        oz = Math.max(qz, 0);
      d =
        Math.sqrt(ox * ox + oy * oy + oz * oz) +
        Math.min(Math.max(qx, qy, qz), 0) -
        parameters[a + 3]!;
    } else {
      const dx =
        kinds[i] === 2 ? px - Math.max(-parameters[a + 1]!, Math.min(parameters[a + 1]!, px)) : px;
      d = Math.sqrt(dx * dx + py * py + pz * pz) - parameters[a]!;
    }
    return d * scales[i]!;
  }
  return {
    kinds,
    parameters,
    transforms,
    scales,
    planes,
    count,
    get planeCount() {
      return planeCount;
    },
    get morph() {
      return progress;
    },
    get tension() {
      return tension;
    },
    update(frame: VolumeFrame) {
      if (frame.sources.length !== count)
        throw new Error('Volume source poses do not match shapes');
      if (!Number.isFinite(frame.morph) || !Number.isFinite(frame.tension ?? 0.2))
        throw new Error('Volume progress and tension must be finite');
      const nextProgress = Math.fround(Math.max(0, Math.min(1, frame.morph)));
      const nextTension = Math.fround(Math.max(0, frame.tension ?? 0.2) * (1 - nextProgress));
      if (!Number.isFinite(nextTension))
        throw new Error('Volume tension must fit a finite GPU float');
      for (let i = 0; i < count; i++) updatePose(frame.sources[i], i);
      updatePose(frame.target, count);
      if (!nextTransforms.every(Number.isFinite))
        throw new Error('Volume transforms must fit finite GPU floats');
      const nextPlaneCount = updatePlanes(nextTransforms, nextTension, nextPlanes);
      if (!nextPlanes.every(Number.isFinite))
        throw new Error('Volume contact planes must fit finite GPU floats');
      transforms.set(nextTransforms);
      scales.set(nextScales);
      planes.set(nextPlanes);
      progress = nextProgress;
      tension = nextTension;
      planeCount = nextPlaneCount;
    },
    distance(x: number, y: number, z: number) {
      if (progress === 1) return primitive(count, x, y, z);
      let d = primitive(0, x, y, z);
      for (let i = 1; i < count; i++) {
        const next = primitive(i, x, y, z),
          h = tension ? Math.max(0, tension - Math.abs(d - next)) / tension : 0;
        d = Math.min(d, next) - h * h * tension * 0.25;
      }
      for (let i = 0; i < planeCount; i++) {
        const at = i * 4;
        d = Math.max(
          d,
          planes[at]! * x + planes[at + 1]! * y + planes[at + 2]! * z + planes[at + 3]!,
        );
      }
      return progress === 0 ? d : d * (1 - progress) + primitive(count, x, y, z) * progress;
    },
  };
}
