import {
  rationalValue,
  sumRational,
  divideRational,
  equalRational,
  type Rational,
} from './rational.js';
export interface QuantityOrigin {
  readonly id: string;
  readonly amount: Rational;
}
export interface QuantityPart {
  readonly id: string;
  readonly amount: Rational;
  readonly unit: string;
  /** Fractions of different wholes do not share a calibration. */
  readonly reference: string;
  readonly container: string;
  readonly inputs: readonly string[];
  readonly origins: readonly QuantityOrigin[];
  readonly copiedFrom?: string;
}
const identity = (value: string) => {
  if (typeof value !== 'string' || !value.trim())
    throw new Error('Quantity identity, unit and container must be nonempty.');
  return value;
};
function newIdentity(parts: readonly QuantityPart[], id: string) {
  identity(id);
  if (
    parts.some(
      (part) =>
        part.id === id ||
        part.inputs.includes(id) ||
        part.origins.some((origin) => origin.id === id) ||
        part.copiedFrom === id,
    )
  )
    throw new Error(
      'A new measured part needs a distinct identity from known material and provenance.',
    );
  return id;
}
export function quantityPart(
  id: string,
  amount: Rational,
  unit: string,
  container: string,
  { reference = unit }: { reference?: string } = {},
): QuantityPart {
  amount = rationalValue(amount);
  if (amount.numerator < 0) throw new Error('A measured part cannot have negative magnitude.');
  return Object.freeze({
    id: identity(id),
    amount,
    unit: identity(unit),
    reference: identity(reference),
    container: identity(container),
    inputs: Object.freeze([]),
    origins: Object.freeze([Object.freeze({ id, amount })]),
  });
}
export function quantityParts(parts: readonly QuantityPart[]): readonly QuantityPart[] {
  const ids = new Set<string>();
  for (const part of parts) {
    identity(part.id);
    identity(part.unit);
    identity(part.reference);
    identity(part.container);
    if (ids.has(part.id)) throw new Error('Measured parts need distinct stable IDs.');
    ids.add(part.id);
    const amount = rationalValue(part.amount);
    if (amount.numerator < 0 || !Array.isArray(part.origins) || !Array.isArray(part.inputs))
      throw new Error('Invalid measured part.');
    part.inputs.forEach(identity);
    if (part.inputs.includes(part.id))
      throw new Error('A computed part needs a distinct identity from its inputs.');
    if (part.copiedFrom !== undefined) identity(part.copiedFrom);
    if (
      new Set(part.inputs).size !== part.inputs.length ||
      new Set(part.origins.map((origin) => origin.id)).size !== part.origins.length
    )
      throw new Error('Quantity inputs and origin contributions need distinct identities.');
    for (const origin of part.origins) {
      identity(origin.id);
      const contribution = rationalValue(origin.amount);
      if (contribution.numerator < 0) throw new Error('Origin contribution cannot be negative.');
    }
    const originTotal = sumRational(part.origins.map((origin) => origin.amount));
    if (!equalRational(amount, originTotal))
      throw new Error('Origin contributions must account for the entire measured part.');
  }
  return Object.freeze(
    parts.map((part) =>
      Object.freeze({
        ...part,
        amount: rationalValue(part.amount),
        inputs: Object.freeze([...part.inputs]),
        origins: Object.freeze(
          part.origins.map((origin) =>
            Object.freeze({ ...origin, amount: rationalValue(origin.amount) }),
          ),
        ),
      }),
    ),
  );
}
export function quantityTotal(parts: readonly QuantityPart[], unit: string): Rational {
  const reference = parts[0]?.reference;
  return sumRational(
    quantityParts(parts).map((part) => {
      if (part.unit !== unit || part.reference !== reference)
        throw new Error('Cannot add different measurement units or reference wholes.');
      return part.amount;
    }),
  );
}
export function splitQuantity(
  parts: readonly QuantityPart[],
  id: string,
  count: number,
): readonly QuantityPart[] {
  parts = quantityParts(parts);
  const original = parts.find((part) => part.id === id);
  if (!original) throw new Error(`Unknown measured part: ${id}`);
  if (original.origins.filter((origin) => origin.amount.numerator !== 0).length > 1)
    throw new Error(
      'Split original constituent fragments; a composite does not define their spatial allocation.',
    );
  if (
    !Number.isSafeInteger(count) ||
    count < 0 ||
    count > 4096 ||
    (count === 0 && original.amount.numerator !== 0)
  )
    throw new Error('A split needs bounded equal parts; only zero can become no parts.');
  const children = Array.from({ length: count }, (_, index) => ({
    ...original,
    id: newIdentity(parts, `${id}:part:${index}`),
    amount: divideRational(original.amount, count),
    inputs: [id],
    origins: original.origins.map((origin) => ({
      ...origin,
      amount: divideRational(origin.amount, count),
    })),
  }));
  return quantityParts(parts.flatMap((part) => (part.id === id ? children : [part])));
}
/** One atomic rearrangement preserves every identity and amount. */
export function transferQuantities(
  parts: readonly QuantityPart[],
  placements: Readonly<Record<string, string>>,
): readonly QuantityPart[] {
  parts = quantityParts(parts);
  for (const [id, container] of Object.entries(placements)) {
    identity(container);
    if (!parts.some((part) => part.id === id)) throw new Error(`Unknown measured part: ${id}`);
  }
  return quantityParts(
    parts.map((part) =>
      Object.hasOwn(placements, part.id) ? { ...part, container: placements[part.id]! } : part,
    ),
  );
}
export function transferQuantity(
  parts: readonly QuantityPart[],
  ids: readonly string[],
  container: string,
): readonly QuantityPart[] {
  if (new Set(ids).size !== ids.length)
    throw new Error('Transfer requires distinct existing parts.');
  identity(container);
  return transferQuantities(parts, Object.fromEntries(ids.map((id) => [id, container])));
}
/** Copies retain their sources and create exactly the sum of the requested amounts. */
export function copyQuantities(
  parts: readonly QuantityPart[],
  copies: readonly { source: string; id: string; container: string }[],
): readonly QuantityPart[] {
  parts = quantityParts(parts);
  const created = copies.map((copy) => {
    const original = parts.find((part) => part.id === copy.source);
    if (!original) throw new Error(`Unknown measured part: ${copy.source}`);
    return {
      ...original,
      id: newIdentity(parts, copy.id),
      container: identity(copy.container),
      inputs: [copy.source],
      copiedFrom: copy.source,
    };
  });
  return quantityParts([...parts, ...created]);
}
export function copyQuantity(
  parts: readonly QuantityPart[],
  id: string,
  copyId: string,
  container: string,
): readonly QuantityPart[] {
  return copyQuantities(parts, [{ source: id, id: copyId, container }]);
}
export function mergeQuantity(
  parts: readonly QuantityPart[],
  ids: readonly string[],
  id: string,
  container: string,
): readonly QuantityPart[] {
  parts = quantityParts(parts);
  const selected = ids.map((id) => parts.find((part) => part.id === id));
  if (!selected.length || new Set(ids).size !== ids.length || selected.some((part) => !part))
    throw new Error('Merge requires distinct existing parts.');
  const chosen = selected as QuantityPart[];
  const unit = chosen[0]!.unit;
  const amount = quantityTotal(chosen, unit);
  const origins = new Map<string, Rational[]>();
  for (const part of chosen)
    for (const origin of part.origins)
      origins.set(origin.id, [...(origins.get(origin.id) ?? []), origin.amount]);
  return quantityParts([
    ...parts.filter((part) => !ids.includes(part.id)),
    {
      id: newIdentity(parts, id),
      amount,
      unit,
      reference: chosen[0]!.reference,
      container: identity(container),
      inputs: [...ids],
      origins: [...origins].map(([id, amounts]) => ({ id, amount: sumRational(amounts) })),
    },
  ]);
}
