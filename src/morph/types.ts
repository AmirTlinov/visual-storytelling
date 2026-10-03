export type MorphPoint = readonly [number, number, number];
export type Arithmetic = 'add' | 'multiply' | 'divide' | 'power';
export type CellOperation =
  | { kind: 'calculate'; operator: Arithmetic; values: readonly number[] }
  | { kind: 'dot'; left: readonly number[]; right: readonly number[] }
  | { kind: 'vectorAdd'; left: readonly number[]; right: readonly number[] };
export type MathOperation =
  | CellOperation
  | { kind: 'add'; values: readonly number[] }
  | { kind: 'divide'; value: number; parts: number }
  | { kind: 'multiply'; value: number; factor: number }
  | { kind: 'power'; base: number; exponent: number }
  | { kind: 'exponential'; base: number; from: number; to: number }
  | {
      kind: 'map';
      from: number;
      to: number;
      range: readonly [number, number];
      value: (x: number) => number;
      label: (x: number, y: number) => string;
    };
export interface MathOrigin {
  operand: number;
  index: number;
  value: number;
}
export interface MathPart {
  size: MorphPoint;
  position: MorphPoint;
  value: number;
  /** Stable identities and original inputs survive each arithmetic step. */
  id?: string;
  origins?: readonly MathOrigin[];
}
export interface MathNote {
  size: readonly [number, number];
  id: string;
  text: string;
  position: MorphPoint;
  opacity: number;
}
export interface MathMorphFrame {
  sources: MathPart[];
  targets: MathPart[];
  morph: number;
  /** Local joining distance for the shared surface; zero preserves measured boundaries. */
  tension?: number;
  formula: string;
  phase: 'approach' | 'contact' | 'separate' | 'resize' | 'hold';
  stage: number;
  notes?: readonly MathNote[];
}
export interface MathMorphPlan<
  Result extends number | readonly number[] = number | readonly number[],
> {
  /** Quantities encode magnitude in size; cells carry signed numbers in equally sized slots. */
  readonly encoding: 'quantity' | 'cells';
  readonly result: Result;
  readonly bounds: readonly [MorphPoint, MorphPoint];
  readonly stages: number;
  sample(progress: number): MathMorphFrame;
}
