import { BufferGeometry, Float32BufferAttribute } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Join UV/normal seams for the solver, retaining a map to the original visual vertices. */
export function meshSurface(vertices: Float32Array, indices: Uint32Array) {
  const source = new BufferGeometry();
  source.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  source.setIndex([...indices]);
  const joined = mergeVertices(source, 1e-6);
  const triangles = new Uint32Array(joined.index!.array);
  const visualToPhysical = new Int32Array(vertices.length / 3).fill(-1);
  for (let i = 0; i < indices.length; i++) visualToPhysical[indices[i]!] = triangles[i]!;
  const positions = new Float32Array(joined.getAttribute('position').array);
  source.dispose();
  joined.dispose();
  return { vertices: positions, indices: triangles, visualToPhysical };
}
