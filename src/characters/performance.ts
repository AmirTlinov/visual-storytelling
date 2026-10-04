import {
  Skeleton,
  SkeletonJson,
  TextureAtlas,
  AtlasAttachmentLoader,
  AnimationState,
  AnimationStateData,
  Interpolation,
  MixFrom,
  Physics,
  Vector2,
} from '@esotericsoftware/spine-webgl';
import type { SkeletonData } from '@esotericsoftware/spine-webgl';
import type { ActionKey } from './score.js';
import type { Actor, CharacterPack, Point } from './types.js';

export interface PackData {
  data: unknown;
  atlas: string;
  texture: string;
}
export async function unpackCharacter(pack: CharacterPack): Promise<PackData> {
  const bytes = Uint8Array.from(atob(pack.gzip), (c) => c.charCodeAt(0));
  return new Response(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
  ).json();
}
export function readSkeleton(source: PackData) {
  const atlas = new TextureAtlas(source.atlas);
  const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(source.data);
  return { atlas, data };
}
/** Random-access sampling: no accumulated delta, second clock or state left by a later frame. */
export function performance(
  data: SkeletonData,
  pack: CharacterPack,
  actor: Actor,
  track: readonly ActionKey[],
  at: Point,
  height: number,
  blend = 0.22,
) {
  const skeleton = new Skeleton(data);
  skeleton.setSkin(actor.skin);
  skeleton.x = at.x;
  skeleton.y = height - at.y;
  skeleton.scaleX = (actor.scale ?? 0.77) * (actor.flip ? -1 : 1);
  skeleton.scaleY = actor.scale ?? 0.77;
  const animations = new Map(
    track.map((key) => {
      const definition = pack.actions[key.action]!;
      const animation = data.findAnimation(definition.animation);
      if (!animation)
        throw new Error(`Pack ${pack.id} is missing animation: ${definition.animation}`);
      return [key.action, { ...definition, animation }];
    }),
  );
  const anchors = Object.fromEntries(
    Object.entries(pack.anchors).map(([name, anchor]) => {
      const bone = skeleton.findBone(anchor.bone);
      if (!bone) throw new Error(`Pack ${pack.id} is missing anchor bone: ${anchor.bone}`);
      return [name, { ...anchor, bone }];
    }),
  );
  const vector = new Vector2();
  const stateData = new AnimationStateData(data);
  stateData.defaultMix = blend;
  function apply(index: number, time: number, reduced: boolean): void {
    const current = animations.get(track[index]!.action)!;
    if (reduced) {
      current.animation.apply(
        skeleton,
        -1,
        Math.min(current.pose ?? 1.2, current.animation.duration),
        false,
        null,
        1,
        MixFrom.setup,
        false,
        false,
        false,
      );
      return;
    }
    // Reconstruct only the overlapping transitions. Spine owns channel mixing,
    // attachments and draw order; rebuilding the chain removes seek history.
    let first = index;
    if (blend > 0 && time - track[index]!.start < blend) {
      first = Math.max(0, index - 1);
      while (first > 0 && track[first + 1]!.start - track[first]!.start < blend) first--;
    }
    const state = new AnimationState(stateData);
    for (let i = first; i <= index; i++) {
      const key = track[i]!,
        entry = animations.get(key.action)!;
      const native = state.setAnimation(0, entry.animation, !!entry.loop);
      native.mixInterpolation = Interpolation.smooth;
      const until = i < index ? track[i + 1]!.start : Math.max(time, key.start);
      state.update(until - key.start);
      skeleton.setupPose();
      state.apply(skeleton);
    }
  }
  return {
    skeleton,
    sample(time: number, reduced = false) {
      if (!Number.isFinite(time)) throw new Error('Character time must be finite');
      skeleton.setupPose();
      const index = Math.max(
        0,
        track.findLastIndex((key) => key.start <= time),
      );
      apply(index, time, reduced);
      skeleton.updateWorldTransform(Physics.reset);
      return track[index]!.action;
    },
    anchor(name: string): Point {
      const anchor = anchors[name];
      if (!anchor) throw new Error(`Unknown character anchor: ${name}`);
      const world = anchor.bone.appliedPose.localToWorld(vector.set(anchor.x, anchor.y));
      return { x: world.x, y: height - world.y };
    },
  };
}
