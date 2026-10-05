import * as T from './engine.js';
import { localFaceCorners, type Face } from './label-faces.js';
import { objectVisible, objectWithin } from './visibility.js';
import { resolveLabelAnchor, type LabelAnchor } from './label-anchor.js';
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
  const attachment = resolveLabelAnchor(anchor);
  const faces = options.face ? (Array.isArray(options.face) ? options.face : [options.face]) : [];
  const faceAnchor = anchor instanceof T.Mesh ? anchor : undefined;
  if (faces.length && !faceAnchor) throw new Error('A surface face label needs a Mesh anchor');
  const element = document.createElement('span');
  element.className = 've-surface-label';
  element.textContent = typeof text === 'function' ? text() : text;
  stage.append(element);
  const group = new T.Group();
  let removed = false;
  group.name = 'surface-lettering';
  group.userData.visualReview = () => ({
    text: element.textContent,
    anchor: attachment.object?.uuid,
    source: 'src/viewport/surface-lettering.ts',
  });
  (attachment.object ?? scene).add(group);
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
  const planes: T.Mesh[] = [];
  const faceSizes: Array<[number, number]> = [];
  if (faces.length) {
    for (const side of faces) {
      const corners = localFaceCorners(faceAnchor!, side);
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
  function prepare() {
    if (typeof text === 'function') element.textContent = text();
    const value = element.textContent ?? '';
    if (value !== previous) {
      previous = value;
      draw(value);
    }
    group.visible = !!value && opacity > 0 && options.visible?.() !== false;
    if (!(anchor instanceof T.Object3D)) group.position.copy(attachment.local());
    group.updateWorldMatrix(true, true);
  }
  function update(camera: Camera) {
    prepare();
    const eye = camera.getWorldPosition(new T.Vector3());
    element.hidden =
      !objectWithin(group, scene) ||
      !objectVisible(group) ||
      !planes.some((plane) => {
        const normal = new T.Vector3(0, 0, 1).transformDirection(plane.matrixWorld);
        return normal.dot(eye.clone().sub(plane.getWorldPosition(new T.Vector3()))) > 0;
      });
  }
  return {
    element,
    object: group,
    prepare,
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
