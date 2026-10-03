import { Matrix4, Quaternion, Vector3, type Mesh } from 'three';

/** Preserve the complete authored transform, including non-uniformly scaled ancestors. */
export function meshPose(mesh: Mesh) {
  mesh.updateWorldMatrix(true, false);
  const basis = mesh.matrixWorld.clone().setPosition(0, 0, 0);
  const automatic = mesh.matrixAutoUpdate;
  const parent = new Matrix4(),
    position = new Vector3(),
    rotation = new Quaternion();
  const unit = new Vector3(1, 1, 1);
  mesh.matrixAutoUpdate = false;
  return {
    update(
      p: { x: number; y: number; z: number },
      q: { x: number; y: number; z: number; w: number },
    ) {
      position.set(p.x, p.y, p.z);
      rotation.set(q.x, q.y, q.z, q.w);
      mesh.matrix.compose(position, rotation, unit).multiply(basis);
      if (mesh.parent) {
        mesh.parent.updateWorldMatrix(true, false);
        mesh.matrix.premultiply(parent.copy(mesh.parent.matrixWorld).invert());
      }
      mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.matrixWorldNeedsUpdate = true;
    },
    dispose() {
      const composed = new Matrix4().compose(mesh.position, mesh.quaternion, mesh.scale);
      // A stretched ancestor can leave shear that position/quaternion/scale cannot retain.
      mesh.matrixAutoUpdate =
        automatic &&
        mesh.matrix.elements.every((value, index) => {
          const candidate = composed.elements[index]!;
          return (
            Math.abs(value - candidate) <= 1e-10 * Math.max(1, Math.abs(value), Math.abs(candidate))
          );
        });
    },
  };
}
