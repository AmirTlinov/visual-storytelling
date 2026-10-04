import { Value, read, checkOwner, snapshot, type MathState, type Input } from './values.js';
import { compileModel } from './plan.js';
import type { Coordinate, CurveStyle, MaterialStyle, MarkStyle, Explanation } from './types.js';

/** Describe mathematics and relationships. Sampling, ink, framing and narrative motion are shared. */
export function createModel<S extends MathState>(initial: S) {
  initial = snapshot(initial);
  const owner = Symbol('mathematical-model');
  let serial = 0;
  const id = () => `object-${serial++}`;
  const value = <T>(fn: (state: Readonly<S>) => T) =>
    new Value<S, T>(owner, (context) => fn(context.state));
  const input = <T>(source: Input<S, T>): Value<S, T> => {
    checkOwner(owner, source);
    const constant = source instanceof Value ? source : snapshot(source);
    return constant instanceof Value ? constant : value(() => constant);
  };
  const curve = (
    fn: Input<S, (t: number, state: Readonly<S>) => Coordinate>,
    style: CurveStyle<S>,
  ) => ({
    kind: 'curve' as const,
    id: id(),
    style,
    at: (t: Input<S, number>) => {
      checkOwner(owner, t, fn);
      return new Value<S, Coordinate>(owner, (context) =>
        read(fn, context)(read(t, context), context.state),
      );
    },
  });
  return {
    value,
    parameter: <K extends keyof S>(key: K): Value<S, S[K]> => value((state) => state[key]),
    point: (at: Input<S, Coordinate>, style: MarkStyle<S> = {}) => ({
      kind: 'point' as const,
      id: id(),
      at: input(at),
      style,
    }),
    vector: (from: Input<S, Coordinate>, to: Input<S, Coordinate>, style: MarkStyle<S> = {}) => ({
      kind: 'vector' as const,
      id: id(),
      from: input(from),
      to: input(to),
      style,
    }),
    segment: (from: Input<S, Coordinate>, to: Input<S, Coordinate>, style: MarkStyle<S> = {}) => ({
      kind: 'segment' as const,
      id: id(),
      from: input(from),
      to: input(to),
      style,
    }),
    polygon: (
      vertices: readonly Input<S, Coordinate>[],
      style: MarkStyle<S> & { fill?: boolean } = {},
    ) => ({
      kind: 'polygon' as const,
      id: id(),
      vertices: vertices.map(input),
      style,
    }),
    label: (text: Input<S, string>, at: Input<S, Coordinate>, style: MarkStyle<S> = {}) => ({
      kind: 'label' as const,
      id: id(),
      at: input(at),
      style: { ...style, label: text },
    }),
    curve,
    material: (
      map: Input<S, (uv: Coordinate, state: Readonly<S>) => Coordinate>,
      style: MaterialStyle<S>,
    ) => {
      checkOwner(owner, map);
      const mapping = new Value<S, (uv: Coordinate) => Coordinate>(owner, (context) => {
        const fn = read(map, context);
        return (uv) => fn([...uv], context.state);
      });
      return {
        kind: 'material' as const,
        id: id(),
        style,
        map: mapping,
        at: (uv: Input<S, Coordinate>) => mapping.join(uv, (fn, point) => fn(point)),
      };
    },
    measure: (
      from: Input<S, Coordinate>,
      to: Input<S, Coordinate>,
      style: MarkStyle<S> & { unit?: string } = {},
    ) => ({
      kind: 'measure' as const,
      id: id(),
      from: input(from),
      to: input(to),
      style,
      unit: style.unit ?? '',
    }),
    trace: <K extends keyof S>(
      at: Value<S, Coordinate>,
      parameter: K,
      style: MarkStyle<S> & { from?: number } = {},
    ) => {
      checkOwner(owner, at);
      if (typeof initial[parameter] !== 'number')
        throw new Error('A trace parameter must be scalar');
      const start = style.from ?? (initial[parameter] as number);
      if (!Number.isFinite(start)) throw new Error('A trace origin must be finite');
      return {
        kind: 'curve' as const,
        id: id(),
        style: { ...style, domain: [0, 1] as const },
        at: (fraction: Input<S, number>) => {
          checkOwner(owner, fraction);
          return new Value<S, Coordinate>(owner, (context) => {
            const end = context.state[parameter] as number;
            const state = {
              ...context.state,
              [parameter]: start + (end - start) * read(fraction, context),
            };
            return at.read({ state: snapshot(state), cache: new Map() });
          });
        },
      };
    },
    explain: (specification: Explanation<S>) => compileModel(initial, specification, owner),
  };
}
export type { Value, MathState, Input } from './values.js';
export type {
  Coordinate,
  Domain,
  MarkStyle,
  CurveStyle,
  MaterialStyle,
  ModelStep,
  ModelPanel,
  ModelObject,
  Explanation,
} from './types.js';
