import {
  divisionProgress,
  divisionItemId,
  divisionGroupId,
  type DivisionState,
} from '../math/division.js';
import { quantityPart, transferQuantities, type QuantityPart } from '../math/quantity-parts.js';
import { rational } from '../math/rational.js';
import { DIVISION_MAX_COUNT } from './division-capacity.js';
/** The bounded drawing groups the original measured objects; no new object is created. */
export function divisionParts(state: DivisionState, progress: number): readonly QuantityPart[] {
  if (state.count > DIVISION_MAX_COUNT)
    throw new Error('Materialize only the bounded individual-object drawing.');
  const moment = divisionProgress(state, progress);
  let parts: readonly QuantityPart[] = Array.from({ length: state.count }, (_, index) =>
    quantityPart(divisionItemId(state, index), rational(1), 'предмет', `${state.id}:ungrouped`),
  );
  const placements = Object.fromEntries(
    parts
      .slice(0, moment.completedGroups * state.divisor)
      .map((part, index) => [part.id, divisionGroupId(state, Math.floor(index / state.divisor))]),
  );
  parts = transferQuantities(parts, placements);
  return parts;
}
