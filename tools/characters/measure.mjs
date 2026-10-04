import {
  Skeleton,
  SkeletonJson,
  TextureAtlas,
  AtlasAttachmentLoader,
  MixFrom,
  Physics,
} from '@esotericsoftware/spine-webgl';

/** Reach belongs to the native rig. Artwork and character names do not change it. */
export function measureReach(json, atlasText, rig, skin) {
  const data = new SkeletonJson(
    new AtlasAttachmentLoader(new TextureAtlas(atlasText)),
  ).readSkeletonData(json);
  const skeleton = new Skeleton(data),
    clip = data.findAnimation(rig.views.front);
  if (!clip) throw new Error(`Missing neutral rig view: ${rig.views.front}`);
  skeleton.setSkin(skin);
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
    skeleton.setupPose();
    clip.apply(skeleton, -1, time, false, null, 1, MixFrom.setup, false, false, false);
    skeleton.updateWorldTransform(Physics.reset);
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
  return Object.fromEntries(
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
}
