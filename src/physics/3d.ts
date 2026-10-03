import { world3D } from './world3d.js';
import { physicalMeshes } from './mesh.js';
export const Physics3D = { create: world3D, meshes: physicalMeshes };
export type { World3D, Body3D, Shape3D, BodyOptions3D, Vec3 } from './world3d.js';
export { PhysicsPlayer, physicalMaterials } from './index.js';
