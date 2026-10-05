import { Box3, Matrix4, Quaternion, Vector3, type Mesh, type Object3D } from 'three';
import type { MathMorphFrame, MorphPoint } from './types.js';

export interface MathDelivery3DOptions {
  /** The future result. Delivery owns its visibility until disposed. */
  to: Object3D;
  /** Bounds in the receiver's local coordinates; otherwise measured from its geometry. */
  bounds?: Box3;
  /** Optional control point in world coordinates. */
  via?: MorphPoint;
}

const receivers = new WeakSet<Object3D>();
const sizeOf = (bounds: Box3) => bounds.getSize(new Vector3());
function validBounds(bounds: Box3) {
  return (
    !bounds.isEmpty() &&
    [...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite) &&
    sizeOf(bounds)
      .toArray()
      .every((size) => Number.isFinite(size) && size > 0)
  );
}
function receiverBounds({ to, bounds }: MathDelivery3DOptions) {
  if (bounds) return bounds.clone();
  const result = new Box3();
  // A mesh's attached label or outline must not inflate the receiving cell.
  const geometry = (to as Mesh).geometry;
  if (geometry) {
    geometry.computeBoundingBox();
    return geometry.boundingBox!.clone();
  }
  to.updateWorldMatrix(true, true);
  const inverse = to.matrixWorld.clone().invert();
  to.traverse((child) => {
    const geometry = (child as Mesh).geometry;
    if (!geometry) return;
    geometry.computeBoundingBox();
    result.union(
      geometry
        .boundingBox!.clone()
        .applyMatrix4(new Matrix4().multiplyMatrices(inverse, child.matrixWorld)),
    );
  });
  return result;
}
function validateReceiver(options: MathDelivery3DOptions, current?: Object3D) {
  const { to } = options;
  if (!to?.isObject3D) throw new Error('Math delivery needs a receiving Object3D');
  if (to !== current && receivers.has(to))
    throw new Error('A result receiver already has a MathMorph delivery owner');
  if (options.via && (options.via.length !== 3 || !options.via.every(Number.isFinite)))
    throw new Error('Math delivery control point must contain three finite world coordinates');
  if (!validBounds(receiverBounds(options)))
    throw new Error('Math delivery needs non-empty three-dimensional receiver bounds');
}
function partBounds(frame: MathMorphFrame) {
  const result = new Box3();
  for (const part of frame.targets) {
    result.union(
      new Box3().setFromCenterAndSize(
        new Vector3(...part.position),
        new Vector3(...part.size).multiply(new Vector3(...(part.scale ?? [1, 1, 1]))),
      ),
    );
  }
  return result;
}

// QR separates a proper rotation from triangular stretch/shear. Unlike
// decompose() on a sheared matrix, its diagonal retains each axis's orientation
// during interpolation, so positive scales cannot turn inside out in flight.
function basis(matrix: Matrix4) {
  const x = new Vector3().setFromMatrixColumn(matrix, 0).normalize();
  const y = new Vector3().setFromMatrixColumn(matrix, 1);
  y.addScaledVector(x, -x.dot(y)).normalize();
  const orthogonal = new Matrix4().makeBasis(x, y, new Vector3().crossVectors(x, y));
  const rotation = new Quaternion().setFromRotationMatrix(orthogonal).normalize();
  const stretch = orthogonal.transpose().multiply(matrix);
  stretch.setPosition(0, 0, 0);
  return { rotation, stretch };
}

function orientation(matrix: Matrix4) {
  const determinant = matrix.determinant();
  if (!matrix.elements.every(Number.isFinite) || !Number.isFinite(determinant) || determinant === 0)
    throw new Error(
      'Math delivery cannot use a collapsed or non-finite source or receiver transform',
    );
  return Math.sign(determinant);
}

function rootOf(object: Object3D) {
  while (object.parent) object = object.parent;
  return object;
}

