import {
  RegionAttachment,
  MeshAttachment,
  type Skeleton,
  type Bone,
} from '@esotericsoftware/spine-webgl';
import type { BipedRig } from './staging/types.js';
import type { FrameBox } from './staging/camera.js';

export const characterPartNames = ['face', 'hand-left', 'hand-right'] as const;

/** Camera details follow the vertices actually drawn by the rig, including weighted meshes. */
export function characterDetails(
  skeleton: Skeleton,
  rig: BipedRig | undefined,
  height: number,
): Record<string, FrameBox> {
  if (!rig) return {};
  const roots = {
    face: rig.face,
    'hand-left': rig.arms.left.lower,
    'hand-right': rig.arms.right.lower,
  };
  const result: Record<string, FrameBox> = {};
  for (const id of characterPartNames) {
    const root = roots[id];
    const descendants = new Set<number>();
    for (const candidate of skeleton.bones)
      for (let bone: Bone | null = candidate; bone; bone = bone.parent)
        if (bone.data.name === root) {
          descendants.add(candidate.data.index);
          break;
        }
    const vertices: number[] = [];
    for (const slot of skeleton.slots) {
      const pose = slot.appliedPose,
        attachment = pose.attachment;
      if (!slot.bone.active || pose.color.a <= 0 || !attachment) continue;
      const belongs = descendants.has(slot.bone.data.index);
      if (attachment instanceof RegionAttachment && belongs) {
        const offsets = attachment.sequence.offsets?.[attachment.sequence.resolveIndex(pose)];
        if (offsets) attachment.computeWorldVertices(slot, offsets, vertices, vertices.length, 2);
      } else if (attachment instanceof MeshAttachment && (belongs || attachment.bones)) {
        const world: number[] = [];
        attachment.computeWorldVertices(
          skeleton,
          slot,
          0,
          attachment.worldVerticesLength,
          world,
          0,
          2,
        );
        if (!attachment.bones) vertices.push(...world);
        else {
          // Weighted arm meshes belong to a holder slot, while their visible
          // vertices follow the upper/lower bones. Inspect that binding directly.
          let bone = 0,
            weight = 0;
          for (let vertex = 0; bone < attachment.bones.length; vertex += 2) {
            const count = attachment.bones[bone++]!;
            let drawn = false;
            for (let i = 0; i < count; i++, weight += 3)
              if (
                descendants.has(attachment.bones[bone++]!) &&
                attachment.vertices[weight + 2]! > 0
              )
                drawn = true;
            if (drawn) vertices.push(world[vertex]!, world[vertex + 1]!);
          }
        }
      }
    }
    if (!vertices.length) {
      // Occlusion does not erase a semantic camera subject. Its native anchor
      // remains usable until visible artwork supplies an extent again.
      const bone = skeleton.findBone(root);
      if (!bone) continue;
      const pose = bone.appliedPose,
        length = id === 'face' ? 0 : bone.data.length;
      vertices.push(pose.worldX + pose.a * length, pose.worldY + pose.c * length);
    }
    let left = Infinity,
      right = -Infinity,
      top = Infinity,
      bottom = -Infinity;
    for (let i = 0; i < vertices.length; i += 2) {
      left = Math.min(left, vertices[i]!);
      right = Math.max(right, vertices[i]!);
      top = Math.min(top, height - vertices[i + 1]!);
      bottom = Math.max(bottom, height - vertices[i + 1]!);
    }
    result[id] = { x: left, y: top, width: right - left, height: bottom - top };
  }
  return result;
}
