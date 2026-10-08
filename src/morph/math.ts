import { morphTiming } from './timing.js';
import type {
  Arithmetic,
  MathOperation,
  MathMorphFrame,
  MathMorphPlan,
  MathPart,
  MorphPoint,
  CellOperation,
  MathStep,
  VectorInput,
} from './types.js';
import { arithmeticPlan } from './arithmetic.js';
import { formulaPlan } from './formula/plan.js';
import type {
  FormulaBody,
  FormulaInput,
  FormulaOperation,
  FormulaOptions,
} from './formula/types.js';
import type { MathValue } from '../math/value.js';
import type { MorphObject } from './objects.js';
import { mountMath } from './presentation.js';
import { distribution, linearMap } from './construction/algebra.js';
import { projection } from './construction/trigonometry.js';
import { derivative, integral } from './construction/calculus.js';
import { spring } from './construction/dynamics.js';
import { deformation } from './construction/deformation.js';
import { createModel } from './model/index.js';
import type { ConstructionPlan, ScalarFunction } from './construction/types.js';
import { clamp, smooth, mix, mathNumber, equation } from './numbers.js';
import { sourceAt, sourceOf } from '../scene-source.js';
const expression = (formula: string) => formula.split(/ [=≈] /)[0]!;
function quantity(n: number) {
  if (!(n > 0) || !Number.isFinite(n))
    throw new Error('Measured morph quantities must be positive and finite');
  return n;
}
function count(n: number) {
  if (!Number.isSafeInteger(n) || n < 1 || n > 64)
    throw new Error('The number of visible parts must be an integer from 1 to 64');
  return n;
}
const part = (value: number, x = 0): MathPart => ({
  size: [value, 1, 1],
  position: [x, 0, 0],
  value,
});
function row(values: readonly number[], gap: number): MathPart[] {
  let x = -(values.reduce((a, b) => a + b, 0) + gap * (values.length - 1)) / 2;
  return values.map((value) => {
    const item = part(value, x + value / 2);
    x += value + gap;
    return item;
  });
}
interface Stage {
  bounds: MathPart[];
  sample(p: number): Omit<MathMorphFrame, 'stage'>;
}
function join(values: readonly number[], divide: boolean): Stage {
  const total = values.reduce((a, b) => a + b, 0),
    apart = row(values, 0.8),
    together = row(values, 0),
    whole = part(total);
  const formula = divide
    ? equation(`${mathNumber(total)} ÷ ${values.length}`, values[0]!, [total])
    : equation(values.map(mathNumber).join(' + '), total, values);
  return {
    bounds: [...apart, whole],
    sample(progress) {
      const p = divide ? 1 - progress : progress;
      const approach = smooth(p / 0.48),
        morph = smooth((p - 0.48) / 0.34);
      const pieces = apart.map((piece, i) => ({
        ...piece,
        position: [mix(piece.position[0], together[i]!.position[0], approach), 0, 0] as MorphPoint,
      }));
      return {
        sources: divide ? [whole] : pieces,
        targets: divide ? pieces : [whole],
        morph: divide ? 1 - morph : morph,
        formula: progress < 0.9 ? expression(formula) : formula,
        phase:
          progress >= 0.96 ? 'hold' : p < 0.48 ? (divide ? 'separate' : 'approach') : 'contact',
      };
    },
  };
}
function resize(from: MorphPoint, to: MorphPoint, formula: string, preserve = false): Stage {
  const maximum = from.map((x, i) => Math.max(x, to[i]!)) as [number, number, number];
  const value = (s: MorphPoint) => s[0] * s[1] * s[2];
  return {
    bounds: [{ size: maximum, position: [0, (maximum[1] - 1) / 2, 0], value: value(maximum) }],
    sample(p) {
      const t = smooth(p / 0.88);
      const size = from.map((x, i) => mix(x, to[i]!, t)) as [number, number, number];
      if (preserve) size[1] = value(from) / (size[0] * size[2]);
      const object = {
        size,
        position: [0, (size[1] - 1) / 2, 0] as MorphPoint,
        value: value(size),
      };
      return {
        sources: [object],
        targets: [object],
        morph: 0,
        formula: !preserve && p < 0.88 ? expression(formula) : formula,
        phase: p >= 0.96 ? 'hold' : 'resize',
      };
    },
  };
}
export function mathPlan(operation: ConstructionPlan): ConstructionPlan;
export function mathPlan<O extends MathOperation>(
  operation: O,
): MathMorphPlan<
  O extends FormulaOperation
    ? MathValue
    : O extends { kind: 'vectorAdd' }
      ? readonly number[]
      : number