/** Pose and handoff only. MathMorph and Story remain the computation and time owners. */
export function mathDelivery3D(source: Object3D, options: MathDelivery3DOptions) {
  validateReceiver(options);
  let { to } = options;
  if (source.matrixAutoUpdate) source.updateMatrix();
  const originalMatrix = source.matrix.clone(),
    originalAutoUpdate = source.matrixAutoUpdate,
    originalSourceVisible = source.visible;
  let originalReceiverVisible = to.visible;
  let disposed = false;
  receivers.add(to);
  function resetSource() {
    source.matrix.copy(originalMatrix);
    source.matrixAutoUpdate = originalAutoUpdate;
    source.matrixWorldNeedsUpdate = true;
    source.visible = originalSourceVisible;
  }
  return {
    /** Reuse one calculation across receiving addresses; the released address keeps its last state. */
    setOptions(next: MathDelivery3DOptions) {
      if (disposed) throw new Error('Math delivery has been disposed');
      validateReceiver(next, to);
      if (next.to !== to) {
        receivers.delete(to);
        to = next.to;
        originalReceiverVisible = to.visible;
        receivers.add(to);
        resetSource();
      }
      options = next;
    },
    render(frame: MathMorphFrame, stages: number, progress: number, reduced = false) {
      if (disposed) throw new Error('Math delivery has been disposed');
      if (!Number.isFinite(progress) || progress < 0 || progress > 1)
        throw new Error('Math delivery progress must be between zero and one');
      if (progress > 0 && (frame.phase !== 'hold' || frame.stage !== stages - 1))
        throw new Error('Math delivery must start after the final calculation has settled');
      const travel = reduced ? Number(progress === 1) : progress;
      const local = originalMatrix.clone();
      let deliveredBounds: Box3 | undefined;
      if (progress > 0) {
        if (rootOf(source) !== rootOf(to))
          throw new Error('Math delivery source and receiver must belong to the same scene');
        for (let node: Object3D | null = to; node; node = node.parent)
          if (node === source || node === source.parent)
            throw new Error('Math delivery receiver must be outside the calculation');
        for (let node: Object3D | null = source; node; node = node.parent)
          if (node === to) throw new Error('Math delivery receiver cannot contain the calculation');
        const fromBounds = partBounds(frame),
          targetBounds = receiverBounds(options);
        if (!validBounds(fromBounds) || !validBounds(targetBounds))
          throw new Error(
            'Math delivery needs non-empty three-dimensional result and receiver bounds',
          );
        source.parent!.updateWorldMatrix(true, false);
        to.updateWorldMatrix(true, false);
        const parent = source.parent!.matrixWorld;
        const from = new Matrix4().multiplyMatrices(parent, originalMatrix);
        orientation(parent);
        if (orientation(from) !== orientation(to.matrixWorld))
          throw new Error('Math delivery cannot change source and receiver handedness');
        const targetScale = sizeOf(targetBounds).divide(sizeOf(fromBounds));
        const target = to.matrixWorld
          .clone()
          .multiply(new Matrix4().makeScale(...targetScale.toArray()));
        orientation(target);
        const a = basis(from),
          b = basis(target);
        const p = travel * travel * (3 - 2 * travel);
        const stretch = a.stretch.clone();
        for (let i = 0; i < 16; i++)
          stretch.elements[i] =
            stretch.elements[i]! + (b.stretch.elements[i]! - stretch.elements[i]!) * p;
        const pose = new Matrix4()
          .makeRotationFromQuaternion(a.rotation.slerp(b.rotation, p))
          .multiply(stretch);
        const origin = fromBounds.getCenter(new Vector3()).applyMatrix4(from);
        const end = targetBounds.getCenter(new Vector3()).applyMatrix4(to.matrixWorld);
        const centre = options.via
          ? origin
              .multiplyScalar((1 - p) ** 2)
              .addScaledVector(new Vector3(...options.via), 2 * (1 - p) * p)
              .addScaledVector(end, p * p)
          : origin.lerp(end, p);
        pose
          .setPosition(centre)
          .multiply(
            new Matrix4().makeTranslation(
              ...fromBounds.getCenter(new Vector3()).negate().toArray(),
            ),
          );
        local.copy(parent).invert().multiply(pose);
        deliveredBounds = fromBounds.applyMatrix4(local);
      }
      source.matrixAutoUpdate = false;
      source.matrix.copy(local);
      source.matrixWorldNeedsUpdate = true;
      source.visible = travel < 1;
      to.visible = travel === 1;
      return deliveredBounds;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      resetSource();
      to.visible = originalReceiverVisible;
      receivers.delete(to);
    },
  };
}
