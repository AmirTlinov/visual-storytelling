import { Box3, Vector3, type Object3D, type PerspectiveCamera } from './engine.js';
import { bounds, type Rect } from '../layout/geometry.js';
export const corners = (box: Box3) =>
  [...Array(8)].map(
    (_, i) =>
      new Vector3(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z,
      ),
  );
export function projectBox(
  object: Object3D,
  camera: PerspectiveCamera,
  width: number,
  height: number,
): Rect {
  object.updateWorldMatrix(true, true);
  return bounds(
    corners(new Box3().setFromObject(object)).map((v) => {
      v.project(camera);
      return { x: ((v.x + 1) * width) / 2, y: ((1 - v.y) * height) / 2 };
    }),
  );
}
export function isVisible(object: Object3D) {
  for (let o: Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}
