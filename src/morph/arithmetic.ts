import type {
  Arithmetic,
  CellOperation,
  MathMorphFrame,
  MathMorphPlan,
  MathPart,
  MorphPoint,
} from './types.js';
import { clamp, equation, mathNumber, mix, smooth } from './numbers.js';
import { partBounds } from './measure.js';

const symbols: Record<Arithmetic, string> = { add: '+', multiply: '×', divide: '÷', power: '^' };
const cellSize = 1.4;
const term = (n: number) => (n < 0 ? `(${mathNumber(n)})` : mathNumber(n));
function evaluate(operator: Arithmetic, values: readonly number[]) {
  if (!Object.hasOwn(symbols, operator)) throw new Error('Unknown arithmetic operation');
  if (!values.length || values.length > 16 || values.some((n) => !Number.isFinite(n)))
    throw new Error('A calculation needs 1 to 16 finite numbers');
  if ((operator === 'divide' || operator === 'power') && values.length !== 2)
    throw new Error('Division and powers need exactly two operands');
  if (operator === 'divide' && values[1] === 0) throw new Error('Division by zero is undefined');
  const result =
    operator === 'add'
      ? values.reduce((a, b) => a + b, 0)
      : operator === 'multiply'
        ? values.reduce((a, b) => a * b, 1)
        : operator === 'divide'
          ? values[0]! / values[1]!
          : values[0]! ** values[1]!;
  if (!Number.isFinite(result)) throw new Error('The calculation must have a finite real result');
  return Object.is(result, -0) ? 0 : result;
}
const cell = (
  value: number,
  id: string,
  position: MorphPoint,
  origins: MathPart['origins'],
): MathPart => ({
  size: [cellSize, cellSize, cellSize],
  position,
  value,
  id,
  origins,
});
type Stage = { sample(p: number): Omit<MathMorphFrame, 'stage'>; bounds: MathPart[] };

/** Contact precedes evaluation: the packed source union contracts into its result slot. */
function reduceCells(
  inputs: MathPart[],
  operator: Arithmetic,
  provenance: MathMorphFrame['notes'] = [],
): Stage {
  const result = evaluate(
    operator,
    inputs.map((p) => p.value),
  );
  const target = cell(
    result,
    'result',
    [0, 0, 0],
    inputs.flatMap((p) => p.origins ?? []),
  );
  const expression = inputs.map((p) => term(p.value)).join(` ${symbols[operator]} `);
  return {
    bounds: [...inputs, target],
    sample(p) {
      const approach = smooth(p / 0.4),
        morph = smooth((p - 0.48) / 0.34);
      const sources = inputs.map((part, i) => ({
        ...part,
        position: [
          mix(part.position[0], (i - (inputs.length - 1) / 2) * cellSize, approach),
          mix(part.position[1], 0, approach),
          0,
        ] as MorphPoint,
      }));
      return {
        sources,
        targets: [target],
        notes: provenance?.map((note) => {
          const owner = sources.find((source) => source.id === note.id);
          return {
            ...note,
            position: [
              owner?.position[0] ?? note.position[0],
              note.position[1],
              note.position[2],
            ] as MorphPoint,
            opacity: 1 - smooth(p / 0.38),
          };
        }),
        morph,
        sourceOpacity: 1 - smooth((p - 0.44) / 0.14),
        targetOpacity: smooth((p - 0.82) / 0.1),
        formula:
          p < 0.82
            ? expression
            : equation(
                expression,
                result,
                inputs.map((p) => p.value),
              ),
        phase: p < 0.4 ? 'approach' : p < 0.9 ? 'contact' : 'hold',
      };
    },
  };
}

