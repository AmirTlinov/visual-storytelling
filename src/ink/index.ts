export { pigments, color, theme } from './palette.js';
export type { Pigment, Theme } from './palette.js';
export { surface } from './surface.js';
export type { Surface, SurfaceOptions, Grid } from './surface.js';
export { object } from './object.js';
export type { InkObject } from './object.js';
export { pen, roundedRect } from './pen.js';
export type { Pen, Point, Fill, PenStyle } from './pen.js';
export { lettering } from './lettering.js';
export { paragraph } from './paragraph.js';
export type { Lettering, LetteringOptions } from './lettering.js';
export { InkFusion } from './fusion/surface.js';
export type {
  FusionShape,
  FusionPose,
  FusionFrame,
  FusionOptions,
  FusionGeometry,
} from './fusion/surface.js';
export type { FusionTextOptions } from './fusion/text.js';

export * from './marks.js';
export { SketchMotion } from './motion.js';
