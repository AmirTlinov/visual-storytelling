import { world3D } from './world3d.js';
import { physicalMeshes } from './mesh.js';
import { physicalVolume } from './morph-3d.js';
export const Physics3D = { create: world3D, meshes: physicalMeshes, morph: physicalVolume };
export type { World3D, Body3D, Shape3D, BodyOptions3D, Vec3 } from './world3d.js';
export { PhysicsPlayer, PhysicsReplay, physicalMaterials } from './index.js';

export type { MorphCollider3DOptions } from './morph-3d.js';
