import type { PerspectiveCamera } from 'three';
import { Vector3 } from '../viewport/engine.js';
import { project } from '../characters/staging/space.js';
import { notebookGeometry, notebookQuad } from '../characters/staging/notebook.js';
import type { NotebookSource } from './opening.js';
import type { FrameBox } from '../characters/staging/camera.js';

const phase = (p: number, a: number, b: number) => Math.max(0, Math.min(1, (p - a) / (b - a)));
const ease = (p: number) => p * p * (3 - 2 * p);
const mix = (a: number, b: number, p: number) => a + (b - a) * p;

/** The stage's pinhole projection, followed by a continuous orbit above its real notebook. */
export function notebookCamera(source: NotebookSource, progress: number) {
  const space = source.projection;
  const model = notebookGeometry(source.book, ease(phase(progress, 0.42, 0.76)));
  const projectCamera = (camera: PerspectiveCamera, width: number, height: number) => {
    const aspect = width / height;
    const silhouette = [model.front, model.page].flatMap((face) => notebookQuad(face, space));
    const left = Math.min(...silhouette.map((p) => p.x)),
      right = Math.max(...silhouette.map((p) => p.x));
    const top = Math.min(...silhouette.map((p) => p.y)),
      bottom = Math.max(...silhouette.map((p) => p.y));
    const closeWidth = Math.max(right - left, (bottom - top) * aspect) * 1.45;
    const fitted = (box: FrameBox) => {
      const w = Math.max(box.width, box.height * aspect),
        h = w / aspect;
      return {
        x: box.x + (box.width - w) / 2,
        y: box.y + (box.height - h) / 2,
        width: w,
        height: h,
      };
    };
    const room = fitted({ x: 0, y: 0, width: source.width, height: source.height });
    const close = {
      x: (left + right - closeWidth) / 2,
      y: (top + bottom - closeWidth / aspect) / 2,
      width: closeWidth,
      height: closeWidth / aspect,
    };
    const from = progress < 0.24 ? fitted(source.camera) : room,
      to = progress < 0.24 ? room : close;
    const travel = ease(phase(progress, progress < 0.24 ? 0 : 0.24, progress < 0.24 ? 0.24 : 0.64));
    const w = Math.exp(mix(Math.log(from.width), Math.log(to.width), travel));
    const weight =
      Math.abs(to.width - from.width) < 0.001 ? travel : (w - from.width) / (to.width - from.width);
    const frame = {
      x: mix(from.x + from.width / 2, to.x + to.width / 2, weight) - w / 2,
      y: mix(from.y + from.height / 2, to.y + to.height / 2, weight) - w / aspect / 2,
      width: w,
    };
    const content = model.content(aspect),
      target = content
        .reduce((a, p) => a.add(new Vector3(p.x, p.height ?? 0, -p.z)), new Vector3())
        .multiplyScalar(0.25);
    const eyeHeight = (space.floor - space.horizon) / space.unit;
    const offset = new Vector3(-target.x, eyeHeight - target.y, space.distance - target.z),
      radius = offset.length();
    const elevation = Math.asin(offset.y / radius),
      horizontal = Math.hypot(offset.x, offset.z);
    const orbit = ease(phase(progress, 0.68, 1)),
      angle = mix(elevation, Math.PI / 2, orbit);
    camera.position.set(
      target.x + (offset.x / horizontal) * radius * Math.cos(angle),
      target.y + radius * Math.sin(angle),
      target.z + (offset.z / horizontal) * radius * Math.cos(angle),
    );
    camera.rotation.set((-orbit * Math.PI) / 2, 0, 0);
    camera.updateMatrixWorld(true);
    const finalWidth = content[1].x - content[0].x;
    const focal = Math.exp(
      mix(
        Math.log((space.unit * space.distance * width) / w),
        Math.log((radius * width) / finalWidth),
        orbit,
      ),
    );
    camera.aspect = aspect;
    camera.fov = (2 * Math.atan(height / (2 * focal)) * 180) / Math.PI;
    // Page turns also use this camera; clipping must not depend on the preceding shot.
    camera.near = 0.01;
    camera.far = 1000;
    camera.updateProjectionMatrix();
    const initial = project(space, { x: target.x, z: -target.z, height: target.y });
    const x = mix(((initial.x - frame.x) * width) / w, width / 2, orbit),
      y = mix(((initial.y - frame.y) * width) / w, height / 2, orbit);
    const local = target.clone().applyMatrix4(camera.matrixWorldInverse),
      depth = -local.z;
    const cx = x - (focal * local.x) / depth,
      cy = y + (focal * local.y) / depth;
    camera.projectionMatrix.elements[8] = 1 - (2 * cx) / width;
    camera.projectionMatrix.elements[9] = (2 * cy) / height - 1;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  };
  return { model, project: projectCamera };
}
