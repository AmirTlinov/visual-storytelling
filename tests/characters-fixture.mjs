import { readCharacter } from '../dist/characters/rig.js';

globalThis.ProgressEvent ??= class ProgressEvent extends Event {
  constructor(type, init = {}) {
    super(type);
    Object.assign(this, init);
  }
};
export const characterData = (pack) => readCharacter(pack, { textures: false });
export const characterPose = (actor) => ({
  bones: [...actor.bones.values()].map((bone) => bone.matrixWorld.toArray()),
  drawings: actor.meshes.map((mesh) => [
    mesh.userData.slot,
    mesh.userData.artwork,
    mesh.material.opacity,
    mesh.renderOrder,
  ]),
});
