import type { Pigment } from '../../ink/palette.js';

export type DiagramPoint = readonly [number, number];
export type DiagramBounds = readonly [DiagramPoint, DiagramPoint];
export type ScalarFunction = string | ((x: number) => number);
export type Matrix2 = readonly [DiagramPoint, DiagramPoint];

/** Mathematical coordinates, never pixels. Material coordinates identify the same ink over time. */
export interface MaterialPatch {
  id: string;
  domain: DiagramBounds;
  map(point: DiagramPoint): DiagramPoint;
  pigment: Pigment;
  grid?: readonly [number, number];
  text?: string;
  opacity?: number;
}
export interface DiagramPath {
  id: string;
  points: readonly DiagramPoint[];
  pigment?: Pigment;
  closed?: boolean;
  fill?: boolean;
  quiet?: boolean;
  dashed?: boolean;
  arrow?: boolean;
  opacity?: number;
}
export interface DiagramLabel {
  id: string;
  text: string;
  at: DiagramPoint;
  pigment?: Pigment;
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** A measurement belongs to its endpoints; the renderer owns its offset and lettering. */
  to?: DiagramPoint;
  opacity?: number;
}
export interface DiagramPanel {
  id: string;
  title: string;
  bounds: DiagramBounds;
  aspect?: 'equal' | 'free';
  patches?: readonly MaterialPatch[];
  paths?: readonly DiagramPath[];
  labels?: readonly DiagramLabel[];
}
export interface ConstructionFrame {
  stage: number;
  phase: 'move' | 'hold';
  panels: readonly DiagramPanel[];
  formula: string;
  explanation: string;
  result?: number;
}
export interface ConstructionPlan {
  encoding: 'construction';
  stages: number;
  result: number;
  sample(progress: number): ConstructionFrame;
}
export type ConstructionOperation = { kind: 'construction' } & (
  | { model: 'distribute'; a: number; b: number; c: number }
  | { model: 'linear'; matrix: Matrix2 }
  | { model: 'projection'; angle: number }
  | { model: 'derivative'; fn: ScalarFunction; at: number; span?: number; label?: string }
  | { model: 'integral'; fn: ScalarFunction; from: number; to: number; label?: string }
  | { model: 'spring'; mass: number; stiffness: number; amplitude: number }
  | {
      model: 'deform';
      domain: DiagramBounds;
      /** Known range of the map in mathematical coordinates; keeps complex motion framed steadily. */
      bounds?: DiagramBounds;
      parameter: readonly [number, number];
      map(point: DiagramPoint, parameter: number): DiagramPoint;
      grid?: readonly [number, number];
      text?: string;
      label?: string;
    }
);
export interface ConstructionModel {
  stages: number;
  result: number;
  sample(stage: number, motion: number): Omit<ConstructionFrame, 'stage' | 'phase' | 'result'>;
}
