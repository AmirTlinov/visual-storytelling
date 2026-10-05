import {
  Skeleton,
  SkeletonJson,
  TextureAtlas,
  AtlasAttachmentLoader,
  MixFrom,
  Physics,
  RegionAttachment,
  MeshAttachment,
} from '@esotericsoftware/spine-webgl';

/** Bake neutral reach and per-skin face clearance from the native rig. */
export function measureRig(json, atlasText, rig, skins) {
  const data = new SkeletonJson(
    new AtlasAttachmentLoader(new TextureAtlas(atlasText)),
  ).readSkeletonData(json);
  const skeleton = new Skeleton(data),
    clip = data.findAnimation(rig.views.front);
  if (!clip) throw new Error(`Missing neutral rig view: ${rig.views.front}`);
  const faceBones = new Set(
    skeleton.bones
      .filter((bone) => {
        for (let current = bone; current; current = current.parent)
          if (current.data.name === rig.face) return true;
        return false;
      })
      .map((bone) => bone.data.index),
  );
  const faceBounds = Object.fromEntries(
    skins.map((skin) => [
      skin,
      {
        left: Infinity,
        right: -Infinity,
        bottom: Infinity,
        top: -Infinity,
      },
    ]),
  );
  const arms = Object.fromEntries(
    Object.entries(rig.arms).map(([side, names]) => {
      const upper = skeleton.findBone(names.upper),
        lower = skeleton.findBone(names.lower);
      if (!upper || !lower) throw new Error(`Missing ${side} arm in the native rig`);
      return [side, { upper, lower, positions: [], min: 0, max: Infinity }];
    }),
  );
  const count = Math.max(1, Math.ceil(clip.duration * 60));
  const times = new Set(Array.from({ length: count + 1 }, (_, i) => (clip.duration * i) / count));
  // Include authored extrema as well as the smooth motion between keys.
  function keys(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.time === 'number') times.add(value.time);
    for (const child of Object.values(value)) keys(child);
  }
  keys(json.animations[rig.views.front]);
  for (const time of [...times].sort((a, b) => a - b)) {
    for (const skin of skins) {
      skeleton.setSkin(skin);
      skeleton.setupPose();
      clip.apply(skeleton, -1, time, false, null, 1, MixFrom.setup, false, false, false);
      skeleton.updateWorldTransform(Physics.reset);
      const vertices = [];
      for (const slot of skeleton.slots) {
        const pose = slot.appliedPose,
          attachment = pose.attachment;
        if (!slot.bone.active || pose.color.a <= 0 || !attachment) continue;
        const belongs = faceBones.has(slot.bone.data.index);
        if (attachment instanceof RegionAttachment && belongs) {
          const offsets = attachment.sequence.offsets?.[attachment.sequence.resolveIndex(pose)];
          if (offsets) attachment.computeWorldVertices(slot, offsets, vertices, vertices.length, 2);
        } else if (attachment instanceof MeshAttachment && (belongs || attachment.bones)) {
          const world = [];
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
            let bone = 0,
              weight = 0;
            for (let vertex = 0; bone < attachment.bones.length; vertex += 2) {
              const count = attachment.bones[bone++];
              let drawn = false;
              for (let i = 0; i < count; i++, weight += 3)
                if (faceBones.has(attachment.bones[bone++]) && attachment.vertices[weight + 2] > 0)
                  drawn = true;
              if (drawn) vertices.push(world[vertex], world[vertex + 1]);
            }
          }
        }
      }
      const bounds = faceBounds[skin];
      for (let i = 0; i < vertices.length; i += 2) {
        bounds.left = Math.min(bounds.left, vertices[i]);
        bounds.right = Math.max(bounds.right, vertices[i]);
        bounds.bottom = Math.min(bounds.bottom, vertices[i + 1]);
        bounds.top = Math.max(bounds.top, vertices[i + 1]);
      }
      if (skin !== skins[0]) continue;
      for (const arm of Object.values(arms)) {
        const a = arm.upper.appliedPose,
          b = arm.lower.appliedPose;
        const first = Math.hypot(b.worldX - a.worldX, b.worldY - a.worldY),
          second = arm.lower.data.length * Math.hypot(b.a, b.c);
        arm.positions.push({ x: a.worldX, height: a.worldY });
        arm.min = Math.max(arm.min, Math.abs(first - second));
        arm.max = Math.min(arm.max, first + second);
      }
    }
  }
  if (!Object.values(faceBounds).every((bounds) => Object.values(bounds).every(Number.isFinite)))
    throw new Error('The rig needs visible face artwork');
  const reach = Object.fromEntries(
    Object.entries(arms).map(([side, arm]) => {
      const shoulder = arm.positions[0];
      let excursion = 0,
        step = 0;
      for (const [i, p] of arm.positions.entries()) {
        excursion = Math.max(excursion, Math.hypot(p.x - shoulder.x, p.height - shoulder.height));
        if (i) {
          const previous = arm.positions[i - 1];
          step = Math.max(step, Math.hypot(p.x - previous.x, p.height - previous.height));
        }
      }
      // Reserve the native breathing excursion plus one sampling interval.
      const margin = excursion + step + 0.01,
        min = arm.min + margin,
        max = arm.max - margin;
      if (![shoulder.x, shoulder.height, min, max].every(Number.isFinite) || min >= max)
        throw new Error(`The ${side} arm has no stable reach in ${rig.views.front}`);
      return [side, { shoulder, min, max }];
    }),
  );
  return { reach, faceBounds };
}
