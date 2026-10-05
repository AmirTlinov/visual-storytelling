import {
  BoxGeometry,
  Light,
  Mesh,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector4,
  ShaderMaterial,
  UniformsUtils,
} from 'three';
import type { Viewport3D } from '../three.js';
import { volumeBox, volumeField } from './field.js';

export type VolumeTopology = { sources: number; targets: number };

export function selectTopology(material: ShaderMaterial, sources: number, targets: number) {
  if (
    material.defines.SHAPE_COUNT !== sources + targets ||
    material.defines.SOURCE_COUNT !== sources
  ) {
    material.defines.SHAPE_COUNT = sources + targets;
    material.defines.SOURCE_COUNT = sources;
    material.defines.GROUP_CAPACITY = Math.min(sources, targets);
    material.needsUpdate = true;
  }
}

/** Exercise the canvas pipeline; ordinary render targets compile a different color-space variant. */
export function prepareVolumePrograms(
  view: ReturnType<typeof Viewport3D.mount>,
  mesh: Mesh<BoxGeometry, ShaderMaterial>,
  stages: readonly VolumeTopology[],
) {
  const renderer = view.renderer,
    material = mesh.material;
  const saved = {
    target: renderer.getRenderTarget(),
    face: renderer.getActiveCubeFace(),
    level: renderer.getActiveMipmapLevel(),
    viewport: renderer.getViewport(new Vector4()),
    scissor: renderer.getScissor(new Vector4()),
    scissorTest: renderer.getScissorTest(),
    autoClear: renderer.autoClear,
    sources: Number(material.defines.SOURCE_COUNT),
    targets: Number(material.defines.SHAPE_COUNT) - Number(material.defines.SOURCE_COUNT),
  };
  const ratio = renderer.getPixelRatio(),
    buffer = renderer.getDrawingBufferSize(new Vector2()),
    region = saved.viewport;
  const left = Math.ceil(Math.max(0, region.x, saved.scissorTest ? saved.scissor.x : 0) * ratio),
    bottom = Math.ceil(Math.max(0, region.y, saved.scissorTest ? saved.scissor.y : 0) * ratio),
    right = Math.floor(
      Math.min(
        buffer.x,
        (region.x + region.z) * ratio,
        saved.scissorTest ? (saved.scissor.x + saved.scissor.z) * ratio : buffer.x,
      ),
    ),
    top = Math.floor(
      Math.min(
        buffer.y,
        (region.y + region.w) * ratio,
        saved.scissorTest ? (saved.scissor.y + saved.scissor.w) * ratio : buffer.y,
      ),
    );
  if (left >= right || bottom >= top) return false;
  const width = Math.min(8, right - left),
    height = Math.min(8, top - bottom);

  // A render target belongs to the live material. The compilation probe needs no drawing atlas.
  const { inscription: _atlas, ...probeUniforms } = material.uniforms;
  const geometry = new BoxGeometry(2, 2, 2),
    clone = new ShaderMaterial({
      vertexShader: material.vertexShader,
      fragmentShader: material.fragmentShader,
      uniforms: {
        ...UniformsUtils.clone(probeUniforms),
        inscription: { value: null },
        written: { value: false },
      },
      defines: { ...material.defines },
      side: material.side,
    }),
    probe = new Mesh(geometry, clone),
    scene = new Scene().copy(view.scene, false),
    camera = new PerspectiveCamera(36, 1, 0.1, 10),
    pixels = new Uint8Array(width * height * 4);
  scene.add(probe);
  view.scene.traverseVisible((object) => {
    if (object instanceof Light) scene.add(object.clone(false));
  });
  camera.layers.mask = view.camera.layers.mask;
  camera.position.z = 3;
  camera.updateMatrixWorld(true);
  let drawn = false;
  try {
    renderer.setRenderTarget(null);
    renderer.setViewport(left / ratio, bottom / ratio, width / ratio, height / ratio);
    renderer.setScissor(left / ratio, bottom / ratio, width / ratio, height / ratio);
    renderer.setScissorTest(true);
    renderer.autoClear = true;
    for (const { sources, targets } of stages) {
      // The working material retains this program before the temporary clone releases it.
      selectTopology(material, sources, targets);
      renderer.compile(mesh, view.camera, view.scene);
      selectTopology(clone, sources, targets);
      const box = volumeBox([1, 1, 1]),
        field = volumeField(Array(sources).fill(box), Array(targets).fill(box));
      field.update({
        sources: Array.from({ length: sources }, () => ({})),
        targets: Array.from({ length: targets }, () => ({})),
        morph: 0.5,
        tension: 0,
      });
      const uniforms = clone.uniforms;
      for (const key of [
        'kinds',
        'parameters',
        'transforms',
        'scales',
        'contactRadii',
        'planes',
        'groups',
        'groupBoundsMin',
        'groupBoundsMax',
        'blends',
        'planeCounts',
      ] as const)
        uniforms[key]!.value = field[key];
      uniforms.groupCount!.value = field.groupCount;
      uniforms.boundsMin!.value.copy(field.bounds.min);
      uniforms.boundsMax!.value.copy(field.bounds.max);
      uniforms.rayOrigin!.value.copy(camera.position);
      uniforms.clipMatrix!.value.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      );
      drawn = true;
      renderer.render(scene, camera);
      const gl = renderer.getContext();
      gl.readPixels(left, bottom, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    }
  } finally {
    selectTopology(material, saved.sources, saved.targets);
    renderer.setViewport(saved.viewport);
    renderer.setScissor(saved.scissor);
    renderer.setScissorTest(saved.scissorTest);
    renderer.autoClear = saved.autoClear;
    try {
      // Replace the probe synchronously; it must never become a presented scene frame.
      if (drawn) renderer.render(view.scene, view.camera);
    } finally {
      renderer.setRenderTarget(saved.target, saved.face, saved.level);
      geometry.dispose();
      clone.dispose();
    }
  }
  return true;
}
