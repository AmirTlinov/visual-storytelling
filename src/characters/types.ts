import type { CharacterSurface } from './surfaces.js';
import type { Script } from '../story/cues.js';
import type { BipedRig, Destination, Facing, Shot, StageAction, Staging } from './staging/types.js';

/** Stage coordinates: x right, y down; every position uses this one space. */
export interface Point {
  x: number;
  y: number;
}
export type Place = string | Point | { actor: string; anchor: string };
export interface CharacterPack {
  id: string;
  /** gzip JSON: { data: Spine skeleton JSON, atlas: string, textures: page-name → data URL }. */
  gzip: string;
  skins: readonly string[];
  /** pose is the reduced-motion frame and the settle/hold time for a non-looping action. */
  actions: Readonly<Record<string, { animation: string; loop?: boolean; pose?: number }>>;
  anchors: Readonly<Record<string, { bone: string; x: number; y: number }>>;
  /** Readable source and license notice. */
  credit: string;
  rig?: BipedRig;
  viewSkins?: Readonly<Record<string, Partial<Record<Facing, string>>>>;
}
export interface Actor {
  skin: string;
  at: Destination | Point;
  scale?: number;
  /** Mirror the whole rig, including attachments and anchors. */
  flip?: boolean;
  action?: string;
  /** Prepared prop already carried when the story begins. */
  holding?: string;
  /** Preferred hand for one-handed portable objects. */
  holdingHand?: 'left' | 'right';
}
export interface PropArt {
  /** Accessible name when the drawing is mounted as a physical live surface. */
  title?: string;
  /** Local SVG, with its contact point at (0,0). Source must be trusted authored artwork. */
  svg: string;
  /** Absolute drawing state. Physical controls supply a reserved `active` channel. */
  paint?(element: SVGGElement, values: Readonly<Record<string, number>>): void;
}
export interface Prop {
  art: PropArt;
  at: Place;
  scale?: number;
  layer?: 'back' | 'front';
  opacity?: number;
  values?: Readonly<Record<string, number>>;
}
export interface StageSet {
  width: number;
  height: number;
  /** Backdrop SVG children. Use $id in definition IDs to scope multiple mounted scenes. */
  svg: string;
  /** Extend the two backdrop planes when a responsive camera sees beyond the authored artwork. */
  backdrop?: { divide: number; above: string; below: string };
  spots: Readonly<Record<string, Point>>;
  props?: Readonly<Record<string, Prop>>;
  staging?: Staging;
}
export interface PropChange {
  at?: Place;
  opacity?: number;
  values?: Readonly<Record<string, number>>;
  /** The curved flight's height in stage units; endpoints stay attached to their owners. */
  arc?: number;
  /** Start at the named control's press contact in this beat, including approach and retiming. */
  on?: { press: string };
  /** Seconds after the cue starts, or after contact when on.press is set. */
  delay?: number;
  /** Transition duration; defaults to the rest of the cue. */
  over?: number;
}
export interface Beat {
  id: string;
  /** Omit to use the longest action's route and contact phases. */
  seconds?: number;
  text: string;
  title?: string;
  /** Omitted actors continue their last performance. */
  actors?: Readonly<Record<string, string>>;
  /** Flat props and physical drawings share value tracks. Omitted channels retain their value. */
  props?: Readonly<Record<string, PropChange>>;
  perform?: readonly StageAction[];
  shot?: Shot;
}
export interface CharacterStageOptions {
  /** Fill the host and fit shot subjects to its aspect. Omit to preserve the authored stage frame. */
  camera?: 'responsive';
  /** Live Ink drawings attached to prepared furniture; share the chapter time and values. */
  surfaces?: Readonly<Record<string, CharacterSurface>>;
  description?: string;
  pack: CharacterPack;
  set: StageSet;
  cast: Readonly<Record<string, Actor>>;
  props?: Readonly<Record<string, Prop>>;
  beats: readonly Beat[];
  /** Cue IDs match beat IDs. Natural actions finish inside each cue, then hold; seconds opts into fitting. */
  script?: Script;
  /** Crossfade between authored poses in seconds. */
  blend?: number;
  /** False hides scenery, shadows and resting props; items carried by the cast remain visible. */
  background?: boolean;
}
export interface CharacterStoryOptions extends CharacterStageOptions {
  title: string;
  description: string;
  audio?: HTMLAudioElement;
  /** Inspect any prepared beat using the same scene and model. Enabled by default. */
  explore?: boolean;
  /** Opt-in remembered playback position, shared with the host widget state. */
  remember?: string;
}
