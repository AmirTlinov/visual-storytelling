import {
  Skeleton,
  Animation,
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
  textures: Record<string, string>;
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
  const sampleTime = (
    definition: Pick<CharacterPack['actions'][string], 'loop' | 'pose'>,
    animation: Animation,
    time: number,
    reduced: boolean,
  ) => {
    if (reduced) return Math.min(definition.pose ?? 1.2, animation.duration);
    return !definition.loop && definition.pose !== undefined
      ? Math.min(Math.max(0, time), definition.pose, animation.duration)
      : Math.max(0, time);
  };
  const stateData = new AnimationStateData(data);
  stateData.defaultMix = blend;
  const faceBones = new Set<number>();
  const faceRoot = pack.rig && skeleton.findBone(pack.rig.face);
  const collect = (bone: typeof faceRoot) => {
    if (!bone) return;
    faceBones.add(bone.data.index);
    for (const child of bone.children) collect(child);
  };
  if (faceRoot) for (const child of faceRoot.children) collect(child);
  const faceSlots = new Set(
    (pack.rig?.faceSlots ?? []).map((name) => skeleton.findSlot(name)?.data.index),
  );
  const faces = new Map(
    Object.entries(pack.actions).map(([id, definition]) => {
      const entry = { animation: data.findAnimation(definition.animation)! };
      return [
        id,
        new Animation(
          id + '-face',
          entry.animation.timelines.filter(
            (t) =>
              ('boneIndex' in t && faceBones.has(t.boneIndex as number)) ||
              ('slotIndex' in t && faceSlots.has(t.slotIndex as number)),
          ),
          entry.animation.duration,
        ),
      ] as const;
    }),
  );
  function apply(index: number, time: number, reduced: boolean): void {
    const current = animations.get(track[index]!.action)!;
    if (reduced) {
      current.animation.apply(
        skeleton,
        -1,
        sampleTime(current, current.animation, time, true),
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
      // Spine holds the authored settle frame while track/mix time keeps advancing.
      if (!entry.loop && entry.pose !== undefined)
        native.animationEnd = Math.min(entry.pose, entry.animation.duration);
      native.mixInterpolation = Interpolation.smooth;
      const until = i < index ? track[i + 1]!.start : Math.max(time, key.start);
      state.update(until - key.start);
      skeleton.setupPose();
      state.apply(skeleton);
    }
  }
  return {
    skeleton,
    sample(
      time: number,
      reduced = false,
      pose?: {
        at: Point;
        scale: number;
        clip?: string;
        mood?: string;
        moodTime?: number;
        view?: import('./staging/types.js').Facing;
      },
    ) {
      if (!Number.isFinite(time)) throw new Error('Character time must be finite');
      const skin = pose?.view
        ? (pack.viewSkins?.[actor.skin]?.[pose.view] ?? actor.skin)
        : actor.skin;
      if (skeleton.skin?.name !== skin) skeleton.setSkin(skin);
      skeleton.setupPose();
      skeleton.x = pose?.at.x ?? at.x;
      skeleton.y = height - (pose?.at.y ?? at.y);
      skeleton.scaleX = (pose?.scale ?? actor.scale ?? 0.77) * (actor.flip ? -1 : 1);
      skeleton.scaleY = pose?.scale ?? actor.scale ?? 0.77;
      const index = Math.max(
        0,
        track.findLastIndex((key) => key.start <= time),
      );
      if (pose?.clip) {
        const clip = data.findAnimation(pose.clip);
        if (!clip) throw new Error(`Pack ${pack.id} is missing view: ${pose.clip}`);
        clip.apply(
          skeleton,
          -1,
          reduced ? 0 : Math.max(0, time),
          true,
          null,
          1,
          MixFrom.setup,
          false,
          false,
          false,
        );
      } else apply(index, time, reduced);
      if (pose?.clip || pose?.mood) {
        const key = track[index]!,
          entry = pose.mood ? pack.actions[pose.mood]! : animations.get(key.action)!,
          face = faces.get(pose.mood ?? key.action)!;
        face.apply(
          skeleton,
          -1,
          sampleTime(entry, face, pose.moodTime ?? time - key.start, reduced),
          !reduced && !!entry.loop,
          null,
          1,
          MixFrom.setup,
          false,
          false,
          false,
        );
      }
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
