import {
  AnimationClip,
  AnimationMixer,
  Bone,
  LoopOnce,
  MeshBasicMaterial,
  SkinnedMesh,
  Texture,
  Skeleton,
  Vector3,
} from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { ActionKey } from './score.js';
import type { Actor, CharacterPack, Point } from './types.js';
import { meshBounds, type CharacterData, type CharacterMesh } from './rig.js';
import { ease } from './staging/space.js';

/** Absolute clip sampling and staging share one bone graph. */
export function performance(
  data: CharacterData,
  pack: CharacterPack,
  actor: Actor,
  track: readonly ActionKey[],
  at: Point,
  height: number,
  blend = 0.22,
) {
  const object = clone(data.object),
    bones = new Map<string, Bone>(),
    meshes: CharacterMesh[] = [];
  object.traverse((node) => {
    if (node instanceof Bone) bones.set(node.name, node);
    if (node instanceof SkinnedMesh) {
      node.material = (node.material as MeshBasicMaterial).clone();
      meshes.push(node as CharacterMesh);
    }
  });
  const skeletons = new Map<string, Skeleton>();
  for (const mesh of meshes) {
    const key = mesh.skeleton.bones.map((bone) => bone.uuid).join(',');
    const shared = skeletons.get(key);
    if (
      shared &&
      shared.boneInverses.every((matrix, i) => matrix.equals(mesh.skeleton.boneInverses[i]!))
    ) {
      mesh.skeleton.dispose();
      mesh.skeleton = shared;
    } else skeletons.set(key, mesh.skeleton);
  }
  const rest = [...bones.values()].map((bone) => ({
    bone,
    position: bone.position.clone(),
    quaternion: bone.quaternion.clone(),
    scale: bone.scale.clone(),
  }));
  const mixer = new AnimationMixer(object),
    clips = new Map(data.clips.map((clip) => [clip.name, clip]));
  const textures = new Map<string, Texture>();
  let appearance: string | undefined;
  const changeAppearance = (id: string) => {
    if (appearance === id) return;
    const bindings = pack.appearances[id];
    if (!bindings) throw new Error(`Pack ${pack.id} is missing appearance: ${id}`);
    for (const mesh of meshes) {
      const art = mesh.userData.artwork as string,
        binding = bindings[art];
      if (!binding) throw new Error(`Appearance ${id} is missing drawing: ${art}`);
      if (!data.pages.length) continue;
      const key = `${id}:${art}`;
      let texture = textures.get(key);
      if (!texture) {
        texture = data.pages[binding.texture]!.clone();
        texture.offset.fromArray(binding.offset);
        texture.repeat.fromArray(binding.scale);
        texture.needsUpdate = true;
        textures.set(key, texture);
      }
      mesh.material.map = texture;
      mesh.material.needsUpdate = true;
    }
    appearance = id;
  };
  const faceBones = new Set<string>();
  const faceRoot = pack.rig && bones.get(pack.rig.face);
  faceRoot?.traverse((bone) => {
    if (bone !== faceRoot) faceBones.add(bone.name);
  });
  const faceMeshes = new Set(
    meshes
      .filter((mesh) => pack.rig?.faceSlots.includes(mesh.userData.slot))
      .map((mesh) => mesh.name),
  );
  const isFace = (name: string) =>
    faceBones.has(name.split('.')[0]!) || faceMeshes.has(name.split('.')[0]!);
  const faces = new Map(
    data.clips.map((clip) => [
      clip.name,
      new AnimationClip(
        `${clip.name}:face`,
        clip.duration,
        clip.tracks.filter((t) => isFace(t.name)),
      ),
    ]),
  );
  const bodies = new Map(
    data.clips.map((clip) => [
      clip.name,
      new AnimationClip(
        `${clip.name}:body`,
        clip.duration,
        clip.tracks.filter((t) => !isFace(t.name)),
      ),
    ]),
  );
  const definition = (id: string) => {
    const entry = pack.actions[id];
    if (!entry || !clips.has(entry.animation))
      throw new Error(`Pack ${pack.id} is missing action: ${id}`);
    return entry;
  };
  for (const key of track) definition(key.action);
  // Repeated actions inside a short transition need independent mixer actions.
  const trackClips = track.map((key, index) => {
    const clip = clips.get(definition(key.action).animation)!;
    return {
      full: new AnimationClip(`${clip.name}:key-${index}`, clip.duration, clip.tracks),
      body: new AnimationClip(
        `${clip.name}:key-${index}:body`,
        clip.duration,
        clip.tracks.filter((t) => !isFace(t.name)),
      ),
    };
  });
  function play(
    clip: AnimationClip,
    time: number,
    weight = 1,
    loop = false,
    pose?: number,
    reduced = false,
  ) {
    const action = mixer.clipAction(clip).reset();
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.paused = true;
    action.enabled = true;
    action.time = reduced
      ? Math.min(pose ?? 1.2, clip.duration)
      : loop && clip.duration > 0
        ? Math.max(0, time) % clip.duration
        : Math.min(Math.max(0, time), pose ?? clip.duration, clip.duration);
    action.setEffectiveWeight(weight);
    action.play();
  }
  const vector = new Vector3();
  const point = (bone: Bone, x = 0, y = 0) => {
    bone.localToWorld(vector.set(x, y, 0));
    return { x: vector.x, y: height - vector.y };
  };
  return {
    object,
    bones,
    meshes,
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
      changeAppearance(
        pose?.view ? (pack.viewSkins?.[actor.skin]?.[pose.view] ?? actor.skin) : actor.skin,
      );
      mixer.stopAllAction();
      for (const r of rest) {
        r.bone.position.copy(r.position);
        r.bone.quaternion.copy(r.quaternion);
        r.bone.scale.copy(r.scale);
      }
      for (const mesh of meshes) {
        mesh.material.opacity = 0;
        mesh.renderOrder = mesh.userData.slotIndex;
      }
      object.position.set(pose?.at.x ?? at.x, height - (pose?.at.y ?? at.y), 0);
      const scale = pose?.scale ?? actor.scale ?? 0.77;
      object.scale.set(scale * (actor.flip ? -1 : 1), scale, 1);
      const index = Math.max(
          0,
          track.findLastIndex((key) => key.start <= time),
        ),
        current = track[index]!;
      if (pose?.clip) {
        const clip = bodies.get(pose.clip);
        if (!clip) throw new Error(`Pack ${pack.id} is missing view: ${pose.clip}`);
        play(clip, time, 1, true, 0, reduced);
      } else {
        let remaining = 1;
        for (let i = index; i >= 0 && remaining > 1e-6; i--) {
          const key = track[i]!,
            entry = definition(key.action);
          const alpha = i === 0 || reduced || blend <= 0 ? 1 : ease((time - key.start) / blend);
          const clip = trackClips[i]![pose?.mood ? 'body' : 'full'];
          play(clip, time - key.start, remaining * alpha, entry.loop, entry.pose, reduced);
          remaining *= 1 - alpha;
        }
      }
      if (pose?.clip || pose?.mood) {
        const entry = definition(pose.mood ?? current.action);
        play(
          faces.get(entry.animation)!,
          pose.moodTime ?? time - current.start,
          1,
          entry.loop,
          entry.pose,
          reduced,
        );
      }
      mixer.update(0);
      object.updateMatrixWorld(true);
      return current.action;
    },
    point,
    hideSlot(name: string) {
      for (const mesh of meshes) if (mesh.userData.slot === name) mesh.material.opacity = 0;
    },
    orderedMeshes() {
      return meshes
        .filter((mesh) => mesh.material.opacity > 0)
        .sort((a, b) => a.renderOrder - b.renderOrder);
    },
    bounds() {
      return (
        meshBounds(meshes, height) ?? {
          x: object.position.x,
          y: height - object.position.y,
          width: 0,
          height: 0,
        }
      );
    },
    anchor(name: string): Point {
      const anchor = pack.anchors[name],
        bone = anchor && bones.get(anchor.bone);
      if (!bone) throw new Error(`Unknown character anchor: ${name}`);
      return point(bone, anchor.x, anchor.y);
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(object);
      for (const mesh of meshes) mesh.material.dispose();
      for (const skeleton of new Set(meshes.map((mesh) => mesh.skeleton))) skeleton.dispose();
      for (const texture of textures.values()) texture.dispose();
      object.removeFromParent();
    },
  };
}
export type CharacterPerformance = ReturnType<typeof performance>;
