import type { Pigment } from '../../ink/palette.js';
import type { MathValue } from '../formula/types.js';
import type { Input, MathState, Value } from './values.js';

/** Two or three finite coordinates. Array inference works without tuple casts in author code. */
export type Coordinate = readonly number[];
export type Domain = readonly [readonly [number, number], readonly [number, number]];
export interface MarkStyle<S extends MathState> {
  pigment?: Pigment;
  label?: Input<S, string>;
  visible?: Input<S, number>;
  quiet?: boolean;
  side?: 'top' | 'bottom' | 'left' | 'right';
  dashed?: boolean;
}
export interface CurveStyle<S extends MathState> extends MarkStyle<S> {
  domain: readonly [number, number];
  closed?: boolean;
  fill?: boolean;
}
export interface MaterialStyle<S extends MathState> extends MarkStyle<S> {
  domain: Domain;
  grid?: readonly [number, number];
  text?: Input<S, string>;
  fill?: boolean;
}
export interface ModelStep<S extends MathState> {
  to: Partial<S>;
  formula?: Input<S, string>;
  explanation: string;
}
export interface ModelPanel<S extends MathState> {
  title: string;
  objects: readonly ModelObject<S>[];
  axes?: boolean;
  aspect?: 'equal' | 'free';
  /** Optional mathematical envelope for maps with narrow extrema. Never screen coordinates. */
  bounds?: readonly [Coordinate, Coordinate];
  space?: '2d' | '3d';
}
export interface Explanation<S extends MathState> {
  panels: readonly ModelPanel<S>[];
  steps: readonly ModelStep<S>[];
  result?: Input<S, MathValue>;
}
export type ModelObject<S extends MathState> =
  | { kind: 'point'; id: string; at: Value<S, Coordinate>; style: MarkStyle<S> }
  | {
      kind: 'vector' | 'segment';
      id: string;
      from: Value<S, Coordinate>;
      to: Value<S, Coordinate>;
      style: MarkStyle<S>;
    }
  | {
      kind: 'polygon';
      id: string;
      vertices: readonly Value<S, Coordinate>[];
      style: MarkStyle<S> & { fill?: boolean };
    }
  | {
      kind: 'curve';
      id: string;
      at: (t: Input<S, number>) => Value<S, Coordinate>;
      style: CurveStyle<S>;
    }
  | {
      kind: 'material';
      id: string;
      map: Value<S, (uv: Coordinate) => Coordinate>;
      at: (uv: Input<S, Coordinate>) => Value<S, Coordinate>;
      style: MaterialStyle<S>;
    }
  | { kind: 'label'; id: string; at: Value<S, Coordinate>; style: MarkStyle<S> }
  | {
      kind: 'measure';
      id: string;
      from: Value<S, Coordinate>;
      to: Value<S, Coordinate>;
      style: MarkStyle<S>;
      unit: string;
    };
