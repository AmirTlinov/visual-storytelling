import type {
  Arithmetic,
  CellOperation,
  MathMorphFrame,
  MathMorphPlan,
  MathPart,
  MathNote,
  MorphPoint,
  MathStep,
} from './types.js';
import { clamp, equation, mathNumber, mix, smooth } from './numbers.js';
import { partBounds } from './measure.js';

const symbols: Record<Arithmetic, string> = {
  add: '+',
  subtract: '−',
  multiply: '×',
  divide: '÷',
  power: '^',
};
const cellSize = 1.4;
const maxTerms = 64;
// A long operation uses a readable row and a small ray-marched field per step.
const batchTerms = 4;
// Vector addition displays its entire result instead of reducing to a scalar.
const vectorTerms = 16;
const term = (n: number) => (n < 0 ? `(${mathNumber(n)})` : mathNumber(n));
function evaluate(operator: Arithmetic, values: readonly number[]) {
  if (!Object.hasOwn(symbols, operator)) throw new Error('Unknown arithmetic operation');
  if (!values.length || values.length > maxTerms || values.some((n) => !Number.isFinite(n)))
    throw new Error(`A calculation needs 1 to ${maxTerms} finite numbers`);
  if ((operator === 'divide' || operator === 'power') && values.length !== 2)
    throw new Error('Division and powers need exactly two operands');
  if (operator === 'divide' && values[1] === 0) throw new Error('Division by zero is undefined');
  const result =
    operator === 'add'
      ? values.reduce((a, b) => a + b, 0)
      : operator === 'subtract'
        ? values.slice(1).reduce((a, b) => a - b, values[0]!)
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
type Stage = {
  sample(p: number, columns?: number): Omit<MathMorphFrame, 'stage'>;
  bounds: MathPart[];
};
function slots(count: number, columns = count, xGap = 3.4, yGap = 7.2): MorphPoint[] {
  columns = Math.max(1, Math.min(count, Math.floor(columns)));
  const rows = Math.ceil(count / columns);
  return Array.from({ length: count }, (_, i) => [
    ((i % columns) - (Math.min(columns, count - Math.floor(i / columns) * columns) - 1) / 2) * xGap,
    ((rows - 1) / 2 - Math.floor(i / columns)) * yGap,
    0,
  ]);
}

/** A carried result keeps its body while a unary step changes the writing on it. */
function applyTo(input: MathPart, step: MathStep): Stage {
  const value =
    step.operator === 'apply'
      ? step.value(input.value)
      : evaluate(step.operator, [input.value, step.value]);
  if (!Number.isFinite(value)) throw new Error('The calculation must have a finite real result');
  if (step.operator === 'apply' && !step.label.trim())
    throw new Error('A function needs a visible label');
  const target = { ...input, value: Object.is(value, -0) ? 0 : value };
  const expression =
    step.operator === 'apply'
      ? `${step.label}(${mathNumber(input.value)})`
      : `${term(input.value)} ${symbols[step.operator]} ${term(step.value)}`;
  return {
    bounds: [input, target],
    sample(p) {
      const done = p >= 0.9;
      return {
        sources: [input],
        targets: [target],
        morph: smooth(p / 0.9),
        tension: 0,
        formula: done ? equation(expression, value, [input.value]) : expression,
        phase: done ? 'hold' : 'contact',
      };
    },
  };
}

function between(a: MathPart, b: MathPart, text: string, id: string): MathNote {
  const gap = Math.hypot(...a.position.map((v, axis) => v - b.position[axis]!)) - cellSize;
  return {
    id,
    text,
    size: [0.7, 0.7],
    position: [
      (a.position[0] + b.position[0]) / 2,
      (a.position[1] + b.position[1]) / 2,
      cellSize / 2 + 0.01,
    ],
    // Retire the sign before the closing gap becomes smaller than its inscription.
    opacity: smooth((gap - 0.75) / 0.6),
  };
}

/** Contact precedes evaluation: the packed source union contracts into its result slot. */
function reduceCells(
  inputs: MathPart[],
  operator: Arithmetic,
  provenance: MathMorphFrame['notes'] = [],
  layout?: {
    start(columns?: number): MathPart[];
    contact?(columns?: number): MorphPoint[];
  },
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
    sample(p, columns) {
      const approach = smooth(p / 0.4),
        morph = smooth((p - 0.4) / 0.5);
      const starts = layout
        ? layout.start(columns).map((part) => part.position)
        : columns === undefined
          ? inputs.map((p) => p.position)
          : slots(
              inputs.length,
              columns,
              inputs.length > 1 ? Math.abs(inputs[1]!.position[0] - inputs[0]!.position[0]) : 3.4,
            );
      const packed =
        layout?.contact?.(columns) ?? slots(inputs.length, columns, cellSize, cellSize);
      const sources = inputs.map((part, i) => ({
        ...part,
        position: [
          mix(starts[i]![0], packed[i]![0], approach),
          mix(starts[i]![1], packed[i]![1], approach),
          0,
        ] as MorphPoint,
      }));
      return {
        sources,
        targets: [target],
        notes: [
          ...provenance.map((note) => {
            const owner = sources.find((source) => source.id === note.id);
            return {
              ...note,
              position: [
                owner?.position[0] ?? note.position[0],
                columns === undefined ? note.position[1] : (owner?.position[1] ?? 0) - 3,
                note.position[2],
              ] as MorphPoint,
              opacity: note.opacity * (1 - smooth(p / 0.08)),
            };
          }),
          ...sources.slice(1).map((part, i) => {
            const note = between(sources[i]!, part, symbols[operator], `operator:${i}`);
            const clearance = Math.min(
              ...sources.map((source) =>
                Math.max(
                  ...[0, 1].map(
                    (axis) =>
                      Math.abs(note.position[axis]! - source.position[axis]!) -
                      (note.size[axis]! + source.size[axis]!) / 2,
                  ),
                ),
              ),
            );
            note.opacity *= smooth(clearance / 0.25) * (provenance.length ? smooth(p / 0.08) : 1);
            return note;
          }),
        ],
        morph,
        tension: 0.24 * morph,
        formula:
          p < 0.9
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
  offset = 0,
): Stage {
  const n = left.length,
    spacing = 3.4;
  const source = (operand: number, i: number, y: number) => {
    const value = (operand ? right : left)[i]!;
    return cell(
      value,
      `${operand ? 'right' : 'left'}:${offset + i}`,
      [(i - (n - 1) / 2) * spacing, y, 0],
      [{ operand, index: offset + i, value }],
    );
  };
  const starts = [
    ...left.map((_, i) => source(0, i, 1.65)),
    ...right.map((_, i) => source(1, i, -1.65)),
  ];
  const targets = left.map((a, i) =>
    cell(
      evaluate(operator, [a, right[i]!]),
      `pair:${offset + i}`,
      [(i - (n - 1) / 2) * spacing, 0, 0],
      [starts[i]!.origins![0]!, starts[n + i]!.origins![0]!],
    ),
  );
  return {
    bounds: starts,
    sample(p, columns) {
      const approach = smooth(p / 0.4),
        morph = smooth((p - 0.4) / 0.5);
      const locations = slots(n, columns, spacing);
      const destinations = targets.map((part, i) => ({ ...part, position: locations[i]! }));
      const sources = starts.map((part, i) => ({
        ...part,
        position: [
          locations[i % n]![0],
          locations[i % n]![1] +
            mix(part.position[1], i < n ? cellSize / 2 : -cellSize / 2, approach),
          0,
        ] as MorphPoint,
      }));
      return {
        sources,
        targets: destinations,
        morph,
        tension: 0.24 * morph,
        formula: operator === 'multiply' ? 'Умножаем пары' : 'Складываем пары',
        phase: p < 0.4 ? 'approach' : p < 0.9 ? 'contact' : 'hold',
        notes: [
          ...left.map((a, i) => ({
            id: `pair:${offset + i}`,
            position: [
              destinations[i]!.position[0],
              destinations[i]!.position[1] - 3,
              cellSize / 2 + 0.01,
            ] as MorphPoint,
            size: [3.1, 0.85] as const,
            text: `${term(a)} ${symbols[operator]} ${term(right[i]!)}`,
            opacity: smooth((p - 0.34) / 0.24),
          })),
          ...left.map((_, i) =>
            between(sources[i]!, sources[n + i]!, symbols[operator], `operator:${offset + i}`),
          ),
        ],
      };
    },
  };
}

/** New inputs sit above the same carried result, so a batch boundary never teleports it. */
function aboveResult(parts: MathPart[]) {
  const lift = 4.5 - Math.min(...parts.map((part) => part.position[1]));
  return parts.map((part) => ({
    ...part,
    position: [part.position[0], part.position[1] + lift, part.position[2]] as MorphPoint,
  }));
}

function contactAboveResult(count: number, columns?: number): MorphPoint[] {
  const positions = slots(count, columns, cellSize, cellSize);
  const bottom = Math.min(...positions.map((p) => p[1]));
  return [[0, 0, 0], ...positions.map(([x, y, z]): MorphPoint => [x, y - bottom + cellSize, z])];
}

function dotStages(left: readonly number[], right: readonly number[]): Stage[] {
  const stages: Stage[] = [];
  let carried: MathPart | undefined;
  for (let offset = 0; offset < left.length; offset += batchTerms) {
    const end = Math.min(left.length, offset + batchTerms);
    const paired = pairs(left.slice(offset, end), right.slice(offset, end), 'multiply', offset);
    const previous = carried;
    const sample = (p: number, columns?: number) => {
      const frame = paired.sample(p, columns);
      // Each partial sum retains its own field while the next pairs make contact.
      const lift =
        4.5 - Math.min(...paired.sample(0, columns).sources.map((part) => part.position[1]));
      const move = (part: MathPart): MathPart => ({
        ...part,
        material: `pair:${part.origins![0]!.index}`,
        position: [part.position[0], part.position[1] + lift, part.position[2]],
      });
      const accumulator = previous ? [{ ...previous, material: 'accumulator' }] : [];
      return {
        ...frame,
        sources: [...frame.sources.map(move), ...accumulator],
        targets: [...frame.targets.map(move), ...accumulator],
        notes: frame.notes?.map((note) => ({
          ...note,
          position: [note.position[0], note.position[1] + lift, note.position[2]] as MorphPoint,
        })),
        formula: `Умножаем пары ${offset + 1}–${end} из ${left.length}`,
      };
    };
    stages.push({ bounds: sample(0).sources, sample });
    const inputs = (columns?: number) => {
      const targets = sample(1, columns).targets;
      // Retain the original left-to-right accumulation order, including floating point rounding.
      const ordered = previous ? [targets.at(-1)!, ...targets.slice(0, -1)] : targets;
      return ordered.map(({ material: _, ...part }) => part);
    };
    const reduction = reduceCells(
      inputs(),
      'add',
      sample(1).notes?.filter((note) => note.opacity > 0),
      {
        start: inputs,
        contact: previous ? (columns) => contactAboveResult(end - offset, columns) : undefined,
      },
    );
    stages.push(reduction);
    carried = reduction.sample(1).targets[0]!;
  }
  return stages;
}

function calculationStages(values: readonly number[], operator: Arithmetic): Stage[] {
  const stages: Stage[] = [];
  let offset = 0,
    carried: MathPart | undefined;
  while (offset < values.length) {
    const end = Math.min(values.length, offset + batchTerms - (carried ? 1 : 0));
    const previous = carried,
      index = offset;
    const inputs = (columns?: number) => {
      const locations = slots(end - index, columns, 3);
      const fresh = aboveResult(
        values
          .slice(index, end)
          .map((value, i) =>
            cell(value, `input:${index + i}`, locations[i]!, [
              { operand: 0, index: index + i, value },
            ]),
          ),
      );
      return previous ? [previous, ...fresh] : fresh;
    };
    const reduction = reduceCells(inputs(), operator, [], {
      start: inputs,
      contact: previous ? (columns) => contactAboveResult(end - index, columns) : undefined,
    });
    stages.push(reduction);
    carried = reduction.sample(1).targets[0]!;
    offset = end;
  }
  return stages;
}

export function arithmeticPlan(operation: CellOperation): MathMorphPlan {
  const stages: Stage[] = [];
  let result: number | readonly number[];
  if (operation.kind === 'chain') {
    const initial = arithmeticPlan(operation.input);
    if (Array.isArray(initial.result)) throw new Error('A chain needs a scalar result');
    for (let i = 0; i < initial.stages; i++)
      stages.push({
        bounds: [...initial.sample(i / initial.stages).sources],
        sample: (p, columns) =>
          initial.sample((i + Math.min(p, 1 - 1e-12)) / initial.stages, { columns }),
      });
    let previous = initial.sample(1).targets[0]!;
    for (const step of operation.steps) {
      const stage = applyTo(previous, step);
      stages.push(stage);
      previous = stage.sample(1).targets[0]!;
    }
    result = previous.value;
  } else if (operation.kind === 'apply') {
    const input = cell(
      operation.input,
      'result',
      [0, 0, 0],
      [{ operand: 0, index: 0, value: operation.input }],
    );
    if (!Number.isFinite(operation.input)) throw new Error('Function input must be finite');
    const stage = applyTo(input, {
      operator: 'apply',
      label: operation.label,
      value: operation.value,
    });
    stages.push(stage);
    result = stage.sample(1).targets[0]!.value;
  } else if (operation.kind === 'calculate') {
    const values = [...operation.values];
    result = evaluate(operation.operator, values);
    if (values.length > batchTerms) stages.push(...calculationStages(values, operation.operator));
    else
      stages.push(
        reduceCells(
          values.map((value, i) =>
            cell(
              value,
              `input:${i}`,
              [(i - (values.length - 1) / 2) * 3, 0, 0],
              [{ operand: 0, index: i, value }],
            ),
          ),
          operation.operator,
        ),
      );
  } else {
    const left = [...operation.left],
      right = [...operation.right];
    const limit = operation.kind === 'dot' ? maxTerms : vectorTerms;
    if (!left.length || left.length > limit || right.length !== left.length)
      throw new Error(`Vector operations need equally sized rows of 1 to ${limit} numbers`);
    if (operation.kind === 'dot' && left.length > batchTerms) {
      stages.push(...dotStages(left, right));
      result = stages.at(-1)!.sample(1).targets[0]!.value;
    } else {
      const paired = pairs(left, right, operation.kind === 'dot' ? 'multiply' : 'add');
      stages.push(paired);
      const products = paired.sample(1).targets;
      if (operation.kind === 'dot') {
        const sum = reduceCells(
          products,
          'add',
          paired.sample(1).notes?.filter((note) => note.opacity > 0),
        );
        stages.push(sum);
        result = sum.sample(1).targets[0]!.value;
      } else result = products.map((p) => p.value);
    }
  }
  const bounds = partBounds(stages.flatMap((s) => s.bounds));
  // Equations stay below their own column without shrinking or colliding with its cell.
  bounds[0] = [
    bounds[0][0] - 0.65,
    ['calculate', 'apply'].includes(operation.kind) ? bounds[0][1] : Math.min(bounds[0][1], -3.5),
    bounds[0][2],
  ];
  bounds[1] = [bounds[1][0] + 0.65, bounds[1][1], bounds[1][2]];
  return {
    encoding: 'cells',
    result,
    bounds,
    stages: stages.length,
    sample(progress, layout) {
      if (!Number.isFinite(progress)) throw new Error('Morph progress must be finite');
      const p = clamp(progress),
        stage = Math.min(stages.length - 1, Math.floor(p * stages.length));
      const frame = stages[stage]!.sample(p === 1 ? 1 : p * stages.length - stage, layout?.columns);
      return {
        ...frame,
        stage,
        result:
          frame.phase === 'hold'
            ? frame.targets.length === 1
              ? frame.targets[0]!.value
              : frame.targets.map((part) => part.value)
            : undefined,
      };
    },
  };
}
