import * as T from './engine.js';
import { localFaceCorners, type Face } from './label-faces.js';
import type { Camera } from 'three';

export interface SurfaceOptions {
  face?: Face | Face[];
  /** A physical inscription follows the anchor's full transform. */
  space?: 'world';
  /** Height in world units for a free inscription; face lettering fits the face. */
  height?: number;
  maxWidth?: number;
  tone?: string;
  visible?: () => boolean;
}
export type LabelAnchor = T.Object3D | (() => T.Vector3);
type Ink = (material: T.MeshBasicMaterial, tone: string) => T.MeshBasicMaterial;

/** Lettering is geometry: stable face attachment, perspective and ordinary depth occlusion. */
export function surfaceLettering(
  stage: HTMLElement,
  scene: T.Scene,
  text: string | (() => string),
  anchor: LabelAnchor,
  options: SurfaceOptions,
  ink: Ink,
  release: (object: T.Object3D) => void,
  invalidate: () => void,
) {
  const element = document.createElement('span');
  element.className = 've-surface-label';
  element.textContent = typeof text === 'function' ? text() : text;
  stage.append(element);
  const group = new T.Group();
  let removed = false;
  group.name = 'surface-lettering';
  group.userData.visualReview = () => ({
    text: element.textContent,
    anchor: typeof anchor === 'function' ? undefined : anchor.uuid,
    source: 'src/viewport/surface-lettering.ts',
  });
  if (typeof anchor === 'function') scene.add(group);
  else anchor.add(group);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  function createTexture() {
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }
  let texture = createTexture();
  const material = ink(
    new T.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      alphaTest: 0.02,
      // Separate ink from its supporting face in depth-buffer units at every camera distance.
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    }),
    options.tone ?? 'ink',
  );
  const faces = options.face ? (Array.isArray(options.face) ? options.face : [options.face]) : [];
  const planes: T.Mesh[] = [];
  const faceSizes: Array<[number, number]> = [];
  if (faces.length) {
    if (!(anchor instanceof T.Mesh)) throw new Error('A surface face label needs a Mesh anchor');
    for (const side of faces) {
      const corners = localFaceCorners(anchor, side);
      const across = corners[1]!.clone().sub(corners[0]!),
        up = corners[3]!.clone().sub(corners[0]!);
      const width = across.length(),
        height = up.length();
      faceSizes.push([width, height]);
      across.normalize();
      up.normalize();
      const normal = across.clone().cross(up);
      const plane = new T.Mesh(new T.PlaneGeometry(1, 1), material);
      plane.position
        .copy(corners.reduce((sum, p) => sum.add(p), new T.Vector3()).multiplyScalar(0.25))
        .addScaledVector(normal, Math.min(width, height) * 0.003);
      plane.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(across, up, normal));
      group.add(plane);
      planes.push(plane);
    }
  } else {
    const plane = new T.Mesh(new T.PlaneGeometry(1, 1), material);
    plane.position.z = 0.002;
    group.add(plane);
    planes.push(plane);
  }
  let previous = '',
    opacity = 1;
  const font = getComputedStyle(stage).fontFamily;
  function draw(value: string) {
    context.font = `112px ${font}`;
    const width = Math.max(32, Math.ceil(context.measureText(value).width + 16));
    if (canvas.width !== width || canvas.height !== 160) {
      // GPU texture storage cannot resize: replace it along with the canvas bounds.
      texture.dispose();
      canvas.width = width;
      canvas.height = 160;
      material.map = texture = createTexture();
    }
    context.font = `112px ${font}`;
    const aspect = canvas.width / canvas.height;
    planes.forEach((plane, index) => {
      const face = faceSizes[index];
      const height = face
        ? Math.min(face[1] * 0.62, (face[0] * 0.92) / aspect)
        : Math.min(options.height ?? 0.32, (options.maxWidth ?? Infinity) / aspect);
      plane.scale.set(height * aspect, height, 1);
    });
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#fff';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(value, canvas.width / 2, canvas.height / 2);
    texture.needsUpdate = true;
  }
  function update(camera: Camera) {
    if (typeof text === 'function') element.textContent = text();
    const value = element.textContent ?? '';
    if (value !== previous) {
      previous = value;
      draw(value);
    }
    group.visible = !!value && opacity > 0 && options.visible?.() !== false;
    if (typeof anchor === 'function') group.position.copy(anchor());
    group.updateWorldMatrix(true, true);
    let shown = group.visible;
    for (let node = group.parent; node; node = node.parent) if (!node.visible) shown = false;
    const eye = camera.getWorldPosition(new T.Vector3());
    element.hidden =
      !shown ||
      !planes.some((plane) => {
        const normal = new T.Vector3(0, 0, 1).transformDirection(plane.matrixWorld);
        return normal.dot(eye.clone().sub(plane.getWorldPosition(new T.Vector3()))) > 0;
      });
  }
  return {
    element,
    object: group,
    update,
    set(value: string) {
      text = value;
      element.textContent = value;
      invalidate();
    },
    show(value: boolean) {
      options.visible = () => value;
      invalidate();
    },
    opacity(value: number) {
      opacity = material.opacity = value;
      invalidate();
    },
    remove() {
      if (removed) return;
      removed = true;
      element.remove();
      release(group);
      group.removeFromParent();
      invalidate();
    },
  };
}
