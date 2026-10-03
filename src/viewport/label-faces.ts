import * as T from './engine.js';

export type Face = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

export function localFaceCorners(mesh: T.Mesh, side: Face) {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const { min: a, max: b } = mesh.geometry.boundingBox!;
  const faces = {
    front: [
      [a.x, a.y, b.z],
      [b.x, a.y, b.z],
      [b.x, b.y, b.z],
      [a.x, b.y, b.z],
    ],
    back: [
      [b.x, a.y, a.z],
      [a.x, a.y, a.z],
      [a.x, b.y, a.z],
      [b.x, b.y, a.z],
    ],
    right: [
      [b.x, a.y, b.z],
      [b.x, a.y, a.z],
      [b.x, b.y, a.z],
      [b.x, b.y, b.z],
    ],
    left: [
      [a.x, a.y, a.z],
      [a.x, a.y, b.z],
      [a.x, b.y, b.z],
      [a.x, b.y, a.z],
    ],
    top: [
      [a.x, b.y, b.z],
      [b.x, b.y, b.z],
      [b.x, b.y, a.z],
      [a.x, b.y, a.z],
    ],
    bottom: [
      [a.x, a.y, a.z],
      [b.x, a.y, a.z],
      [b.x, a.y, b.z],
      [a.x, a.y, b.z],
    ],
  };
  return faces[side].map((p) => new T.Vector3(p[0], p[1], p[2]));
}
