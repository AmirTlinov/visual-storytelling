import type { Object3D } from 'three';

/** A visual and its accessible description share their complete ancestor visibility. */
export function objectVisible(object: Object3D): boolean {
  for (let node: Object3D | null = object; node; node = node.parent)
    if (!node.visible) return false;
  return true;
}
