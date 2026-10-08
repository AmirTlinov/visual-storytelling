import { tensorOriginId, type TensorData } from '../math/tensor.js';
import type { MathOrigin } from './types.js';

/** The operand address stays local; tensor provenance retains its original address. */
export function mathOrigins(
  values: readonly number[],
  operand: number,
  tensor?: TensorData,
): MathOrigin[] {
  return values.map((value, index) => ({
    operand,
    index,
    value,
    ...(tensor ? { source: tensor.origin(index) } : {}),
  }));
}

/** Tensor identities and unlabelled operand slots occupy separate namespaces. */
export function mathOriginKey(origin: MathOrigin): string {
  return origin.source
    ? `tensor:${tensorOriginId(origin.source)}`
    : `${origin.operand}:${origin.index}`;
}
