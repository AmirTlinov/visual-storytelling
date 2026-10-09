import {
  all,
  create,
  type MathNode,
  type OperatorNode,
  type FunctionNode,
  type SymbolNode,
  type ConstantNode,
  type ArrayNode,
  type ParenthesisNode,
} from 'mathjs';
import type { FormulaBody, FormulaOperation } from './types.js';
import type { MathValue } from '../../math/value.js';
import type { MorphObject } from '../objects.js';
import type { MathOrigin } from '../types.js';
import { TensorData } from '../../math/tensor.js';
import { mathOriginKey, mathOrigins } from '../origins.js';
import { integrate } from './calculus.js';
import { expressionDependencies, type ExpressionValue } from './dependencies.js';

// One mathematics owner, isolated from the global mathjs instance and from the scene.
let engine: ReturnType<typeof create> | undefined;
const mathematics = () => (engine ??= create(all!, { matrix: 'Array' }));
function mathematicalNode(expression: string) {
  const root = mathematics().parse(expression);
  let count = 0;
  root.traverse((node) => {
    if (++count > 128)
      throw new Error('Split a formula longer than 128 nodes into narrative steps');
    if (
      ![
        'OperatorNode',
        'FunctionNode',
        'SymbolNode',
        'ConstantNode',
        'ParenthesisNode',
        'ArrayNode',
      ].includes(node.type)
    )
      throw new Error(`Formula syntax “${node.type}” is not a mathematical value expression`);
  });
  return root;
}
/** Curves and numerical bodies share the same expression engine and syntax boundary. */
export function scalarExpression(expression: string, variable = 'x') {
  const root = mathematicalNode(expression),
    code = root.compile();
  let slope: ReturnType<typeof root.compile> | undefined;
  const evaluate = (compiled: typeof code, x: number) => {
    if (!Number.isFinite(x)) throw new Error('A curve argument must be finite');
    const value = real(compiled.evaluate(new Map([[variable, x]])), expression);
    if (typeof value !== 'number') throw new Error('A curve must return one real number');
    return value;
  };
  return {
    value: (x: number) => evaluate(code, x),
    derivative: (x: number) =>
      evaluate((slope ??= mathematics().derivative(root, variable).compile()), x),
  };
}
export const valuesOf = (value: MathValue): number[] =>
  typeof value === 'number' ? [value] : value.flatMap(valuesOf);
