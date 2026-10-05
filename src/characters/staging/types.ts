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
  /** Drawable plane in local metres, reading order TL, TR, BR, BL. Boards supply an inset. */
  surface?: {
    corners?: readonly [GroundPoint, GroundPoint, GroundPoint, GroundPoint];
    theme?: 'light' | 'dark';
  };
  kind:
    | 'chair'
    | 'bench'
    | 'book'
    | 'table'
    | 'board'
    | 'tree'
    | 'lamp'
    | 'door'
    | 'stairs'
    | 'prop';
  at: GroundPoint;
  scale?: number;
  color?: string;
  /** Portable vector artwork in local drawing units, origin at its resting contact. */
  art?: {
    svg: string;
    activeSvg?: string;
    width: number;
    height: number;
    grip: { x: number; y: number };
  };
  /** Surface height in metres. Chairs, benches and tables provide defaults. */
  support?: { height: number };
  /** Local seat offsets. A bench provides two places by default. */
  seats?: readonly GroundPoint[];
  /** Local physical control and its deterministic state change. */
  trigger?: { at: GroundPoint; initial?: number; effect: 'toggle' | 'on' | 'off' };
  /** Initial door opening, 0 closed to 1 open. */
  open?: number;
  /** An entrance includes its wall and room; colors change without changing contacts. */
  facade?: { wall?: string; inside?: string };
}
export interface Staging {
  projection: Projection;
  spots: Readonly<Record<string, GroundPoint>>;
  objects: Readonly<Record<string, Furniture>>;
  /** Raised walkable surfaces. Ground level and prepared stair landings are implicit. */
  supports?: Readonly<Record<string, { at: GroundPoint; width: number; depth: number }>>;
  /** Authored relationships survive variants; resolved coordinates remain render-only data. */
  layout?: {
    objects: Readonly<Record<string, Omit<Furniture, 'at'> & { at: Destination }>>;
    spots: Readonly<Record<string, Destination>>;
  };
}
export interface RelativePlace {
  of: string;
  side: 'left' | 'right' | 'front' | 'back' | 'on' | 'inside' | 'outside' | 'landing';
  /** Local offset from the resolved contact, in metres. */
  offset?: GroundPoint;
  /** Clear distance from the physical edge, in metres. */
  gap?: number;
}
export type Destination = string | GroundPoint | RelativePlace;
export type StageAction =
  | { action: 'walk' | 'run' | 'flee'; actor: string; to: Destination; speed?: number }
  | { action: 'sit'; actor: string; seat: string; slot?: number }
  | { action: 'read'; actor: string; seat?: string; book: string; pages?: number }
  | { action: 'stand'; actor: string }
  | { action: 'take'; actor: string; object: string; hand?: 'left' | 'right' }
  | { action: 'put'; actor: string; onto: string }
  | { action: 'openDoor' | 'closeDoor'; actor: string; door: string }
  | {
      action: 'passDoor';
      actor: string;
      door: string;
      to: 'inside' | 'outside';
      gait?: 'walk' | 'run';
    }
  | { action: 'climb' | 'descend'; actor: string; stairs: string }
  | { action: 'turn'; actor: string; facing: Facing }
  | { action: 'openBook' | 'closeBook'; actor: string; book: string }
  | { action: 'point'; actor: string; target: Destination; hand?: 'left' | 'right' }
  | { action: 'press'; actor: string; target: Destination }
  | { action: 'look'; actor: string; target: Destination }
  | { action: 'mood'; actor: string; name: string }
  | { action: 'highFive' | 'handTap'; actors: readonly [string, string] }
  | { action: 'walkTogether'; actors: readonly [string, string]; to: Destination };
export type ActionChannel = 'locomotion' | 'left-hand' | 'right-hand' | 'gaze' | 'expression';
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
  /** Whole head pivot for a gaze independent of locomotion. */
  head?: string;
  /** Measured neutral face silhouette for each skin, including breathing. */
  faceBounds?: Record<string, { left: number; right: number; bottom: number; top: number }>;
  arms: Record<'left' | 'right', { upper: string; lower: string }>;
  /** Compiled native units relative to the standing support, including breathing clearance. */
  reach?: Record<
    'left' | 'right',
    {
      shoulder: { x: number; height: number };
      min: number;
      max: number;
    }
  >;
  feet: Record<'left' | 'right', string>;
  legs: Record<'left' | 'right', { upper: string; lower: string }>;
  faceSlots: readonly string[];
  frontArms: readonly string[];
  bodySlot: string;
}
