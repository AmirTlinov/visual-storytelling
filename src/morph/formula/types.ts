import type { MorphObject } from '../objects.js';

export type MathValue = number | readonly MathValue[];
/** A number or tensor carried by the supplied material. Geometry is a template, not a trajectory. */
export interface FormulaBody {
  readonly value: MathValue;
  readonly body: MorphObject;
}
export type FormulaInput = MathValue | FormulaBody;
export interface FormulaOptions {
  /** Auto uses volume for positive, comparable quantities, and written values otherwise. */
  measure?: 'auto' | 'volume' | 'value';
  /** Pure mathematical functions. The engine supplies their movement and inscriptions. */
  functions?: Record<string, (...values: any[]) => MathValue>;
}
export interface FormulaOperation extends FormulaOptions {
  readonly kind: 'formula';
  readonly expression: string;
  readonly inputs: Readonly<Record<string, FormulaInput>>;
}