>;
export function mathPlan(operation: MathOperation | MathMorphPlan): MathMorphPlan;
export function mathPlan(
  operation: MathOperation | MathMorphPlan | ConstructionPlan,
): MathMorphPlan | ConstructionPlan;
export function mathPlan(
  operation: MathOperation | MathMorphPlan | ConstructionPlan,
): MathMorphPlan | ConstructionPlan {
  return sourceAt(preparePlan(operation), sourceOf(operation));
}
function preparePlan(
  operation: MathOperation | MathMorphPlan | ConstructionPlan,
): MathMorphPlan | ConstructionPlan {
  if ('sample' in operation) return operation;
  if (operation.kind === 'formula') return formulaPlan(operation);
  if (
    operation.kind === 'calculate' ||
    operation.kind === 'dot' ||
    operation.kind === 'vectorAdd' ||
    operation.kind === 'apply' ||
    operation.kind === 'chain'
  )
    return arithmeticPlan(operation);
  const stages: Stage[] = [];
  let result: number;
  if (operation.kind === 'add') {
    if (!operation.values.length || operation.values.length > 64)
      throw new Error('Addition needs 1 to 64 terms');
    const values = operation.values.map(quantity);
    result = quantity(values.reduce((a, b) => a + b, 0));
    stages.push(join(values, false));
  } else if (operation.kind === 'divide') {
    result = quantity(quantity(operation.value) / count(operation.parts));
    stages.push(join(Array(operation.parts).fill(result), true));
  } else if (operation.kind === 'multiply') {
    const a = quantity(operation.value),
      b = quantity(operation.factor);
    result = quantity(a * b);
    const formula = equation(`${mathNumber(a)} × ${mathNumber(b)}`, result, [a, b]);
    stages.push(
      resize([a, 1, 1], [a, b, 1], formula),
      resize([a, b, 1], [result, 1, 1], formula, true),
    );
  } else if (operation.kind === 'power') {
    const base = quantity(operation.base),
      n = operation.exponent;
    if (!Number.isSafeInteger(n) || n < 0 || n > 16)
      throw new Error('A repeated power needs an integer exponent from 0 to 16');
    result = quantity(base ** n);
    for (let i = 0; i < Math.max(1, n); i++) {
      const dimensions = (power: number): MorphPoint => [
        base ** Math.ceil(power / 2),
        base ** Math.floor(power / 2),
        1,
      ];
      const to = n ? base ** (i + 1) : 1;
      stages.push(
        resize(
          dimensions(i),
          dimensions(n ? i + 1 : 0),
          equation(`${mathNumber(base)}^${n ? i + 1 : 0}`, to, [base]),
        ),
      );
    }
  } else {
    const { from, to } = operation;
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to)
      throw new Error('A function morph needs two distinct finite inputs');
    const base = operation.kind === 'exponential' ? quantity(operation.base) : 1;
    const evaluate = operation.kind === 'map' ? operation.value : (x: number) => base ** x;
    const label =
      operation.kind === 'map'
        ? operation.label
        : (x: number, y: number) =>
            equation(
              `${base === Math.E ? 'e' : mathNumber(base)}^${mathNumber(x)}`,
              y,
              base === Math.E ? [x] : [base, x],
            );
    const range =
      operation.kind === 'map'
        ? operation.range
        : [evaluate(from), evaluate(to)].sort((a, b) => a - b);
    const min = quantity(range[0]!),
      max = quantity(range[1]!);
    if (max < min) throw new Error('The function range must be ordered');
    const checkValue = (x: number) => {
      const value = quantity(evaluate(x));
      if (value < min - 1e-9 || value > max + 1e-9)
        throw new Error('Function value is outside its declared range');
      return value;
    };
    checkValue(from);
    result = checkValue(to);
    stages.push({
      bounds: [
        max > 32
          ? {
              size: [Math.sqrt(max), Math.sqrt(max), 1],
              position: [0, (Math.sqrt(max) - 1) / 2, 0],
              value: max,
            }
          : part(max),
      ],
      sample(p) {
        const x = mix(from, to, p),
          y = checkValue(x);
        const side = Math.sqrt(y),
          largest = Math.sqrt(max);
        const object: MathPart =
          max > 32
            ? {
                size: [side, side, 1],
                position: [(side - largest) / 2, (side - 1) / 2, 0],
                value: y,
              }
            : part(y, (y - max) / 2);
        return {
          sources: [object],
          targets: [object],
          morph: 0,
          formula: label(x, y),
          phase: p === 1 ? 'hold' : 'resize',
        };
      },
    });
  }
  const lower = [Infinity, Infinity, Infinity],
    upper = [-Infinity, -Infinity, -Infinity];
  for (const stage of stages)
    for (const body of stage.bounds)
      for (let axis = 0; axis < 3; axis++) {
        lower[axis] = Math.min(lower[axis]!, body.position[axis]! - body.size[axis]! / 2);
        upper[axis] = Math.max(upper[axis]!, body.position[axis]! + body.size[axis]! / 2);
      }
  return {
    encoding: 'quantity',
    result,
    bounds: [lower as unknown as MorphPoint, upper as unknown as MorphPoint],
    stages: stages.length,
    sample(progress) {
      if (!Number.isFinite(progress)) throw new Error('Morph progress must be finite');
      const p = clamp(progress),
        stage = Math.min(stages.length - 1, Math.floor(p * stages.length));
      const frame = stages[stage]!.sample(p === 1 ? 1 : p * stages.length - stage);
      return {
        ...frame,
        stage,
        result: frame.phase === 'hold' ? frame.targets[0]!.value : undefined,
      };
    },
  };
}
export const MathMorph = {
  model: createModel,
  mount: mountMath,
  timing: morphTiming,
  distribute: distribution,
  linear: linearMap,
  project: projection,
  derivative: (fn: ScalarFunction, at: number, options: { span?: number; label?: string } = {}) =>
    derivative(fn, at, options.span, options.label),
  integral: (fn: ScalarFunction, from: number, to: number, options: { label?: string } = {}) =>
    integral(fn, from, to, options.label),
  spring: (options: { mass: number; stiffness: number; amplitude: number }) =>
    spring(options.mass, options.stiffness, options.amplitude),
  deform: deformation,
  body: (value: FormulaBody['value'], body: MorphObject): FormulaBody => ({ value, body }),
  formula: (
    expression: string,
    inputs: Readonly<Record<string, FormulaInput>> = {},
    options: FormulaOptions = {},
  ): FormulaOperation => ({ kind: 'formula', expression, inputs, ...options }),
  chain: (
    input: CellOperation,
    ...steps: MathStep[]
  ): Extract<CellOperation, { kind: 'chain' }> => ({ kind: 'chain', input, steps }),
  apply: (
    input: number,
    label: string,
    value: (input: number) => number,
  ): Extract<CellOperation, { kind: 'apply' }> => ({ kind: 'apply', input, label, value }),
  calculate: (
    operator: Arithmetic,
    ...values: number[]
  ): Extract<MathOperation, { kind: 'calculate' }> => ({
    kind: 'calculate',
    operator,
    values,
  }),
  dot: (left: VectorInput, right: VectorInput): Extract<MathOperation, { kind: 'dot' }> => ({
    kind: 'dot',
    left,
    right,
  }),
  vectorAdd: (
    left: VectorInput,
    right: VectorInput,
  ): Extract<MathOperation, { kind: 'vectorAdd' }> => ({
    kind: 'vectorAdd',
    left,
    right,
  }),
  add: (...values: number[]): Extract<MathOperation, { kind: 'add' }> => ({ kind: 'add', values }),
  divide: (value: number, parts: number): Extract<MathOperation, { kind: 'divide' }> => ({
    kind: 'divide',
    value,
    parts,
  }),
  multiply: (value: number, factor: number): Extract<MathOperation, { kind: 'multiply' }> => ({
    kind: 'multiply',
    value,
    factor,
  }),
  power: (base: number, exponent: number): Extract<MathOperation, { kind: 'power' }> => ({
    kind: 'power',
    base,
    exponent,
  }),
  exponential: (
    from = 0,
    to = 3,
    base = Math.E,
  ): Extract<MathOperation, { kind: 'exponential' }> => ({
    kind: 'exponential',
    from,
    to,
    base,
  }),
  map: (
    options: Omit<Extract<MathOperation, { kind: 'map' }>, 'kind'>,
  ): Extract<MathOperation, { kind: 'map' }> => ({
    kind: 'map',
    ...options,
  }),
  plan: mathPlan,
};
