import type { Point } from '../types.js';

/** Ground coordinates in metres: x right, z away from the camera, height above the ground. */
export interface GroundPoint {
  x: number;
  z: number;
  height?: number;
}
export interface Projection {
  horizon: number;
  floor: number;
  center: number;
  unit: number;
  distance: number;
}
export interface Projected extends Point {
  scale: number;
  depth: number;
}
export interface Furniture {
  kind: 'chair' | 'bench' | 'book' | 'table' | 'board' | 'tree' | 'lamp' | 'door' | 'stairs';
  at: GroundPoint;
  scale?: number;
  color?: string;
}
export interface Staging {
  projection: Projection;
  spots: Readonly<Record<string, GroundPoint>>;
  objects: Readonly<Record<string, Furniture>>;
}
export type Destination = string | GroundPoint;
export type StageAction =
  | { action: 'walk' | 'run' | 'flee'; actor: string; to: Destination }
  | { action: 'sit'; actor: string; seat: string }
  | { action: 'read'; actor: string; seat?: string; book: string; pages?: number }
  | { action: 'stand'; actor: string }
  | { action: 'take'; actor: string; object: string }
  | { action: 'put'; actor: string; onto: string }
  | { action: 'openDoor'; actor: string; door: string }
  | { action: 'climb'; actor: string; stairs: string }
  | { action: 'point' | 'press'; actor: string; target: Destination }
  | { action: 'highFive'; actors: readonly [string, string] }
  | { action: 'walkTogether'; actors: readonly [string, string]; to: Destination };
export interface Shot {
  focus: readonly string[];
  framing?: 'wide' | 'medium' | 'detail';
}
export type Facing = 'front' | 'left' | 'right' | 'back';
/** Semantic binding once per rig family. Scene authors never name a native bone. */
export interface BipedRig {
  /** Native shadow slot replaced by the prepared world's projected shadow. */
  shadow?: string;
  views: Record<Facing, string>;
  hips: string;
  torso: string;
  face: string;
  arms: Record<'left' | 'right', { upper: string; lower: string }>;
  feet: Record<'left' | 'right', string>;
  legs: Record<'left' | 'right', { upper: string; lower: string }>;
  faceSlots: readonly string[];
  frontArms: readonly string[];
  bodySlot: string;
}
