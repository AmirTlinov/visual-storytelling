import type { MathValue } from '../../math/value.js';
import type { ExpressionBody } from './expression.js';

/** Flat cells keep their positions even when an authored constant has no visible body. */
export interface ExpressionValue {
  value: MathValue;
  cells: (ExpressionBody | undefined)[];
}
const present = (cells: ExpressionValue['cells']) => cells.filter((cell) => cell !== undefined);
function shape(value: MathValue): number[] {
  return typeof value === 'number' ? [] : [value.length, ...shape(value[0]!)];
}
const sameShape = (a: number[], b: number[]) =>
  a.length === b.length && a.every((size, i) => size === b[i]);
const cellCount = (value: MathValue): number =>
  typeof value === 'number' ? 1 : value.reduce<number>((count, item) => count + cellCount(item), 0);
const elementwise = new Set([
  'add',
  'subtract',
  'dotMultiply',
  'dotDivide',
  'dotPow',
  'mod',
  'unaryMinus',
  'unaryPlus',
  'abs',
  'sqrt',
  'cbrt',
  'exp',
  'expm1',
  'log',
  'log10',
  'log2',
  'log1p',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'sinh',
  'cosh',
  'tanh',
  'sign',
  'floor',
  'ceil',
  'round',
  'fix',
]);

/** Structural dependence, independent of the numbers at this particular instant. */
export function expressionDependencies(
  operator: string,
  args: ExpressionValue[],
  output: MathValue,
  custom: boolean,
  parameters: ExpressionBody[] = [],
): { cells: ExpressionBody[][]; precision: 'exact' | 'conservative' } {
  const dimensions = shape(output),
    count = cellCount(output),
    inputs = [...args.flatMap((arg) => present(arg.cells)), ...parameters],
    all = () => Array.from({ length: count }, () => inputs);
  if (custom) return { cells: all(), precision: 'conservative' };
  if (operator === 'array')
    return {
      cells: args.flatMap((arg) => arg.cells.map((cell) => (cell ? [cell] : []))),
      precision: 'exact',
    };
  if (operator === 'partition') return { cells: all(), precision: 'exact' };
  if ((operator === 'transpose' || operator === 'ctranspose') && args.length === 1) {
    const source = args[0]!,
      sizes = shape(source.value);
    if (sizes.length < 2)
      return { cells: source.cells.map((cell) => (cell ? [cell] : [])), precision: 'exact' };
    if (sizes.length === 2)
      return {
        cells: Array.from({ length: count }, (_, i) =>
          present([source.cells[(i % sizes[0]!) * sizes[1]! + Math.floor(i / sizes[0]!)]]),
        ),
        precision: 'exact',
      };
  }
  if (operator === 'sum') {
    if (!dimensions.length) return { cells: all(), precision: 'exact' };
    const source = args[0]!,
      sizes = shape(source.value),
      axis = args[1]?.value;
    if (typeof axis === 'number' && Number.isInteger(axis) && axis >= 0 && axis < sizes.length) {
      const stride = sizes.slice(axis + 1).reduce((n, size) => n * size, 1);
      return {
        cells: Array.from({ length: count }, (_, i) =>
          present([
            ...Array.from(
              { length: sizes[axis]! },
              (_, k) =>
                source.cells[
                  Math.floor(i / stride) * stride * sizes[axis]! + k * stride + (i % stride)
                ],
            ),
            ...args.slice(1).flatMap((arg) => arg.cells),
          ]),
        ),
        precision: 'exact',
      };
    }
  }
  if (operator === 'multiply' && args.length === 2) {
    const [left, right] = args as [ExpressionValue, ExpressionValue],
      a = shape(left.value),
      b = shape(right.value);
    if (a.length && b.length && a.length <= 2 && b.length <= 2) {
      const contracted = a.at(-1)!;
      if (contracted === b[0]) {
        const columns = b.length === 2 ? b[1]! : 1;
        return {
          cells: Array.from({ length: count }, (_, i) => {
            const row = a.length === 2 ? Math.floor(i / columns) : 0,
              column = i % columns;
            return present(
              Array.from({ length: contracted }, (_, k) => [
                left.cells[row * contracted + k],
                right.cells[b.length === 2 ? k * columns + column : k],
              ]).flat(),
            );
          }),
          precision: 'exact',
        };
      }
    }
  }
  const scalarArguments = args.every((arg) => typeof arg.value === 'number');
  const scaled =
    (operator === 'multiply' && args.some((arg) => typeof arg.value === 'number')) ||
    // A matrix denominator is inverted by mathjs; its cells are not independent divisors.
    (operator === 'divide' && typeof args[1]?.value === 'number');
  if ((scalarArguments && !dimensions.length) || elementwise.has(operator) || scaled) {
    if (
      args.every((arg) => typeof arg.value === 'number' || sameShape(shape(arg.value), dimensions))
    )
      return {
        cells: Array.from({ length: count }, (_, i) =>
          present([
            ...args.map((arg) => arg.cells[typeof arg.value === 'number' ? 0 : i]),
            ...parameters,
          ]),
        ),
        precision: 'exact',
      };
  }
  return { cells: all(), precision: 'conservative' };
}
