import {
  BackSide,
  Box3,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  LineBasicMaterial,
  LineSegments,
  Sphere,
  Vector3,
  type Object3D,
} from 'three';
import { volumeContour } from './contour.js';
import type { Viewport3D } from '../three.js';
import {
  volumeBox,
  volumeCapsule,
  volumeField,
  volumeSphere,
  type VolumeField,
  type VolumeFrame,
} from './field.js';

export interface VolumeMorphOptions {
  /** Fixed sampling bounds, including all poses and the contact bridge. */
  bounds: Box3;
  resolution?: number;
  pigment?: string;
}

/** The story supplies deterministic frames; this component owns their surface and ink. */
function mount(view: ReturnType<typeof Viewport3D.mount>, options: VolumeMorphOptions) {
  const resolution = options.resolution ?? 56;
  if (!Number.isInteger(resolution) || resolution < 16 || resolution > 128)
    throw new Error('Volume resolution must be an integer between 16 and 128');
  const size = options.bounds.getSize(new Vector3()),
    center = options.bounds.getCenter(new Vector3());
  if (
    [size.x, size.y, size.z].some((n) => !Number.isFinite(n) || n <= 0) ||
    !Number.isFinite(center.length())
  )
    throw new Error('Volume bounds must be finite and non-empty');
  const pigment = options.pigment ?? 'blue';
  const paper = { value: new Color() };
  const material = view.ink(
    new MeshBasicMaterial({ polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
    (palette) => {
      paper.value.copy(palette.surface!);
      return palette[pigment]!;
    },
  );
  // Fixed pigment washes on each face, matching the numbered teaching cubes.
  // The face color stays with the object when the camera moves.
  material.onBeforeCompile = (shader) => {
    shader.uniforms.volumePaper = paper;
    shader.vertexShader = 'varying vec3 volumeNormal;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvolumeNormal = normal;',
    );
    shader.fragmentShader =
      'uniform vec3 volumePaper; varying vec3 volumeNormal;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
       vec3 n = normalize(volumeNormal), w = abs(n);
       float wash = dot(w, vec3(n.x > 0. ? .88 : 1., n.y > 0. ? .82 : 1., n.z > 0. ? .93 : .85)) / (w.x + w.y + w.z);
       diffuseColor.rgb = mix(volumePaper, diffuseColor.rgb, .65 * wash);`,
    );
  };
  const contour = volumeContour(options.bounds.min.toArray(), size.toArray(), resolution);
  contour.geometry.boundingBox = options.bounds.clone();
  contour.geometry.boundingSphere = new Sphere(center, size.length() * 0.5);
  contour.outline.boundingBox = contour.geometry.boundingBox;
  contour.outline.boundingSphere = contour.geometry.boundingSphere;
  const mesh = new Mesh(contour.geometry, material);
  const outlineMaterial = view.ink(
    new MeshBasicMaterial({ side: BackSide, transparent: true, opacity: 0.45 }),
    'ink',
  );
  outlineMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\ntransformed += normalize(normal) * .006;',
    );
  };
  const outline = new Mesh(mesh.geometry, outlineMaterial);
  const edgeMaterial = view.ink(
    new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5 }),
    'ink',
  );
  const creases = new LineSegments(contour.outline, edgeMaterial);
  const object = new Group();
  object.add(mesh, outline, creases);
  let field: ReturnType<typeof volumeField> | undefined,
    previous = '',
    disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    object.removeFromParent();
    mesh.geometry.dispose();
    contour.outline.dispose();
    edgeMaterial.dispose();
    material.dispose();
    outlineMaterial.dispose();
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
    setShapes(sources: readonly VolumeField[], target: VolumeField) {
      if (disposed) throw new Error('Volume morph has been disposed');
      field = volumeField(sources, target);
      previous = '';
    },
    render(frame: VolumeFrame) {
      if (disposed || !field) return;
      const key = JSON.stringify(frame);
      if (key === previous) return;
      field.update(frame);
      contour.update(field.distance);
      previous = key;
      view.invalidate();
    },
    get triangles() {
      return mesh.geometry.drawRange.count / 3;
    },
    dispose,
  };
}

export const VolumeMorph = { mount, box: volumeBox, sphere: volumeSphere, capsule: volumeCapsule };
export type { VolumeField, VolumeFrame, VolumePose, VolumePoint } from './field.js';
