import type { Object3D, Mesh, Material, InstancedMesh, InstancedBufferGeometry } from 'three';

/** A visual and its accessible description share their complete ancestor visibility. */
export function objectVisible(object: Object3D): boolean {
  for (let node: Object3D | null = object; node; node = node.parent)
    if (!node.visible) return false;
  return true;
}

export function objectWithin(object: Object3D, root: Object3D): boolean {
  for (let node: Object3D | null = object; node; node = node.parent) if (node === root) return true;
  return false;
}

const materialVisible = (material: Material | undefined) =>
  material?.visible && (!material.transparent || material.opacity > 0);

export function drawsGeometry(object: Object3D, materialIndex?: number): boolean {
  const { geometry, material } = object as Mesh;
  if (!geometry || !material) return false;
  const instances = object as InstancedMesh,
    instancedGeometry = geometry as InstancedBufferGeometry;
  if (
    (instances.isInstancedMesh && instances.count === 0) ||
    (instancedGeometry.isInstancedBufferGeometry && instancedGeometry.instanceCount === 0)
  )
    return false;
  const start = Math.max(0, geometry.drawRange.start),
    end = Math.min(
      geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0,
      geometry.drawRange.start + geometry.drawRange.count,
    );
  if (end <= start) return false;
  if (!Array.isArray(material)) return !!materialVisible(material);
  if (materialIndex !== undefined) return !!materialVisible(material[materialIndex]);
  return geometry.groups.some(
    (group) =>
      Math.min(end, group.start + group.count) > Math.max(start, group.start) &&
      materialVisible(material[group.materialIndex ?? 0]),
  );
}