function real(value: unknown, expression: string): MathValue {
  if (typeof value === 'number' && Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
  if (Array.isArray(value) && value.length && value.length <= 64) {
    const array = value.map((v) => real(v, expression));
    if (valuesOf(array).length <= 64) return array;
  }
  throw new Error(`“${expression}” needs a finite real number or an array of at most 64 numbers`);
}
export interface ExpressionBody {
  id: string;
  value: number;
  body?: MorphObject;
  origins: readonly MathOrigin[];
  inputIds: readonly string[];
  originPrecision: 'exact' | 'conservative';
}
export interface ExpressionStep {
  id: string;
  expression: string;
  operator: string;
  arguments: readonly MathValue[];
  custom?: boolean;
  calculus?: { expression: string; variable: string };
  value: MathValue;
  inputs: ExpressionBody[];
  outputs: ExpressionBody[];
}

/** Compile data flow once. Playback never evaluates a user function or parses an expression. */
export function compileExpression(operation: FormulaOperation) {
  if (!operation.expression.trim()) throw new Error('A formula needs an expression');
  const math = mathematics();
  const scope = new Map<string, unknown>();
  const bodies = new Map<string, FormulaBody>();
  const tensors = new Map<string, TensorData>();
  Object.entries(operation.inputs).forEach(([key, input]) => {
    const authored =
      typeof input === 'object' && !Array.isArray(input) && input !== null && 'body' in input
        ? (input as FormulaBody)
        : undefined;
    const value = authored ? authored.value : input;
    if (value instanceof TensorData) tensors.set(key, value);
    scope.set(key, real(value instanceof TensorData ? value.toValue() : value, key));
    if (authored) bodies.set(key, authored);
  });
  const custom = operation.functions ?? {};
  for (const [key, fn] of Object.entries(custom)) {
    if (
      typeof fn !== 'function' ||
      scope.has(key) ||
      ['diff', 'integral', 'partition'].includes(key)
    )
      throw new Error(`Invalid formula function “${key}”`);
    scope.set(key, fn);
  }
  const root = mathematicalNode(operation.expression);
  const initial: ExpressionBody[] = [],
    steps: ExpressionStep[] = [];
  let serial = 0;
  const explicitInputs = Object.keys(operation.inputs).length > 0;
  const operands = new Map(Object.keys(operation.inputs).map((key, i) => [key, i]));
  const leaf = (
    value: MathValue,
    name: string,
    body?: MorphObject,
    authored = true,
  ): ExpressionBody[] => {
    const operand = operands.get(name) ?? operands.size;
    if (!operands.has(name)) operands.set(name, operand);
    const values = valuesOf(value),
      origins = mathOrigins(values, operand, tensors.get(name));
    const result = values.map((value, index) => ({
      id: `input:${serial++}`,
      value,
      body,
      origins: authored ? [origins[index]!] : [],
      inputIds: [],
      originPrecision: 'exact' as const,
    }));
    initial.push(...result);
    return result;
  };
  const visible = (value: ExpressionValue) => value.cells.filter((cell) => cell !== undefined);
  // Calculus evaluates its expression through mathjs, so collect its authored
  // parameters separately without evaluating that expression a second time.
  function dependencies(node: MathNode, excluded: string) {
    const names = new Map<string, MathNode>();
    node.traverse((part) => {
      if (part.type !== 'SymbolNode') return;
      const name = (part as SymbolNode).name;
      if (name !== excluded && scope.has(name) && typeof scope.get(name) !== 'function')
        names.set(name, part);
    });
    return [...names.values()].flatMap((part) => visible(visit(part)));
  }
  function visit(node: MathNode): ExpressionValue {
    if (node.type === 'ParenthesisNode') return visit((node as ParenthesisNode).content);
    if (node.type === 'SymbolNode') {
      const name = (node as SymbolNode).name;
      const value = real(scope.has(name) ? scope.get(name) : node.compile().evaluate(), name);
      return {
        value,
        cells: scope.has(name)
          ? leaf(value, name, bodies.get(name)?.body)
          : valuesOf(value).map(() => undefined),
      };
    }
    if (node.type === 'ConstantNode') {
      const value = real((node as ConstantNode).value, node.toString());
      return {
        value,
        cells: explicitInputs
          ? valuesOf(value).map(() => undefined)
          : leaf(value, node.toString(), undefined, false),
      };
    }
    let args: ExpressionValue[],
      value: MathValue,
      parameters: ExpressionBody[] = [],
      calculus: ExpressionStep['calculus'],
      opaqueCalculus = false;
    const name =
      node.type === 'ArrayNode'
        ? 'array'
        : node.type === 'OperatorNode'
          ? (node as OperatorNode).fn
          : (node as FunctionNode).fn.name;
    if (node.type === 'ArrayNode') {
      args = (node as ArrayNode).items.map(visit);
      // A literal array cell is visible material, with no fabricated input origin.
      for (const arg of args) {
        const values = valuesOf(arg.value);
        arg.cells = arg.cells.map(
          (cell, index) => cell ?? leaf(values[index]!, String(values[index]), undefined, false)[0],
        );
      }
      value = real(
        args.map((v) => v.value),
        node.toString(),
      );
    } else if (name === 'diff' || name === 'integral') {
      const syntax = (node as FunctionNode).args;
      const variable = syntax[1];
      if (variable?.type !== 'SymbolNode' || syntax.length !== (name === 'diff' ? 2 : 4))
        throw new Error(
          'Use diff(expression, variable) or integral(expression, variable, from, to)',
        );
      const symbol = (variable as SymbolNode).name;
      calculus = { expression: syntax[0]!.toString({ parenthesis: 'auto' }), variable: symbol };
      syntax[0]!.traverse((part) => {
        if (part.type === 'FunctionNode' && Object.hasOwn(custom, (part as FunctionNode).fn.name))
          opaqueCalculus = true;
      });
      if (name === 'diff') {
        if (opaqueCalculus)
          throw new Error(
            'diff needs a known symbolic derivative; custom functions have no derivative rule',
          );
        args = scope.has(symbol) ? [visit(variable)] : [];
        if (args.some((arg) => typeof arg.value !== 'number'))
          throw new Error('The derivative evaluation point must be scalar');
        value = real(
          math.derivative(syntax[0]!, symbol).compile().evaluate(scope),
          node.toString(),
        );
      } else {
        args = [visit(syntax[2]!), visit(syntax[3]!)];
        if (args.some((arg) => typeof arg.value !== 'number'))
          throw new Error('Integral bounds must be scalar');
        const code = syntax[0]!.compile(),
          local = new Map(scope);
        value = integrate(
          (x) => {
            local.set(symbol, x);
            const value = real(code.evaluate(local), 'integrand');
            if (typeof value !== 'number') throw new Error('The integrand must be scalar');
            return value;
          },
          args[0]!.value as number,
          args[1]!.value as number,
        );
      }
      parameters = dependencies(syntax[0]!, symbol);
    } else {
      args = (
        node.type === 'OperatorNode' ? (node as OperatorNode).args : (node as FunctionNode).args
      ).map(visit);
      const fn =
        name === 'partition'
          ? (amount: number, count: number) => {
              if (
                !Number.isSafeInteger(count) ||
                count < 1 ||
                count > 16 ||
                typeof amount !== 'number'
              )
                throw new Error('partition(amount, count) needs a scalar and 1 to 16 equal parts');
              return Array(count).fill(amount / count);
            }
          : node.type === 'FunctionNode' && scope.has(name)
            ? scope.get(name)
            : (math as unknown as Record<string, unknown>)[name];
      if (typeof fn !== 'function') throw new Error(`Unknown mathematical function “${name}”`);
      value = real(fn(...args.map((a) => a.value)), node.toString());
    }
    const inputs = [...args.flatMap(visible), ...parameters];
    if (!inputs.length) return { value, cells: valuesOf(value).map(() => undefined) };
    const id = `step:${steps.length}`;
    const customCall = node.type === 'FunctionNode' && Object.hasOwn(custom, name);
    const dependency = expressionDependencies(
      name,
      args,
      value,
      customCall || opaqueCalculus,
      parameters,
    );
    const values = valuesOf(value);
    const outputs = values.map((value, index): ExpressionBody => {
      const sources = dependency.cells[index]!;
      return {
        id: `${id}:${index}`,
        value,
        body: sources.find((input) => input.body)?.body,
        inputIds: [...new Set(sources.map((input) => input.id))],
        originPrecision:
          dependency.precision === 'conservative' ||
          sources.some((input) => input.originPrecision === 'conservative')
            ? 'conservative'
            : 'exact',
        origins: [
          ...new Map(
            sources
              .flatMap((input) => input.origins)
              .map((origin) => [mathOriginKey(origin), origin]),
          ).values(),
        ],
      };
    });
    steps.push({
      id,
      expression: node.toString({ parenthesis: 'auto' }),
      operator: name,
      arguments: args.map((arg) => arg.value),
      custom: customCall || undefined,
      calculus,
      value,
      inputs,
      outputs,
    });
    return { value, cells: outputs };
  }
  const result = visit(root);
  if (!initial.length) result.cells = leaf(result.value, operation.expression, undefined, false);
  if (initial.length > 64) throw new Error('A scene can carry at most 64 input objects');
  return { initial, steps, result: result.value };
}
