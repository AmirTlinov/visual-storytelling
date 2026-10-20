import { morphTiming } from './timing.js';
import type { Arithmetic, MathOperation, CellOperation, MathStep, VectorInput } from './types.js';
import type {
  FormulaBody,
  FormulaInput,
  FormulaOperation,
  FormulaOptions,
} from './formula/types.js';
import type { MorphObject } from './objects.js';
import { mountMath } from './presentation.js';
import { distribution, linearMap } from './construction/algebra.js';
import { projection } from './construction/trigonometry.js';
import { derivative, integral } from './construction/calculus.js';
import { spring } from './construction/dynamics.js';
import { deformation } from './construction/deformation.js';
import { createModel } from './model/index.js';
import type { ScalarFunction } from './construction/types.js';
import { mathPlan } from './plan.js';

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
  dot: (
    left: VectorInput,
    right: VectorInput,
    options: { batchSize?: number } = {},
  ): Extract<MathOperation, { kind: 'dot' }> => ({
    kind: 'dot',
    left,
    right,
    ...options,
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
