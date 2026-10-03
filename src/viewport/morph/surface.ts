import {
  BackSide,
  Box3,
  BoxGeometry,
  Color,
  CustomBlending,
  Group,
  Matrix4,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  SrcAlphaFactor,
  Vector3,
  type Object3D,
} from 'three';
import type { Viewport3D } from '../three.js';
import {
  volumeBox,
  volumeCapsule,
  volumeField,
  volumeSphere,
  type VolumeFrame,
  type VolumeShape,
} from './field.js';
import { vertexShader, fragmentShader } from './shader.js';

export interface VolumeMorphOptions {
  /** Finite local bounds enclosing the forms, every pose and the contact blend. */
  bounds: Box3;
  pigment?: string;
}

/** One field, one visible surface and one ink layer; the story only supplies its state. */
function mount(view: ReturnType<typeof Viewport3D.mount>, options: VolumeMorphOptions) {
  const size = options.bounds.getSize(new Vector3()),
    center = options.bounds.getCenter(new Vector3());
  if (
    [size.x, size.y, size.z].some((n) => !Number.isFinite(n) || n <= 0) ||
    !Number.isFinite(center.length())
  )
    throw new Error('Volume bounds must be finite and non-empty');
  const pigment = new Color(),
    paper = new Color(),
    ink = new Color();
  const uniforms = {
    kinds: { value: new Int32Array(2) },
    parameters: { value: new Float32Array(8) },
    transforms: { value: new Float32Array(32) },
    scales: { value: new Float32Array(2) },
    planes: { value: new Float32Array(24) },
    planeCount: { value: 0 },
    morph: { value: 0 },
    tension: { value: 0 },
    boundsMin: { value: options.bounds.min.clone() },
    boundsMax: { value: options.bounds.max.clone() },
    rayOrigin: { value: new Vector3() },
    clipMatrix: { value: new Matrix4() },
    paper: { value: paper },
    pigment: { value: pigment },
    ink: { value: ink },
  };
  const material = view.ink(
    Object.assign(
      new ShaderMaterial({
        uniforms,
        defines: { SHAPE_COUNT: 2 },
        vertexShader,
        fragmentShader,
        side: BackSide,
        // Keep the field in the opaque pass, before transparent surface lettering.
        // Only the subpixel silhouette has partial coverage.
        blending: CustomBlending,
        blendSrc: SrcAlphaFactor,
        blendDst: OneMinusSrcAlphaFactor,
        blendSrcAlpha: OneFactor,
        blendDstAlpha: OneMinusSrcAlphaFactor,
        depthWrite: true,
      }),
      { color: pigment },
    ),
    (palette) => {
      paper.copy(palette.surface!);
      ink.copy(palette.ink!);
      return palette[options.pigment ?? 'blue']!;
    },
  );
  const geometry = new BoxGeometry(size.x, size.y, size.z).translate(center.x, center.y, center.z);
  const mesh = new Mesh(geometry, material),
    object = new Group();
  mesh.visible = false;
  object.add(mesh);
  const inverseWorld = new Matrix4();
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    inverseWorld.copy(mesh.matrixWorld).invert();
    uniforms.rayOrigin.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inverseWorld);
    uniforms.clipMatrix.value
      .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .multiply(mesh.matrixWorld);
  };
  let field: ReturnType<typeof volumeField> | undefined,
    previous = '',
    disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    object.removeFromParent();
    geometry.dispose();
    material.dispose();
    unbind();
    offRemove();
    field = undefined;
  }
  const unbind = view.onDispose(dispose);
  const offRemove = view.beforeRemove((root) => {
    for (let parent: Object3D | null = object; parent; parent = parent.parent)
      if (parent === root) {
        dispose();
        break;
      }
  });
  return {
    object,
    setShapes(sources: readonly VolumeShape[], target: VolumeShape) {
      if (disposed) throw new Error('Volume morph has been disposed');
      field = volumeField(sources, target);
      uniforms.kinds.value = field.kinds;
      uniforms.parameters.value = field.parameters;
      uniforms.transforms.value = field.transforms;
      uniforms.scales.value = field.scales;
      uniforms.planes.value = field.planes;
      if (material.defines.SHAPE_COUNT !== sources.length + 1) {
        material.defines.SHAPE_COUNT = sources.length + 1;
        material.needsUpdate = true;
      }
      mesh.visible = false;
      previous = '';
    },
    render(frame: VolumeFrame) {
      if (disposed || !field) return;
      const key = JSON.stringify(frame);
      if (key === previous) return;
      field.update(frame);
      uniforms.morph.value = field.morph;
      uniforms.tension.value = field.tension;
      uniforms.planeCount.value = field.planeCount;
      mesh.visible = true;
      previous = key;
      view.invalidate();
    },
    dispose,
  };
}

export const VolumeMorph = { mount, box: volumeBox, sphere: volumeSphere, capsule: volumeCapsule };
export type { VolumeShape, VolumeFrame, VolumePose, VolumePoint } from './field.js';