function pairs(
  left: readonly number[],
  right: readonly number[],
  operator: 'add' | 'multiply',
): Stage {
  const n = left.length,
    spacing = 3.4;
  const source = (operand: number, i: number, y: number) => {
    const value = (operand ? right : left)[i]!;
    return cell(
      value,
      `${operand ? 'right' : 'left'}:${i}`,
      [(i - (n - 1) / 2) * spacing, y, 0],
      [{ operand, index: i, value }],
    );
  };
  const starts = [
    ...left.map((_, i) => source(0, i, 1.65)),
    ...right.map((_, i) => source(1, i, -1.65)),
  ];
  const targets = left.map((a, i) =>
    cell(
      evaluate(operator, [a, right[i]!]),
      `pair:${i}`,
      [(i - (n - 1) / 2) * spacing, 0, 0],
      [starts[i]!.origins![0]!, starts[n + i]!.origins![0]!],
    ),
  );
  return {
    bounds: starts,
    sample(p) {
      const approach = smooth(p / 0.4),
        morph = smooth((p - 0.48) / 0.34);
      const sources = starts.map((part, i) => ({
        ...part,
        position: [
          part.position[0],
          mix(part.position[1], i < n ? cellSize / 2 : -cellSize / 2, approach),
          0,
        ] as MorphPoint,
      }));
      return {
        sources,
        targets,
        morph,
        sourceOpacity: 1 - smooth((p - 0.44) / 0.14),
        targetOpacity: smooth((p - 0.82) / 0.1),
        formula:
          operator === 'multiply'
            ? 'Умножаем соответствующие числа'
            : 'Складываем соответствующие числа',
        phase: p < 0.4 ? 'approach' : p < 0.9 ? 'contact' : 'hold',
        notes: left.map((a, i) => ({
          id: `pair:${i}`,
          position: [targets[i]!.position[0], -3, cellSize / 2 + 0.01] as MorphPoint,
          size: [3.1, 0.85] as const,
          text: `${term(a)} ${symbols[operator]} ${term(right[i]!)}`,
          opacity: 1,
        })),
      };
    },
  };
}

export function arithmeticPlan(operation: CellOperation): MathMorphPlan {
  const stages: Stage[] = [];
  let result: number | readonly number[];
  if (operation.kind === 'calculate') {
    const values = [...operation.values];
    result = evaluate(operation.operator, values);
    stages.push(
      reduceCells(
        values.map((value, i) =>
          cell(
            value,
            `input:${i}`,
            [(i - (values.length - 1) / 2) * 1.8, 0, 0],
            [{ operand: 0, index: i, value }],
          ),
        ),
        operation.operator,
      ),
    );
  } else {
    const left = [...operation.left],
      right = [...operation.right];
    if (!left.length || left.length > 16 || right.length !== left.length)
      throw new Error('Vector operations need equally sized rows of 1 to 16 numbers');
    const paired = pairs(left, right, operation.kind === 'dot' ? 'multiply' : 'add');
    stages.push(paired);
    const products = paired.sample(1).targets;
    if (operation.kind === 'dot') {
      const sum = reduceCells(products, 'add', paired.sample(1).notes);
      stages.push(sum);
      result = sum.sample(1).targets[0]!.value;
    } else result = products.map((p) => p.value);
  }
  const bounds = partBounds(stages.flatMap((s) => s.bounds));
  // Equations stay below their own column without shrinking or colliding with its cell.
  bounds[0] = [
    bounds[0][0] - 0.65,
    operation.kind === 'calculate' ? bounds[0][1] : Math.min(bounds[0][1], -3.5),
    bounds[0][2],
  ];
  bounds[1] = [bounds[1][0] + 0.65, bounds[1][1], bounds[1][2]];
  return {
    encoding: 'cells',
    result,
    bounds,
    stages: stages.length,
    sample(progress) {
      if (!Number.isFinite(progress)) throw new Error('Morph progress must be finite');
      const p = clamp(progress),
        stage = Math.min(stages.length - 1, Math.floor(p * stages.length));
      return { ...stages[stage]!.sample(p === 1 ? 1 : p * stages.length - stage), stage };
    },
  };
}
