import { world2D } from './world2d.js';
import { physicalInk } from './ink.js';
import { physicalFusion } from './fusion.js';
export const Physics2D = { create: world2D, ink: physicalInk, fusion: physicalFusion };
export type { PhysicalFusionOptions } from './fusion.js';
export type { World2D, Body2D, Shape2D, BodyOptions2D, Vec2 } from './world2d.js';
export { PhysicsPlayer, physicalMaterials } from './index.js';
