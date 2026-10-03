import {
  BackSide,
  Box3,
  Group,
  Mesh,
  MeshBasicMaterial,
  Sphere,
  Vector3,
  type BufferAttribute,
  type Object3D,
} from 'three';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
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

/** Three owns triangulation and drawing; the story supplies deterministic frames. */
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
  const material = view.ink(new MeshBasicMaterial(), (palette) => {
    const paper = palette.surface!;
    return paper.clone().lerp(palette[pigment]!, paper.r + paper.g + paper.b < 1 ? 0.7 : 0.44);
  });
  // The same restrained face shading as the teaching cubes, continuous on curved surfaces.
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = 'varying vec3 volumeNormal;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvolumeNormal = normalize(normalMatrix * normal);',
    );
    shader.fragmentShader = 'varying vec3 volumeNormal;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      '#include <color_fragment>\nvec3 n = normalize(volumeNormal);\ndiffuseColor.rgb *= .55 + .45 * max(dot(n, normalize(vec3(-.45, .8, 1.))), 0.);',
    );
  };
  const capacity = resolution * resolution * 16;
  const mesh = new MarchingCubes(resolution, material, false, false, capacity);
  mesh.isolation = 0;
  mesh.geometry.setDrawRange(0, 0);
  mesh.position.copy(center);
  mesh.scale.copy(size).multiplyScalar(0.5);
  mesh.geometry.boundingBox = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
  mesh.geometry.boundingSphere = new Sphere(new Vector3(), Math.sqrt(3));
  const outlineMaterial = view.ink(
    new MeshBasicMaterial({ side: BackSide, transparent: true, opacity: 0.45 }),
    'ink',
  );
  outlineMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\ntransformed += normalize(normal) * .004;',
    );
  };
  const outline = new Mesh(mesh.geometry, outlineMaterial);
  outline.position.copy(mesh.position);
  outline.scale.copy(mesh.scale);
  const object = new Group();
  object.add(mesh, outline);
  const min = options.bounds.min;
  const xs = Float64Array.from({ length: resolution }, (_, i) => min.x + (i * size.x) / resolution);
  const ys = Float64Array.from({ length: resolution }, (_, i) => min.y + (i * size.y) / resolution);
  const zs = Float64Array.from({ length: resolution }, (_, i) => min.z + (i * size.z) / resolution);
  let field: ReturnType<typeof volumeField> | undefined,
    previous = '',
    disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    object.removeFromParent();
    mesh.geometry.dispose();
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
      mesh.normal_cache.fill(0);
      let at = 0;
      for (let z = 0; z < resolution; z++)
        for (let y = 0; y < resolution; y++)
          for (let x = 0; x < resolution; x++)
            mesh.field[at++] = -field.distance(xs[x]!, ys[y]!, zs[z]!);
      mesh.update();
      if (mesh.geometry.drawRange.count > capacity * 3)
        throw new Error('Volume surface exceeds the triangle budget; simplify the field');
      for (const name of ['position', 'normal']) {
        const attribute = mesh.geometry.getAttribute(name) as BufferAttribute;
        attribute.clearUpdateRanges();
        attribute.addUpdateRange(0, mesh.geometry.drawRange.count * 3);
      }
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
