import type { Pigment } from '../../ink/palette.js';
import type { MathValue } from '../formula/types.js';

export type DiagramPoint = readonly [number, number] | readonly [number, number, number];
export type DiagramBounds = readonly [DiagramPoint, DiagramPoint];
export type ScalarFunction = string | ((x: number) => number);
export type Matrix2 = readonly [readonly [number, number], readonly [number, number]];
export interface DiagramCamera {
  /** Direction from the subject towards the viewer; mathematical coordinates, not pixels. */
  direction: readonly [number, number, number];
  up?: readonly [number, number, number];
}

/** Mathematical coordinates, never pixels. Material coordinates identify the same ink over time. */
export interface MaterialPatch {
  id: string;
  domain: DiagramBounds;
  map(point: DiagramPoint): DiagramPoint;
  pigment: Pigment;
  grid?: readonly [number, number];
  text?: string;
  opacity?: number;
  fill?: boolean;
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
  marks?: readonly { id: string; at: DiagramPoint; pigment?: Pigment; opacity?: number }[];
  space?: '2d' | '3d';
  camera?: DiagramCamera;
}
export interface ConstructionFrame {
  stage: number;
  phase: 'move' | 'hold';
  panels: readonly DiagramPanel[];
  formula: string;
  explanation: string;
  result?: MathValue;
}
export interface ConstructionPlan {
  encoding: 'construction';
  stages: number;
  result?: MathValue;
  sample(progress: number): ConstructionFrame;
}
export interface ConstructionModel {
  stages: number;
  result?: MathValue;
  sample(stage: number, motion: number): Omit<ConstructionFrame, 'stage' | 'phase' | 'result'>;
}
