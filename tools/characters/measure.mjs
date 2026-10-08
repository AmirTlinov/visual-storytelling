import { AnimationMixer, Bone, NumberKeyframeTrack, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Three's browser loader also runs during the Node asset build.
globalThis.ProgressEvent ??= class ProgressEvent extends Event {
  constructor(type, init = {}) {
    super(type);
    Object.assign(this, init);
  }
};

/** Reach reserves the breathing excursion of the actual neutral clip. UV frames are shared by skins. */
export async function measureRig(source, rig, skins) {
  const json = structuredClone(source);
  for (const material of json.materials) delete material.pbrMetallicRoughness.baseColorTexture;
  delete json.textures;
  delete json.images;
  const data = await new GLTFLoader().parseAsync(JSON.stringify(json), '');
  const clip = data.animations.find((clip) => clip.name === rig.views.front);
  if (!clip) throw new Error(`Missing neutral rig view: ${rig.views.front}`);
  clip.tracks.push(
    ...source.animations
      .find((c) => c.name === clip.name)
      .extras.tracks.map(
        (track) =>
          new NumberKeyframeTrack(track.name, track.times, track.values, track.interpolation),
      ),
  );
  const bones = new Map(),
    meshes = [];
  data.scene.traverse((node) => {
    if (node instanceof Bone) bones.set(node.name, node);
    if (node instanceof SkinnedMesh) {
      node.material = node.material.clone();
      meshes.push(node);
    }
  });
  const face = new Set();
  bones.get(rig.face).traverse((bone) => face.add(bone));
  const arms = Object.fromEntries(
    Object.entries(rig.arms).map(([side, names]) => [
      side,
      {
        upper: bones.get(names.upper),
        lower: bones.get(names.lower),
        positions: [],
        min: 0,
        max: Infinity,
      },
    ]),
  );
  const mixer = new AnimationMixer(data.scene),
    action = mixer.clipAction(clip).play();
  action.paused = true;
  const bounds = { left: Infinity, right: -Infinity, bottom: Infinity, top: -Infinity },
    vertex = new Vector3(),
    end = new Vector3();
  const count = Math.max(1, Math.ceil(clip.duration * 60));
  for (let step = 0; step <= count; step++) {
    action.time = (clip.duration * step) / count;
    mixer.update(0);
    data.scene.updateMatrixWorld(true);
    for (const mesh of meshes) {
      if (mesh.material.opacity <= 0) continue;
      const indices = mesh.geometry.getAttribute('skinIndex'),
        weights = mesh.geometry.getAttribute('skinWeight');
      for (let i = 0; i < indices.count; i++) {
        if (
          ![0, 1, 2, 3].some(
            (j) =>
              weights.getComponent(i, j) > 0 &&
              face.has(mesh.skeleton.bones[indices.getComponent(i, j)]),
          )
        )
          continue;
        mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrixWorld);
        bounds.left = Math.min(bounds.left, vertex.x);
        bounds.right = Math.max(bounds.right, vertex.x);
        bounds.bottom = Math.min(bounds.bottom, vertex.y);
        bounds.top = Math.max(bounds.top, vertex.y);
      }
    }
    for (const arm of Object.values(arms)) {
      arm.upper.getWorldPosition(vertex);
      arm.lower.getWorldPosition(end);
      const first = vertex.distanceTo(end),
        x = end.x,
        y = end.y;
      arm.lower.localToWorld(end.set(arm.lower.userData.length, 0, 0));
      const second = Math.hypot(end.x - x, end.y - y);
      arm.positions.push({ x: vertex.x, height: vertex.y });
      arm.min = Math.max(arm.min, Math.abs(first - second));
      arm.max = Math.min(arm.max, first + second);
    }
  }
  const reach = Object.fromEntries(
    Object.entries(arms).map(([side, arm]) => {
      const shoulder = arm.positions[0];
      let excursion = 0,
        interval = 0;
      for (const [i, p] of arm.positions.entries()) {
        excursion = Math.max(excursion, Math.hypot(p.x - shoulder.x, p.height - shoulder.height));
        if (i)
          interval = Math.max(
            interval,
            Math.hypot(p.x - arm.positions[i - 1].x, p.height - arm.positions[i - 1].height),
          );
      }
      const margin = excursion + interval + 0.01,
        min = arm.min + margin,
        max = arm.max - margin;
      if (![shoulder.x, shoulder.height, min, max].every(Number.isFinite) || min >= max)
        throw new Error(`The ${side} arm has no stable reach`);
      return [side, { shoulder, min, max }];
    }),
  );
  mixer.stopAllAction();
  mixer.uncacheRoot(data.scene);
  const geometries = new Set(meshes.map((m) => m.geometry));
  for (const g of geometries) g.dispose();
  for (const m of meshes) m.material.dispose();
  if (!Object.values(bounds).every(Number.isFinite))
    throw new Error('The rig needs visible face drawings');
  return { reach, faceBounds: Object.fromEntries(skins.map((skin) => [skin, { ...bounds }])) };
}
