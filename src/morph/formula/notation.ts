import { mathNumber } from '../numbers.js';
import { valuesOf, type ExpressionStep } from './expression.js';
import type { MathValue } from '../../math/value.js';

export const formulaValue = (value: MathValue): string =>
  typeof value === 'number' ? mathNumber(value) : `[${value.map(formulaValue).join('; ')}]`;
export const formulaWriting = (text: string) =>
  text
    .replace(/\s*\*\s*/g, ' × ')
    .replace(/\s*\/\s*/g, ' ÷ ')
    .replace(/\s*-\s*/g, ' − ')
    .replace(/\s*\^\s*([23])\b/g, (_, n) => (n === '2' ? '²' : '³'));
const operand = (value: MathValue) =>
  typeof value === 'number' && value < 0 ? `(${formulaValue(value)})` : formulaValue(value);
const sign = (values: readonly MathValue[]) =>
  values
    .flatMap(valuesOf)
    .some((n) => Math.abs(Number(n.toPrecision(4)) - n) > Math.abs(n) * Number.EPSILON * 8)
    ? '≈'
    : '=';

/** Readable arithmetic belongs to the operation, including array and calculus notation. */
export function formulaNotation(step: ExpressionStep, resolved: boolean) {
  const args = step.arguments,
    values = args.map(operand);
  if (step.custom) {
    const call = `${step.operator}(${values.join(', ')})`;
    return resolved ? `${call} ${sign([...args, step.value])} ${formulaValue(step.value)}` : call;
  }
  if (step.operator === 'partition') {
    const count = args[1] as number;
    return resolved
      ? `${values[0]} ${sign([args[0]!, step.value])} ${valuesOf(step.value).map(mathNumber).join(' + ')}`
      : `${values[0]} → ${count} ${count === 1 ? 'часть' : count < 5 ? 'части' : 'частей'}`;
  }
  const binary: Record<string, string> = {
    add: '+',
    subtract: '−',
    multiply: '×',
    divide: '÷',
    pow: '^',
    dotMultiply: '×',
    dotDivide: '÷',
    dotPow: '^',
    mod: 'mod',
  };
  let expression: string;
  if (binary[step.operator])
    expression = values
      .join(` ${binary[step.operator]} `)
      .replace(/ \^ (2|3)\b/g, (_, n) => (n === '2' ? '²' : '³'));
  else if (step.operator === 'unaryMinus') expression = `−${values[0]}`;
  else if (step.operator === 'unaryPlus') expression = `+${values[0]}`;
  else if (step.operator === 'sqrt') expression = `√(${values[0]})`;
  else if (step.operator === 'sum')
    expression =
      args.length === 2 && Array.isArray(args[0])
        ? `Σ по оси ${values[1]}: ${values[0]}`
        : args.flatMap(valuesOf).map(operand).join(' + ');
  else if (step.operator === 'transpose' || step.operator === 'ctranspose')
    expression = `${values[0]}ᵀ`;
  else if (step.operator === 'array') expression = formulaValue(step.value);
  else if (step.operator === 'diff') {
    const { expression: term, variable } = step.calculus!;
    expression = `d/d${variable} (${formulaWriting(term)})${args.length ? `, ${variable} = ${values[0]}` : ''}`;
  } else if (step.operator === 'integral') {
    const { expression: term, variable } = step.calculus!;
    expression = `∫[${values.join('; ')}] ${formulaWriting(term)} d${variable}`;
  } else expression = `${step.operator}(${values.join(', ')})`;
  return resolved && step.operator !== 'array'
    ? `${expression} ${step.operator === 'diff' ? '→' : sign([...args, step.value])} ${formulaValue(step.value)}`
    : expression;
}
