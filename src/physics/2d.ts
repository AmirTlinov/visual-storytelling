import { world2D } from './world2d.js';
import { physicalInk } from './ink.js';
import { physicalFusion } from './fusion.js';
import { physicalMorph2D } from './morph-2d.js';
export const Physics2D = {
  create: world2D,
  ink: physicalInk,
  fusion: physicalFusion,
  morph: physicalMorph2D,
};
export type { PhysicalFusionOptions } from './fusion.js';
export type { PhysicalMorph2DOptions, MorphSurface2D } from './morph-2d.js';
export type { World2D, Body2D, Shape2D, BodyOptions2D, Vec2 } from './world2d.js';
export { PhysicsPlayer, physicalMaterials } from './index.js';
