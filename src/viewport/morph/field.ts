import { Box3, Euler, Matrix4, Quaternion, Vector3 } from 'three';
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
  /** Positive uniform or per-axis scale. */
  scale?: number | VolumePoint;
}
export interface VolumeFrame {
  sources: readonly VolumePose[];
  targets: readonly VolumePose[];
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
export function volumeField(sources: readonly VolumeShape[], targets: readonly VolumeShape[]) {
  if (!sources.length || !targets.length)
    throw new Error('Volume morph needs visible sources and targets');
  const count = sources.length,
    shapes = [...sources, ...targets];
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
  const bounds = new Box3(),
    nextBounds = new Box3(),
    localBounds = new Box3();
  const matrix = new Matrix4(),
    position = new Vector3(),
    scale = new Vector3(),
    rotation = new Euler(),
    quaternion = new Quaternion();
  const updatePlanes = contactPlanes(kinds, parameters, count);
  let progress = 0,
    tension = 0,
    planeCount = 0;
  function updatePose(pose: VolumePose = {}, i: number) {
    const p = pose.position ?? [0, 0, 0],
      r = pose.rotation ?? [0, 0, 0],
      s = pose.scale ?? 1;
    const dimensions: VolumePoint = typeof s === 'number' ? [s, s, s] : s;
    finitePoint(dimensions);
    positive(...dimensions);
    finitePoint(p);
    finitePoint(r);
    if (dimensions.some((v) => !Number.isFinite(Math.fround(v)) || Math.fround(v) <= 0))
      throw new Error('Volume scales must fit positive GPU floats');
    matrix.compose(
      position.set(...p),
      quaternion.setFromEuler(rotation.set(...r)),
      scale.set(...dimensions),
    );
    const shape = shapes[i]!;
    const half: VolumePoint =
      shape.kind === 'box'
        ? (shape.size.map((v) => v / 2) as unknown as VolumePoint)
        : shape.kind === 'sphere'
          ? [shape.radius, shape.radius, shape.radius]
          : [shape.length / 2, shape.radius, shape.radius];
    localBounds.set(new Vector3(...half).negate(), new Vector3(...half)).applyMatrix4(matrix);
    nextBounds.union(localBounds);
    matrix.invert();
    nextTransforms.set(matrix.elements, i * 16);
    nextScales[i] = Math.min(...dimensions);
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
    bounds,
    kinds,
    parameters,
    transforms,
    scales,
    planes,
    count,
    targetCount: targets.length,
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
      if (frame.sources.length !== count || frame.targets.length !== targets.length)
        throw new Error('Volume poses must match every source and target shape');
      if (!Number.isFinite(frame.morph) || !Number.isFinite(frame.tension ?? 0.2))
        throw new Error('Volume progress and tension must be finite');
      const nextProgress = Math.fround(Math.max(0, Math.min(1, frame.morph)));
      const nextTension = Math.fround(Math.max(0, frame.tension ?? 0.2) * (1 - nextProgress));
      if (!Number.isFinite(nextTension))
        throw new Error('Volume tension must fit a finite GPU float');
      nextBounds.makeEmpty();
      for (let i = 0; i < count; i++) updatePose(frame.sources[i], i);
      for (let i = 0; i < targets.length; i++) updatePose(frame.targets[i], count + i);
      if (!nextTransforms.every(Number.isFinite))
        throw new Error('Volume transforms must fit finite GPU floats');
      const nextPlaneCount =
        targets.length === 1 ? updatePlanes(nextTransforms, nextTension, nextPlanes) : 0;
      if (!nextPlanes.every(Number.isFinite))
        throw new Error('Volume contact planes must fit finite GPU floats');
      bounds.copy(nextBounds).expandByScalar((nextTension * Math.max(0, count - 1)) / 4 + 0.01);
      transforms.set(nextTransforms);
      scales.set(nextScales);
      planes.set(nextPlanes);
      progress = nextProgress;
      tension = nextTension;
      planeCount = nextPlaneCount;
    },
    distance(x: number, y: number, z: number) {
      let target = primitive(count, x, y, z);
      for (let i = count + 1; i < shapes.length; i++)
        target = Math.min(target, primitive(i, x, y, z));
      if (progress === 1) return target;
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
      return progress === 0 ? d : d * (1 - progress) + target * progress;
    },
  };
}
