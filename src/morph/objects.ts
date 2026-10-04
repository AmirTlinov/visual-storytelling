import {
  volumeBox,
  volumeSphere,
  volumeCapsule,
  volumeField,
  type VolumePoint,
  type VolumeShape,
  type VolumeFrame,
} from '../viewport/morph/field.js';
import { registeredEnvelope } from '../viewport/morph/registration.js';
import { contactRetention } from '../viewport/morph/contact-rounding.js';
import { smooth } from './numbers.js';
import { materialMotion } from './material.js';

/** A written object. Its inscription belongs to its material, in local front-face coordinates. */
export interface MorphObject {
  readonly shape: VolumeShape;
  readonly text?: string | number;
  /** Optional physical unit spacing for measured bodies; moves with the material. */
  readonly grid?: number;
}
export interface MorphBody extends MorphObject {
  readonly material?: string;
  readonly position: VolumePoint;
  readonly scale?: VolumePoint;
  /** Material curvature during contact; the operation supplies this automatically. */
  readonly rounding?: number;
  /** Related contributions stay together in arithmetic and other semantic operations. */
  readonly origins?: readonly string[];
}
export interface MorphFrame {
  readonly sources: readonly MorphBody[];
  readonly targets: readonly MorphBody[];
  readonly morph: number;
  readonly tension?: number;
  readonly materials?: VolumeFrame['materials'];
}
export interface MorphOperation {
  readonly kind: 'transform' | 'merge' | 'split';
  readonly sources: readonly MorphObject[];
  readonly targets: readonly MorphObject[];
}
export interface MorphPlan {
  readonly completeAt: number;
  readonly bounds: readonly [VolumePoint, VolumePoint];
  sample(progress: number, duration?: number): MorphFrame;
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
function packed(objects: readonly MorphObject[], gap: number, columns: number): MorphBody[] {
  const rows = Array.from({ length: Math.ceil(objects.length / columns) }, (_, i) =>
    objects.slice(i * columns, (i + 1) * columns),
  );
  const heights = rows.map((row) => Math.max(...row.map((o) => shapeSize(o.shape)[1])));
  let y = (heights.reduce((a, b) => a + b, 0) + gap * (rows.length - 1)) / 2;
  return rows.flatMap((row, r) => {
    const widths = row.map((o) => shapeSize(o.shape)[0]);
    let x = -(widths.reduce((a, b) => a + b, 0) + gap * (row.length - 1)) / 2;
    const result = row.map((object, i) => {
      const position: VolumePoint = [x + widths[i]! / 2, y - heights[r]! / 2, 0];
      x += widths[i]! + gap;
      return { ...object, position };
    });
    y -= heights[r]! + gap;
    return result;
  });
}
function envelope(bodies: readonly MorphBody[]) {
  return [0, 1, 2].map(
    (axis) =>
      Math.max(...bodies.map((body) => body.position[axis]! + shapeSize(body.shape)[axis]! / 2)) -
      Math.min(...bodies.map((body) => body.position[axis]! - shapeSize(body.shape)[axis]! / 2)),
  );
}
/** The common approach/contact/resolve choreography; scenes supply no trajectories or fades. */
export function morphPlan(
  operation: MorphOperation,
  options: { columns?: number } = {},
): MorphPlan {
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
  const columns = options.columns ?? inputs.length;
  if (!Number.isInteger(columns) || columns < 1)
    throw new Error('Material columns must be a positive integer');
  const unit = Math.min(...[...inputs, ...outputs].map((o) => Math.min(...shapeSize(o.shape))));
  const apart = packed(inputs, unit * 0.7, columns),
    contact = packed(inputs, 0, columns),
    result = packed(outputs, 0, columns);
  const source = envelope(contact),
    apartSize = envelope(apart);
  const whole = outputs[0]!.shape;
  const target = shapeSize(whole);
  const curvature = whole.kind === 'box' ? whole.rounding / (Math.min(...whole.size) / 2) : 1;
  const contactAt = 0.32;
  const sampleShape = (progress: number): MorphFrame => {
    if (!Number.isFinite(progress)) throw new Error('Morph progress must be finite');
    const p = Math.max(0, Math.min(1, reverse ? 1 - progress : progress));
    const multiple = inputs.length > 1;
    // An approaching body has no material connection yet. Separation carries
    // the connection it started with until its neck actually breaks.
    const arriving = Math.min(1, p / contactAt);
    const approach = reverse ? smooth(p / 0.55) : arriving * arriving * (2 - arriving);
    const morph = smooth(
      multiple ? (p - (reverse ? 0.3 : contactAt)) / (reverse ? 0.65 : 0.63) : p,
    );
    const tension = multiple
      ? unit * 0.52 * smooth((p - (reverse ? 0.12 : contactAt)) / (reverse ? 0.18 : 0.16))
      : 0;
    const gap = unit * 0.7 * (1 - approach);
    // Contact uses the same conservative distance scale as the registered field.
    const scale = Math.min(
      ...source.map(
        (size, axis) =>
          1 - morph + (morph * target[axis]!) / (size + (apartSize[axis]! - size) * (1 - approach)),
      ),
    );
    const retained =
      reverse && multiple ? contactRetention(gap * scale, tension * (1 - morph)) : morph;
    const sources = apart.map((object, i) => ({
      ...object,
      ...(object.shape.kind === 'box'
        ? {
            rounding:
              object.shape.rounding +
              ((reverse
                ? Math.max(object.shape.rounding, (Math.min(...object.shape.size) / 2) * curvature)
                : (Math.min(...object.shape.size) / 2) * curvature) -
                object.shape.rounding) *
                retained,
          }
        : {}),
      position: object.position.map(
        (v, axis) => v * (1 - approach) + contact[i]!.position[axis]! * approach,
      ) as unknown as VolumePoint,
    }));
    return {
      sources,
      targets: result,
      morph,
      tension,
    };
  };
  // Validate against the renderer, then reserve an analytic envelope for all time.
  const field = volumeField(
    inputs.map((o) => o.shape),
    outputs.map((o) => o.shape),
  );
  field.update(sampleShape(0));
  let motion: ReturnType<typeof materialMotion> | undefined,
    motionDuration = NaN;
  const sample = (progress: number, duration = 4): MorphFrame => {
    if (!Number.isFinite(duration) || duration < 0)
      throw new Error('Morph duration must be finite and non-negative');
    if (!Number.isFinite(progress)) throw new Error('Morph progress must be finite');
    if (progress <= 0 || progress >= 1) return sampleShape(progress);
    if (!motion || duration !== motionDuration) {
      motion = materialMotion(sampleShape, duration);
      motionDuration = duration;
    }
    return motion(progress);
  };
  const minRatio = Math.min(...apartSize.map((size, axis) => target[axis]! / size));
  const allowance = ((inputs.length - 1) * unit * 0.52) / 4;
  const half = source.map((size, axis) => {
    const extent = registeredEnvelope(
      apartSize[axis]! / 2,
      target[axis]! / 2,
      target[axis]! / size,
      minRatio,
      allowance,
    );
    // Include the bounded material response, then round GPU floats outward.
    return extent * 1.05 + 0.01 + 8 * 2 ** -23 * Math.max(1, extent);
  });
  return {
    completeAt: operation.kind === 'merge' && inputs.length > 1 ? 0.95 : 1,
    bounds: [half.map((value) => -value) as unknown as VolumePoint, half as unknown as VolumePoint],
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
