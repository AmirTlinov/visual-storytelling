import { Box3, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { contactPlanes } from './contact-planes.js';
import { contactRounding } from './contact-rounding.js';
import { materialGroups, registerBounds } from './registration.js';

export type VolumePoint = readonly [number, number, number];
export type VolumeShape =
  | { readonly kind: 'box'; readonly size: VolumePoint; readonly rounding: number }
  | { readonly kind: 'sphere'; readonly radius: number }
  | { readonly kind: 'capsule'; readonly radius: number; readonly length: number };
export interface VolumePose {
  material?: string;
  position?: VolumePoint;
  /** Euler angles in radians, applied in XYZ order. */
  rotation?: VolumePoint;
  /** Positive uniform or per-axis scale. */
  scale?: number | VolumePoint;
  /** Local box radius while its material relaxes; preserves the outer dimensions. */
  rounding?: number;
}
export interface VolumeFrame {
  sources: readonly VolumePose[];
  targets: readonly VolumePose[];
  morph: number;
  /** Contact blend width in scene units; zero disables the contact blend. */
  tension?: number;
  /** Independent operations share the renderer, while each material retains its own clock. */
  materials?: Readonly<Record<string, { morph: number; tension?: number }>>;
}
export function materialState(
  frame: Pick<VolumeFrame, 'morph' | 'tension' | 'materials'>,
  id?: string,
) {
  const state = (id && frame.materials?.[id]) || frame;
  if (!Number.isFinite(state.morph) || !Number.isFinite(state.tension ?? 0.2))
    throw new Error('Volume progress and tension must be finite');
  const morph = Math.fround(Math.max(0, Math.min(1, state.morph)));
  const tension = Math.fround(Math.max(0, state.tension ?? 0.2) * (1 - morph));
  if (!Number.isFinite(tension)) throw new Error('Volume tension must fit a finite GPU float');
  return { morph, tension };
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
    targetCount = targets.length,
    shapes = [...sources, ...targets];
  const kinds = new Int32Array(shapes.length),
    parameters = new Float32Array(shapes.length * 4);
  const transforms = new Float32Array(shapes.length * 16),
    scales = new Float32Array(shapes.length);
  const nextTransforms = new Float32Array(transforms.length),
    nextScales = new Float32Array(scales.length);
  const capacity = Math.min(count, targetCount);
  const planes = new Float32Array(24 * capacity),
    nextPlanes = new Float32Array(planes.length);
  const contactRadii = new Float32Array(count * 18),
    nextContactRadii = contactRadii.slice();
  const groups = new Int32Array(shapes.length),
    nextGroups = groups.slice();
  const blends = new Float32Array(capacity * 2),
    nextBlends = blends.slice();
  const planeCounts = new Int32Array(capacity),
    nextPlaneCounts = planeCounts.slice();
  const sourceDistances = new Float64Array(capacity),
    targetDistances = sourceDistances.slice();
  const registration = new Float64Array(shapes.flatMap(() => [1, 1, 1, 0, 0, 0])),
    nextRegistration = registration.slice();
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
  const nextParameters = parameters.slice();
  const bounds = new Box3(),
    nextBounds = new Box3(),
    localBounds = new Box3(),
    fromBounds = new Box3(),
    toBounds = new Box3();
  const materialBounds = shapes.map(() => new Box3());
  const worldTransforms = new Float64Array(shapes.length * 16),
    pairRegistration = new Float64Array(12);
  const halfSizes = shapes.map(
    (shape) =>
      new Vector3(
        ...(shape.kind === 'box'
          ? shape.size.map((v) => v / 2)
          : shape.kind === 'sphere'
            ? [shape.radius, shape.radius, shape.radius]
            : [shape.length / 2, shape.radius, shape.radius]),
      ),
  );
  const restRadii = shapes.map((shape) => (shape.kind === 'box' ? shape.rounding : 0));
  const matrix = new Matrix4(),
    registrationMatrix = new Matrix4(),
    basis = new Matrix4(),
    inverseBasis = new Matrix4(),
    localMatrix = new Matrix4(),
    expansion = new Vector3(),
    position = new Vector3(),
    scale = new Vector3(),
    rotation = new Euler(),
    quaternion = new Quaternion();
  const updatePlanes = contactPlanes(kinds, nextParameters);
  const updateRounding = contactRounding(kinds, nextParameters);
  let groupCount = 1;
  function shapeBounds(i: number, transform: Matrix4) {
    const half = halfSizes[i]!;
    return localBounds.set(expansion.copy(half).negate(), half).applyMatrix4(transform);
  }
  function updatePose(pose: VolumePose = {}, i: number) {
    if (kinds[i] === 0) {
      const rounding = pose.rounding ?? restRadii[i]!;
      const half = halfSizes[i]!;
      if (!Number.isFinite(rounding) || rounding < 0 || rounding > Math.min(half.x, half.y, half.z))
        throw new Error('Rounding must fit inside the box');
      const at = i * 4;
      for (let axis = 0; axis < 3; axis++)
        nextParameters[at + axis] = half.getComponent(axis) - rounding;
      nextParameters[at + 3] = rounding;
      if (
        !nextParameters.subarray(at, at + 4).every(Number.isFinite) ||
        [0, 1, 2].some((axis) => nextParameters[at + axis]! + nextParameters[at + 3]! <= 0)
      )
        throw new Error('Volume dimensions must fit positive GPU floats');
    } else if (pose.rounding !== undefined) {
      throw new Error('Only box poses accept a corner radius');
    }
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
    worldTransforms.set(matrix.elements, i * 16);
    materialBounds[i]!.copy(shapeBounds(i, matrix));
    nextBounds.union(materialBounds[i]!);
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
      if (i < count) {
        for (let face = 0; face < 6; face++) {
          const at = i * 18 + face * 3;
          const r = contactRadii[at]!;
          if (r === 0) continue;
          const axis = Math.floor(face / 2),
            sign = face % 2 ? 1 : -1;
          const p = axis === 0 ? px : axis === 1 ? py : pz;
          const cap = sign * p - parameters[a + axis]! - parameters[a + 3]!;
          for (let side = 1; side <= 2; side++) {
            const transverse = (axis + side) % 3;
            const q = transverse === 0 ? qx : transverse === 1 ? qy : qz;
            const rest = ((q - parameters[a + 3]!) * r) / contactRadii[at + side]!;
            d = Math.max(
              d,
              Math.min(-r, Math.max(cap, rest)) +
                Math.hypot(Math.max(cap + r, 0), Math.max(rest + r, 0)),
            );
          }
        }
      }
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
    contactRadii,
    groups,
    blends,
    planeCounts,
    registration,
    count,
    targetCount,
    get groupCount() {
      return groupCount;
    },
    update(frame: VolumeFrame) {
      if (frame.sources.length !== count || frame.targets.length !== targetCount)
        throw new Error('Volume poses must match every source and target shape');
      materialState(frame);
      nextBounds.makeEmpty();
      for (let i = 0; i < count; i++) updatePose(frame.sources[i], i);
      for (let i = 0; i < targetCount; i++) updatePose(frame.targets[i], count + i);
      const materials = materialGroups(
        materialBounds,
        count,
        [...frame.sources, ...frame.targets].map((p) => p.material),
      );
      nextPlanes.fill(0);
      nextPlaneCounts.fill(0);
      nextContactRadii.fill(0);
      for (const [group, material] of materials.entries()) {
        const { morph: nextProgress, tension: nextTension } = materialState(
          frame,
          frame.sources[material.sources[0]!]!.material,
        );
        nextBlends.set([nextProgress, nextTension], group * 2);
        const orientation = frame.sources[material.sources[0]!]?.rotation ?? [0, 0, 0];
        basis.makeRotationFromEuler(rotation.set(...orientation));
        inverseBasis.copy(basis).invert();
        fromBounds.makeEmpty();
        toBounds.makeEmpty();
        const indices = [...material.sources, ...material.targets];
        for (const i of indices) {
          localMatrix.multiplyMatrices(inverseBasis, matrix.fromArray(worldTransforms, i * 16));
          (i < count ? fromBounds : toBounds).union(shapeBounds(i, localMatrix));
        }
        registerBounds(fromBounds, toBounds, nextProgress, pairRegistration);
        // Displacement and size use the group's own axes. Contour blending then
        // preserves a packed rectangular union, without fixed-space diagonal facets.
        for (const i of indices) {
          nextGroups[i] = group;
          const at = i < count ? 0 : 6;
          nextRegistration.set(pairRegistration.subarray(at, at + 6), i * 6);
          const sx = pairRegistration[at]!,
            sy = pairRegistration[at + 1]!,
            sz = pairRegistration[at + 2]!;
          if (nextProgress !== Number(i >= count)) {
            registrationMatrix.set(
              1 / sx,
              0,
              0,
              -pairRegistration[at + 3]! / sx,
              0,
              1 / sy,
              0,
              -pairRegistration[at + 4]! / sy,
              0,
              0,
              1 / sz,
              -pairRegistration[at + 5]! / sz,
              0,
              0,
              0,
              1,
            );
            registrationMatrix.premultiply(basis).multiply(inverseBasis);
            matrix.fromArray(nextTransforms, i * 16).multiply(registrationMatrix);
            nextTransforms.set(matrix.elements, i * 16);
            nextScales[i]! *= Math.min(sx, sy, sz);
          }
          matrix.fromArray(nextTransforms, i * 16).invert();
          shapeBounds(i, matrix);
          // Conservative SDF scaling also scales contact reach. Bound that reach
          // through the complete affine transform, including anisotropy and shear.
          const allowance =
            i < count ? (nextTension * (material.sources.length - 1)) / (4 * nextScales[i]!) : 0;
          const e = matrix.elements;
          localBounds.expandByVector(
            expansion
              .set(
                Math.hypot(e[0]!, e[4]!, e[8]!),
                Math.hypot(e[1]!, e[5]!, e[9]!),
                Math.hypot(e[2]!, e[6]!, e[10]!),
              )
              .multiplyScalar(allowance),
          );
          nextBounds.union(localBounds);
        }
        updateRounding(nextTransforms, nextScales, nextTension, material.sources, nextContactRadii);
        nextPlaneCounts[group] = updatePlanes(
          nextTransforms,
          nextTension,
          nextPlanes,
          material.sources,
          group * 24,
        );
      }
      if (!nextTransforms.every(Number.isFinite))
        throw new Error('Volume transforms must fit finite GPU floats');
      if (
        !nextScales.every((n) => Number.isFinite(n) && n > 0) ||
        !nextRegistration.every(Number.isFinite)
      )
        throw new Error('Registered volume scales must fit positive GPU floats');
      if (!nextPlanes.every(Number.isFinite))
        throw new Error('Volume contact planes must fit finite GPU floats');
      if (!nextContactRadii.every(Number.isFinite))
        throw new Error('Volume contact radii must fit finite GPU floats');
      if (![...nextBounds.min.toArray(), ...nextBounds.max.toArray()].every(Number.isFinite))
        throw new Error('Registered volume bounds must be finite');
      bounds.copy(nextBounds).expandByScalar(0.01);
      parameters.set(nextParameters);
      transforms.set(nextTransforms);
      scales.set(nextScales);
      planes.set(nextPlanes);
      contactRadii.set(nextContactRadii);
      groups.set(nextGroups);
      blends.set(nextBlends);
      planeCounts.set(nextPlaneCounts);
      registration.set(nextRegistration);
      groupCount = materials.length;
    },
    distance(x: number, y: number, z: number) {
      sourceDistances.fill(Infinity, 0, groupCount);
      targetDistances.fill(Infinity, 0, groupCount);
      let union = Infinity;
      for (let i = count; i < shapes.length; i++) {
        const group = groups[i]!;
        const next = primitive(i, x, y, z);
        targetDistances[group] = Math.min(targetDistances[group]!, next);
      }
      for (let i = 0; i < count; i++) {
        const group = groups[i]!,
          d = sourceDistances[group]!,
          tension = blends[group * 2 + 1]!;
        if (blends[group * 2] === 1) continue;
        const next = primitive(i, x, y, z),
          h = tension ? Math.max(0, tension - Math.abs(d - next)) / tension : 0;
        sourceDistances[group] = Math.min(d, next) - h * h * tension * 0.25;
      }
      union = Infinity;
      for (let group = 0; group < groupCount; group++) {
        const progress = blends[group * 2]!;
        if (progress === 1) {
          union = Math.min(union, targetDistances[group]!);
          continue;
        }
        let d = sourceDistances[group]!;
        for (let i = 0; i < planeCounts[group]!; i++) {
          const at = group * 24 + i * 4;
          d = Math.max(
            d,
            planes[at]! * x + planes[at + 1]! * y + planes[at + 2]! * z + planes[at + 3]!,
          );
        }
        union = Math.min(
          union,
          progress === 0 ? d : d * (1 - progress) + targetDistances[group]! * progress,
        );
      }
      return union;
    },
  };
}
