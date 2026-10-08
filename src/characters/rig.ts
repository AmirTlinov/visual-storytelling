import {
  AnimationClip,
  Bone,
  LoadingManager,
  NumberKeyframeTrack,
  MeshBasicMaterial,
  SkinnedMesh,
  SRGBColorSpace,
  Texture,
  Vector3,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { CharacterPack } from './types.js';
import type { FrameBox } from './staging/camera.js';

/** GLTFLoader owns the format; Three samples appearance tracks stored in glTF extras. */
export async function readCharacter(
  pack: CharacterPack,
  { textures = true, signal }: { textures?: boolean; signal?: AbortSignal } = {},
) {
  signal?.throwIfAborted();
  const source = JSON.parse(pack.gltf);
  if (!textures) {
    for (const material of source.materials ?? [])
      delete material.pbrMetallicRoughness?.baseColorTexture;
    delete source.images;
    delete source.textures;
  }
  const manager = new LoadingManager(),
    abort = () => manager.abort();
  let gltf: GLTF | undefined,
    pages: Texture[] = [];
  const dispose = () => {
    const geometry = new Set<SkinnedMesh['geometry']>(),
      materials = new Set<MeshBasicMaterial>(),
      maps = new Set<Texture>();
    gltf?.scene.traverse((node) => {
      if (!(node instanceof SkinnedMesh)) return;
      geometry.add(node.geometry);
      materials.add(node.material as MeshBasicMaterial);
      const map = (node.material as MeshBasicMaterial).map;
      if (map) maps.add(map);
    });
    for (const item of geometry) item.dispose();
    for (const item of materials) item.dispose();
    const textures = new Set([...maps, ...pages]);
    const images = new Set([...textures].map((texture) => texture.image));
    for (const map of textures) map.dispose();
    for (const image of images)
      if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close();
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    gltf = await new GLTFLoader(manager).parseAsync(JSON.stringify(source), '');
    signal?.throwIfAborted();
    const loaded: (Texture | null)[] = textures ? await gltf.parser.getDependencies('texture') : [];
    pages = loaded.filter((page): page is Texture => page !== null);
    signal?.throwIfAborted();
    if (pages.length !== loaded.length)
      throw new Error(`Character pack ${pack.id}: artwork failed to load`);
    for (const page of pages) page.colorSpace = SRGBColorSpace;
    const clips = gltf.animations.map(
      (clip, index) =>
        new AnimationClip(clip.name, clip.duration, [
          ...clip.tracks,
          ...(source.animations[index].extras?.tracks ?? []).map(
            (track: {
              name: string;
              times: number[];
              values: number[];
              interpolation: import('three').InterpolationModes;
            }) =>
              new NumberKeyframeTrack(track.name, track.times, track.values, track.interpolation),
          ),
        ]),
    );
    gltf.scene.traverse((node) => {
      if (!(node instanceof SkinnedMesh)) return;
      node.frustumCulled = false;
      const material = node.material as MeshBasicMaterial;
      material.depthTest = false;
      material.depthWrite = false;
      material.toneMapped = false;
    });
    return { object: gltf.scene, clips, pages, dispose };
  } catch (error) {
    dispose();
    signal?.throwIfAborted();
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}
export type CharacterData = Awaited<ReturnType<typeof readCharacter>>;
export type CharacterMesh = SkinnedMesh<import('three').BufferGeometry, MeshBasicMaterial>;
export const boneLength = (bone: Bone) => Number(bone.userData.length ?? 0);

/** Drawn skinned vertices are the source for full-body and detail framing. */
export function meshBounds(
  meshes: readonly CharacterMesh[],
  height: number,
  bones?: ReadonlySet<number>,
): FrameBox | undefined {
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity;
  const vertex = new Vector3();
  for (const mesh of meshes) {
    if (mesh.material.opacity <= 0) continue;
    const joints = mesh.geometry.getAttribute('skinIndex'),
      weights = mesh.geometry.getAttribute('skinWeight');
    for (let i = 0; i < mesh.geometry.getAttribute('position').count; i++) {
      if (
        bones &&
        ![0, 1, 2, 3].some(
          (j) => weights.getComponent(i, j) > 0 && bones.has(joints.getComponent(i, j)),
        )
      )
        continue;
      mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrixWorld);
      left = Math.min(left, vertex.x);
      right = Math.max(right, vertex.x);
      top = Math.min(top, height - vertex.y);
      bottom = Math.max(bottom, height - vertex.y);
    }
  }
  return Number.isFinite(left)
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : undefined;
}
