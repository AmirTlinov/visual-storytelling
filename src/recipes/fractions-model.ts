import { rational, addRational, commonDenominator, type Rational } from '../math/rational.js';
import {
  quantityPart,
  quantityTotal,
  splitQuantity,
  transferQuantity,
  copyQuantities,
  type QuantityPart,
} from '../math/quantity-parts.js';
import type { ModelValues, StoryModelModule } from '../story/model.js';
export const fractionDenominators = [1, 2, 3, 4, 6, 8, 12] as const;
export interface FractionState {
  readonly roots: readonly QuantityPart[];
  readonly parts: readonly QuantityPart[];
  readonly result: Rational;
  readonly total: Rational;
  readonly added: Rational;
  readonly denominator: number;
  readonly progress: number;
}
export function fractionInputs(value: unknown): ModelValues {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('fractions.inputs: provide two numerators, two denominators and move/copy.');
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) =>
        ![
          'leftNumerator',
          'leftDenominator',
          'rightNumerator',
          'rightDenominator',
          'action',
        ].includes(key),
    )
  )
    throw new Error('Unknown fraction input.');
  const action = input.action ?? 'move';
  if (!['move', 'copy'].includes(action as string))
    throw new Error('Choose moving the pieces or copying the first fraction.');
  const normalized: ModelValues = { action: action as string };
  for (const side of ['left', 'right']) {
    const n = input[`${side}Numerator`],
      d = input[`${side}Denominator`];
    if (
      !Number.isSafeInteger(n) ||
      !fractionDenominators.includes(d as (typeof fractionDenominators)[number]) ||
      Number(n) < 0 ||
      Number(n) > Number(d)
    )
      throw new Error('Draw fractions between zero and one using denominators1,2,3,4,6,8,12.');
    normalized[`${side}Numerator`] = Number(n);
    normalized[`${side}Denominator`] = Number(d);
  }
  return normalized;
}
/** Only active parts contribute to the total; roots retain the measured starting material. */
export function fractionState(
  inputs: ModelValues,
  progress = 2,
  { id = 'fractions' }: { id?: string } = {},
): FractionState {
  inputs = fractionInputs(inputs);
  if (!Number.isFinite(progress) || progress < 0 || progress > 2)
    throw new Error('Fraction progress must lie in[0,2].');
  const denominator = commonDenominator(
    Number(inputs.leftDenominator),
    Number(inputs.rightDenominator),
  );
  const roots = ['left', 'right'].map((side) =>
    quantityPart(
      `${id}:${side}`,
      rational(Number(inputs[`${side}Numerator`]), Number(inputs[`${side}Denominator`])),
      'whole',
      side,
      { reference: 'same-unit-whole' },
    ),
  );
  let parts: readonly QuantityPart[] = roots;
  if (progress > 0)
    for (const side of ['left', 'right'])
      parts = splitQuantity(
        parts,
        `${id}:${side}`,
        (Number(inputs[`${side}Numerator`]) * denominator) / Number(inputs[`${side}Denominator`]),
      );
  if (progress > 1) {
    const ids = parts.map((part) => part.id);
    if (inputs.action === 'move') parts = transferQuantity(parts, ids, 'result');
    else {
      const right = parts
        .filter((part) => part.origins[0]?.id === `${id}:right`)
        .map((part) => part.id);
      parts = transferQuantity(parts, right, 'result');
      parts = copyQuantities(
        parts,
        parts
          .filter((part) => part.origins[0]?.id === `${id}:left`)
          .map((part) => ({ source: part.id, id: `${part.id}:copy`, container: 'result' })),
      );
    }
  }
  const result = addRational(roots[0]!.amount, roots[1]!.amount);
  return Object.freeze({
    roots: Object.freeze(roots),
    parts,
    result,
    total: quantityTotal(parts, 'whole'),
    added: progress > 1 && inputs.action === 'copy' ? roots[0]!.amount : rational(0),
    denominator,
    progress,
  });
}
const inputKeys = [
  'leftNumerator',
  'leftDenominator',
  'rightNumerator',
  'rightDenominator',
  'action',
];
const state = (values: ModelValues, progress: number, id?: string) => {
  const inputs = fractionInputs(Object.fromEntries(inputKeys.map((key) => [key, values[key]])));
  return { ...inputs, ...fractionState(inputs, progress, { id }) };
};
export const fractionsModel: StoryModelModule = {
  validateInputs: fractionInputs,
  state: (inputs, model) => state(inputs, 0, model?.id),
  staticState: (inputs, model) => state(inputs, 2, model?.id),
  experimentState: (inputs, authored, model) => state(inputs, Number(authored.progress), model?.id),
  operations: {
    align: (previous, _p, model) => state(previous as ModelValues, 0, model?.id),
    partition: (previous, p, model) => state(previous as ModelValues, p, model?.id),
    collect: (previous, p, model) => state(previous as ModelValues, 1 + p, model?.id),
    finish: (previous, _p, model) => state(previous as ModelValues, 2, model?.id),
  },
  validateViews(views) {
    if (
      views.length < 1 ||
      views.length > 2 ||
      !views.some((view) => view.kind === 'fraction-parts') ||
      views.some((view) => !['fraction-parts', 'fraction-equation'].includes(view.kind)) ||
      new Set(views.map((view) => view.kind)).size !== views.length
    )
      throw new Error('Fractions require parts and optionally one equation view.');
  },
  validateSequence(operations) {
    let partitioned = false;
    let collected = false;
    let previous = -1;
    const order = ['align', 'partition', 'collect', 'finish'];
    for (const operation of operations) {
      const index = order.indexOf(operation);
      if (index <= previous)
        throw new Error(
          'Fraction actions must advance once through align, partition, collect, finish.',
        );
      previous = index;
      if (operation === 'partition') partitioned = true;
      if (['collect', 'finish'].includes(operation) && !partitioned)
        throw new Error('Partition the same whole before collecting its pieces.');
      if (operation === 'collect') collected = true;
      if (operation === 'finish' && !collected)
        throw new Error('Collect fractions before holding their result.');
    }
  },
  focusTargets: (model, views) => [
    ...views.map((view) => view.id),
    `${model.id}:left`,
    `${model.id}:right`,
  ],
};
