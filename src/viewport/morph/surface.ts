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
  Vector4,
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
import { prepareVolumePrograms, selectTopology, type VolumeTopology } from './prepare.js';
import { inkAtlas } from './ink-atlas.js';
import type { InkFieldFrame } from '../../ink/fusion/geometry.js';

export interface VolumeMorphOptions {
  /** Finite local bounds enclosing the forms, every pose and the contact blend. */
  bounds?: Box3;
  pigment?: string;
}

/** One field, one visible surface and one ink layer; the story only supplies its state. */
function mount(view: ReturnType<typeof Viewport3D.mount>, options: VolumeMorphOptions = {}) {
  const bounds = options.bounds?.clone() ?? new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
  const size = bounds.getSize(new Vector3()),
    center = bounds.getCenter(new Vector3());
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
    contactRadii: { value: new Float32Array(18) },
    planes: { value: new Float32Array(24) },
    groups: { value: new Int32Array(2) },
    groupCount: { value: 1 },
    planeCounts: { value: new Int32Array(1) },
    morph: { value: 0 },
    tension: { value: 0 },
    boundsMin: { value: bounds.min.clone() },
    boundsMax: { value: bounds.max.clone() },
    rayOrigin: { value: new Vector3() },
    clipMatrix: { value: new Matrix4() },
    paper: { value: paper },
    pigment: { value: pigment },
    ink: { value: ink },
    written: { value: false },
    inscription: { value: null as ReturnType<typeof inkAtlas>['texture'] | null },
    inkRegion: { value: new Vector4() },
    inkBand: { value: 1 },
    inkDetails: { value: false },
  };
  const material = view.ink(
    Object.assign(
      new ShaderMaterial({
        uniforms,
        defines: { SHAPE_COUNT: 2, SOURCE_COUNT: 1, GROUP_CAPACITY: 1 },
        vertexShader,
        fragmentShader,
        side: BackSide,
        // The solid and its inscriptions share the opaque pass and fragment depth.
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
  const corners = new BoxGeometry(1, 1, 1);
  const unitPositions = corners.attributes.position!.array.slice();
  corners.dispose();
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
    revision = 0,
    disposed = false;
  let atlas: ReturnType<typeof inkAtlas> | undefined;
  const changes = new Set<() => void>(),
    cleanups = new Set<() => void>(),
    prepared = new Set<string>();
  let lastInk: InkFieldFrame | undefined;
  const resetPrepared = () => {
    prepared.clear();
    if (lastInk) inscribe(lastInk);
  };
  view.renderer.domElement.addEventListener('webglcontextrestored', resetPrepared);
  function notify() {
    for (const listener of changes) listener();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const cleanup of cleanups) cleanup();
    changes.clear();
    cleanups.clear();
    prepared.clear();
    view.renderer.domElement.removeEventListener('webglcontextrestored', resetPrepared);
    object.removeFromParent();
    geometry.dispose();
    material.dispose();
    atlas?.dispose();
    unbind();
    offRemove();
    field = undefined;
    lastInk = undefined;
  }
  const unbind = view.onDispose(dispose);
  const offRemove = view.beforeRemove((root) => {
    for (let parent: Object3D | null = object; parent; parent = parent.parent)
      if (parent === root) {
        dispose();
        break;
      }
  });
  /** Ink is evaluated at each ray's actual hit, sharing the body's perspective and depth. */
  function inscribe(frame: InkFieldFrame) {
    if (disposed) return;
    lastInk = frame;
    uniforms.written.value =
      frame.marks.segments.length > 0 || frame.segments.some((data) => data.length > 0);
    if (uniforms.written.value) {
      atlas ??= inkAtlas(view.renderer);
      bounds.getSize(size);
      bounds.getCenter(center);
      const extent = Math.max(size.x, size.y);
      atlas.render(frame, new Vector4(center.x, center.y, extent, extent));
      uniforms.inscription.value = atlas.texture;
      uniforms.inkRegion.value.copy(atlas.region);
      uniforms.inkBand.value = atlas.band;
      uniforms.inkDetails.value = frame.details;
    }
    view.invalidate();
  }
  return {
    object,
    inscribe,
    /** Prepare known stages once, retaining Three's specialized programs on the same material. */
    prepare(stages: readonly VolumeTopology[]) {
      if (disposed) throw new Error('Volume morph has been disposed');
      if (
        stages.some(
          ({ sources, targets }) =>
            !Number.isSafeInteger(sources) ||
            sources < 1 ||
            !Number.isSafeInteger(targets) ||
            targets < 1,
        )
      )
        throw new Error('Each prepared stage needs positive source and target counts');
      const pending = new Map(stages.map((stage) => [`${stage.sources}:${stage.targets}`, stage]));
      for (const key of prepared) pending.delete(key);
      if (pending.size && prepareVolumePrograms(view, mesh, [...pending.values()]))
        for (const key of pending.keys()) prepared.add(key);
    },
    get geometry() {
      return field && previous ? { bounds, distance: field.distance, revision } : undefined;
    },
    get registration() {
      return field?.registration;
    },
    onChange(listener: () => void) {
      if (disposed) throw new Error('Volume morph has been disposed');
      changes.add(listener);
      return () => {
        changes.delete(listener);
      };
    },
    onDispose(listener: () => void) {
      if (disposed) throw new Error('Volume morph has been disposed');
      cleanups.add(listener);
      return () => {
        cleanups.delete(listener);
      };
    },
    setShapes(sources: readonly VolumeShape[], targets: readonly VolumeShape[]) {
      if (disposed) throw new Error('Volume morph has been disposed');
      field = volumeField(sources, targets);
      uniforms.kinds.value = field.kinds;
      uniforms.parameters.value = field.parameters;
      uniforms.transforms.value = field.transforms;
      uniforms.scales.value = field.scales;
      uniforms.contactRadii.value = field.contactRadii;
      uniforms.planes.value = field.planes;
      uniforms.groups.value = field.groups;
      uniforms.planeCounts.value = field.planeCounts;
      selectTopology(material, sources.length, targets.length);
      mesh.visible = false;
      uniforms.written.value = false;
      lastInk = undefined;
      previous = '';
      notify();
    },
    render(frame: VolumeFrame) {
      if (disposed || !field) return;
      const key = JSON.stringify(frame);
      if (key === previous) return;
      field.update(frame);
      if (!options.bounds) {
        bounds.copy(field.bounds);
        uniforms.boundsMin.value.copy(bounds.min);
        uniforms.boundsMax.value.copy(bounds.max);
        const positions = geometry.attributes.position!;
        // The finite ray-march proxy follows exactly the current field's bounds.
        bounds.getSize(size);
        bounds.getCenter(center);
        for (let i = 0; i < positions.count; i++)
          positions.setXYZ(
            i,
            unitPositions[i * 3]! * size.x + center.x,
            unitPositions[i * 3 + 1]! * size.y + center.y,
            unitPositions[i * 3 + 2]! * size.z + center.z,
          );
        positions.needsUpdate = true;
        geometry.computeBoundingSphere();
        geometry.computeBoundingBox();
      }
      uniforms.morph.value = field.morph;
      uniforms.tension.value = field.tension;
      uniforms.groupCount.value = field.groupCount;
      mesh.visible = true;
      previous = key;
      revision++;
      notify();
      view.invalidate();
    },
    dispose,
  };
}

export const VolumeMorph = { mount, box: volumeBox, sphere: volumeSphere, capsule: volumeCapsule };
export type { VolumeShape, VolumeFrame, VolumePose, VolumePoint } from './field.js';
