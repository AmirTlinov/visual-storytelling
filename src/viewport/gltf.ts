import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import wrapper from 'three/addons/libs/draco/gltf/draco_wasm_wrapper.js?url';
import wasm from 'three/addons/libs/draco/gltf/draco_decoder.wasm?url';

/** Pinned Three decoders travel with the scene, including its offline HTML. */
export function gltfLoader() {
  const draco = new DRACOLoader();
  // r186 accepts explicit URLs; @types/three still describes the older directory-only overload.
  (draco.setDecoderPath as unknown as (urls: { js: string; wasm: string }) => DRACOLoader)({ js: wrapper, wasm });
  draco.setWorkerLimit(2);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  return { loader, dispose: () => draco.dispose() };
}
