import { Bone } from 'three';
import type { CharacterPerformance } from './performance.js';
import { boneLength, meshBounds } from './rig.js';
import type { BipedRig } from './staging/types.js';
import type { FrameBox } from './staging/camera.js';

export const characterPartNames = ['face', 'hand-left', 'hand-right'] as const;
/** Detail shots follow the same weighted vertices that Three draws. */
export function characterDetails(
  actor: CharacterPerformance,
  rig: BipedRig | undefined,
  height: number,
): Record<string, FrameBox> {
  if (!rig || !actor.meshes.length) return {};
  const roots = {
    face: rig.face,
    'hand-left': rig.arms.left.lower,
    'hand-right': rig.arms.right.lower,
  };
  const result: Record<string, FrameBox> = {};
  const bones = actor.meshes[0]!.skeleton.bones;
  for (const id of characterPartNames) {
    const root = actor.bones.get(roots[id]);
    if (!root) continue;
    const descendants = new Set<number>();
    root.traverse((node) => {
      if (node instanceof Bone) descendants.add(bones.indexOf(node));
    });
    const bounds = meshBounds(actor.meshes, height, descendants);
    // Hidden artwork retains an addressable semantic camera anchor.
    result[id] = bounds ?? {
      ...actor.point(root, id === 'face' ? 0 : boneLength(root)),
      width: 0,
      height: 0,
    };
  }
  return result;
}
