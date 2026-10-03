import { world2D } from './world2d.js';
import { physicalInk } from './ink.js';
export const Physics2D = { create: world2D, ink: physicalInk };
export type { World2D, Body2D, Shape2D, BodyOptions2D, Vec2 } from './world2d.js';
export { PhysicsPlayer, physicalMaterials } from './index.js';
