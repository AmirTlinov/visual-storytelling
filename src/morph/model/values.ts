import type { MathValue } from '../../math/value.js';

export type MathState = Record<string, MathValue>;
export interface ModelContext<S extends MathState> {
  readonly state: Readonly<S>;
  readonly cache: Map<Value<S, unknown>, unknown>;
}

/** A pure relationship, evaluated once in a mathematical snapshot. It owns no clock or store. */
export class Value<S extends MathState, T> {
  constructor(
    readonly owner: symbol,
    private readonly evaluate: (context: ModelContext<S>) => T,
  ) {}
  read(context: ModelContext<S>): T {
    if (!context.cache.has(this)) context.cache.set(this, snapshot(this.evaluate(context)));
    return context.cache.get(this) as T;
  }
  map<U>(fn: (value: T) => U): Value<S, U> {
    return new Value(this.owner, (context) => fn(this.read(context)));
  }
  join<U, R>(other: Input<S, U>, fn: (left: T, right: U) => R): Value<S, R> {
    checkOwner(this.owner, other);
    const operand = other instanceof Value ? other : snapshot(other);
    return new Value(this.owner, (context) => fn(this.read(context), read(operand, context)));
  }
}
export type Input<S extends MathState, T> = T | Value<S, T>;
export const read = <S extends MathState, T>(input: Input<S, T>, context: ModelContext<S>): T =>
  input instanceof Value ? input.read(context) : input;
export function checkOwner(owner: symbol, ...values: readonly unknown[]) {
  if (values.some((value) => value instanceof Value && value.owner !== owner))
    throw new Error('A mathematical relationship must belong to the same model');
}
export const contextFor = <S extends MathState>(state: Readonly<S>): ModelContext<S> => ({
  state,
  cache: new Map(),
});

/** Callbacks cannot mutate the state or a sibling's cached mathematical value. */
export function snapshot<T>(value: T): T {
  // Compiled descriptors retain graph identity; only their plain data is copied.
  if (value instanceof Value) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(snapshot)) as T;
  if (value && typeof value === 'object')
    return Object.freeze(
      Object.fromEntries(Object.entries(value).map(([k, v]) => [k, snapshot(v)])),
    ) as T;
  return value;
}
