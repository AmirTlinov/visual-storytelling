import type { VolumeShape, VolumePoint } from '../viewport/morph/field.js';
import type { MorphBody } from './objects.js';

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
