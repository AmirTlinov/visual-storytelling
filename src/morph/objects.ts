import {
  volumeBox,
  volumeSphere,
  volumeCapsule,
  volumeField,
  type VolumePoint,
  type VolumeShape,
} from '../viewport/morph/field.js';
import { smooth } from './numbers.js';

/** A written object. Its inscription belongs to its material, in local front-face coordinates. */
export interface MorphObject {
  readonly shape: VolumeShape;
  readonly text?: string | number;
  /** Optional physical unit spacing for measured bodies; moves with the material. */
  readonly grid?: number;
}
export interface MorphBody extends MorphObject {
  readonly position: VolumePoint;
  readonly scale?: VolumePoint;
  /** Related contributions stay together in arithmetic and other semantic operations. */
  readonly origins?: readonly string[];
}
export interface MorphFrame {
  readonly sources: readonly MorphBody[];
  readonly targets: readonly MorphBody[];
  readonly morph: number;
  readonly tension?: number;
}
export interface MorphOperation {
  readonly kind: 'transform' | 'merge' | 'split';
  readonly sources: readonly MorphObject[];
  readonly targets: readonly MorphObject[];
}
export interface MorphPlan {
  readonly bounds: readonly [VolumePoint, VolumePoint];
  sample(progress: number): MorphFrame;
}
export function shapeSize(shape: VolumeShape): VolumePoint {
  return shape.kind === 'box'
    ? shape.size
    : shape.kind === 'sphere'
      ? [shape.radius * 2, shape.radius * 2, shape.radius * 2]
      : [shape.length, shape.radius * 2, shape.radius * 2];
}
export function bodySize(body: MorphBody): VolumePoint {
  return shapeSize(body.shape).map((v, i) => v * (body.scale?.[i] ?? 1)) as unknown as VolumePoint;
}
function row(objects: readonly MorphObject[], gap: number): MorphBody[] {
  const widths = objects.map((o) => shapeSize(o.shape)[0]);
  let x = -(widths.reduce((a, b) => a + b, 0) + gap * (objects.length - 1)) / 2;
  return objects.map((object, i) => {
    const position: VolumePoint = [x + widths[i]! / 2, 0, 0];
    x += widths[i]! + gap;
    return { ...object, position };
  });
}
/** The common approach/contact/resolve choreography; scenes supply no trajectories or fades. */
export function morphPlan(operation: MorphOperation): MorphPlan {
  if (!operation.sources.length || !operation.targets.length)
    throw new Error('A morph needs source and target objects');
  for (const object of [...operation.sources, ...operation.targets]) {
    if (
      object.grid !== undefined &&
      (!(object.grid > 0) ||
        !Number.isFinite(object.grid) ||
        shapeSize(object.shape)
          .slice(0, 2)
          .some((v) => v / object.grid! > 128))
    )
      throw new Error(
        'A measured grid needs a positive finite step and at most 128 lines per axis',
      );
  }
  if (!['transform', 'merge', 'split'].includes(operation.kind))
    throw new Error('Unknown morph operation');
  if (
    operation.kind === 'transform' &&
    (operation.sources.length !== 1 || operation.targets.length !== 1)
  )
    throw new Error('Transform needs one source and one target');
  if (operation.kind === 'merge' && operation.targets.length !== 1)
    throw new Error('Merge needs one result');
  if (operation.kind === 'split' && operation.sources.length !== 1)
    throw new Error('Split needs one source');
  const reverse = operation.kind === 'split';
  const inputs = reverse ? operation.targets : operation.sources;
  const outputs = reverse ? operation.sources : operation.targets;
  const unit = Math.min(...[...inputs, ...outputs].map((o) => Math.min(...shapeSize(o.shape))));
  const apart = row(inputs, unit * 0.7),
    contact = row(inputs, 0),
    result = row(outputs, 0);
  const flat = [...inputs, ...outputs].every((o) => o.shape.kind === 'box');
  const sample = (progress: number): MorphFrame => {
    if (!Number.isFinite(progress)) throw new Error('Morph progress must be finite');
    const p = Math.max(0, Math.min(1, reverse ? 1 - progress : progress));
    const multiple = inputs.length > 1;
    const approach = smooth(p / 0.3);
    const morph = smooth(multiple ? (p - 0.3) / 0.65 : p);
    const sources = apart.map((object, i) => ({
      ...object,
      position: [
        object.position[0] * (1 - approach) + contact[i]!.position[0] * approach,
        0,
        0,
      ] as VolumePoint,
    }));
    return {
      sources,
      targets: result,
      morph,
      tension: multiple ? unit * (flat ? 0.1 : 0.52) * smooth((p - 0.27) / 0.15) : 0,
    };
  };
  // The field validates dimensions and supplies the same conservative bounds as rendering.
  const field = volumeField(
    inputs.map((o) => o.shape),
    outputs.map((o) => o.shape),
  );
  const bounds = field.bounds.clone().makeEmpty();
  for (const p of [0, 1]) {
    const frame = sample(p);
    field.update({
      ...frame,
      morph: 0,
      tension: inputs.length > 1 ? unit * (flat ? 0.1 : 0.52) : 0,
    });
    bounds.union(field.bounds);
  }
  return {
    bounds: [
      bounds.min.toArray() as unknown as VolumePoint,
      bounds.max.toArray() as unknown as VolumePoint,
    ],
    sample,
  };
}
export const Morph = {
  box(size: VolumePoint, text?: string | number): MorphObject {
    return { shape: volumeBox(size), text };
  },
  sphere(radius: number, text?: string | number): MorphObject {
    return { shape: volumeSphere(radius), text };
  },
  capsule(radius: number, length: number, text?: string | number): MorphObject {
    return { shape: volumeCapsule(radius, length), text };
  },
  transform(source: MorphObject, target: MorphObject): MorphOperation {
    return { kind: 'transform', sources: [source], targets: [target] };
  },
  merge(sources: readonly MorphObject[], target: MorphObject): MorphOperation {
    return { kind: 'merge', sources, targets: [target] };
  },
  split(source: MorphObject, targets: readonly MorphObject[]): MorphOperation {
    return { kind: 'split', sources: [source], targets };
  },
  plan: morphPlan,
};
