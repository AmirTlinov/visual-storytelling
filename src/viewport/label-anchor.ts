import { Object3D, Vector3 } from './engine.js';

/** Object positions are local; a standalone function supplies an independent world point. */
export type LabelAnchor =
  | Object3D
  | (() => Vector3)
  | { readonly object: Object3D; readonly position: Vector3 | (() => Vector3) };

/** One attachment supplies projection, inherited semantics and the inscription transform. */
export function resolveLabelAnchor(anchor: LabelAnchor) {
  const object =
    typeof anchor === 'function' ? undefined : anchor instanceof Object3D ? anchor : anchor.object;
  const local = () => {
    if (typeof anchor === 'function') return anchor().clone();
    if (anchor instanceof Object3D) return new Vector3();
    return (typeof anchor.position === 'function' ? anchor.position() : anchor.position).clone();
  };
  return {
    object,
    local,
    world() {
      const point = local();
      object?.localToWorld(point);
      return point;
    },
  };
}
