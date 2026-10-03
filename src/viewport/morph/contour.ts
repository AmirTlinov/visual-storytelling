import { BufferAttribute, BufferGeometry, DynamicDrawUsage } from 'three';
import type { VolumeField, VolumePoint } from './field.js';

// A vertex per crossing cell, fitted to the surface planes. Unlike averaging
// intersections, the fit retains the corners and creases of a box.
const corners = [0, 1, 2, 3, 4, 5, 6, 7];
const edges = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

export function volumeContour(min: VolumePoint, size: VolumePoint, resolution: number) {
  const n = resolution,
    row = n + 1,
    plane = row * row;
  const step = size.map((v) => v / n),
    epsilon = Math.min(...step) * 0.002;
  const samples = new Float32Array(row ** 3),
    cells = new Int32Array(n ** 3);
  // Four neighboring cells share each grid-edge intersection and its gradient.
  const gradients = new Float32Array(row ** 3 * 9);
  const sampled = new Uint8Array(row ** 3 * 3);
  const vertices = new Float64Array(n ** 3 * 3);
  const capacity = n * n * 16 * 3;
  const positions = new Float32Array(capacity * 3),
    normals = new Float32Array(capacity * 3);
  const lines = new Float32Array(capacity * 3),
    colors = new Float32Array(capacity * 4);
  const geometry = new BufferGeometry(),
    outline = new BufferGeometry();
  const position = new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage);
  const normal = new BufferAttribute(normals, 3).setUsage(DynamicDrawUsage);
  const line = new BufferAttribute(lines, 3).setUsage(DynamicDrawUsage);
  const color = new BufferAttribute(colors, 4).setUsage(DynamicDrawUsage);
  geometry.setAttribute('position', position).setAttribute('normal', normal).setDrawRange(0, 0);
  outline.setAttribute('position', line).setAttribute('color', color).setDrawRange(0, 0);
  const values = new Float64Array(8);
  // Matrix of the plane fit, its right-hand side, and the intersection centroid.
  const fit = new Float64Array(12);
  const adjacency = new Map<number, number>();
  const triangleNormal = new Float64Array(3);
  let count = 0,
    drawn = 0,
    stroked = 0;

  function triangle(a: number, b: number, c: number) {
    if (drawn + 3 > capacity)
      throw new Error('Volume surface exceeds the triangle budget; simplify the field');
    const ax = vertices[a * 3]!,
      ay = vertices[a * 3 + 1]!,
      az = vertices[a * 3 + 2]!;
    const ux = vertices[b * 3]! - ax,
      uy = vertices[b * 3 + 1]! - ay,
      uz = vertices[b * 3 + 2]! - az;
    const vx = vertices[c * 3]! - ax,
      vy = vertices[c * 3 + 1]! - ay,
      vz = vertices[c * 3 + 2]! - az;
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (length < 1e-12) {
      triangleNormal.fill(0);
      return;
    }
    triangleNormal[0] = nx / length;
    triangleNormal[1] = ny / length;
    triangleNormal[2] = nz / length;
    for (let i = 0; i < 3; i++) {
      const source = (i === 0 ? a : i === 1 ? b : c) * 3;
      const target = drawn++ * 3;
      for (let axis = 0; axis < 3; axis++) {
        positions[target + axis] = vertices[source + axis]!;
        normals[target + axis] = triangleNormal[axis]!;
      }
    }
  }

  function edge(u: number, v: number, gradient: number) {
    const key = Math.min(u, v) * cells.length + Math.max(u, v);
    const other = adjacency.get(key);
    if (other === undefined) {
      adjacency.set(key, gradient);
      return;
    }
    const dot =
      gradients[gradient]! * gradients[other]! +
      gradients[gradient + 1]! * gradients[other + 1]! +
      gradients[gradient + 2]! * gradients[other + 2]!;
    // Creases dissolve continuously as corners round, without flashing edges.
    const t = Math.max(0, Math.min(1, (0.92 - dot) / 0.42));
    const alpha = t * t * (3 - 2 * t);
    if (alpha > 0) {
      if (stroked + 2 > capacity)
        throw new Error('Volume outline exceeds the line budget; simplify the field');
      for (let i = 0; i < 2; i++) {
        const vertex = (i === 0 ? u : v) * 3;
        const target = stroked * 3;
        lines[target] = vertices[vertex]!;
        lines[target + 1] = vertices[vertex + 1]!;
        lines[target + 2] = vertices[vertex + 2]!;
        const tint = stroked++ * 4;
        colors[tint] = colors[tint + 1] = colors[tint + 2] = 1;
        colors[tint + 3] = alpha;
      }
    }
    adjacency.delete(key);
  }

  function quad(a: number, b: number, c: number, d: number, flip: boolean, gradient: number) {
    if (Math.min(a, b, c, d) < 0) return;
    if (flip) [b, d] = [d, b];
    const start = drawn;
    triangle(a, b, c);
    triangle(a, c, d);
    if (drawn === start) return;
    // The actual field normal distinguishes a crease from a skinny triangle's tilt.
    edge(a, b, gradient);
    edge(b, c, gradient);
    edge(c, d, gradient);
    edge(d, a, gradient);
  }

  function update(distance: VolumeField) {
    let at = 0;
    for (let z = 0; z <= n; z++)
      for (let y = 0; y <= n; y++)
        for (let x = 0; x <= n; x++)
          samples[at++] = distance(
            min[0] + x * step[0]!,
            min[1] + y * step[1]!,
            min[2] + z * step[2]!,
          );
    count = drawn = stroked = 0;
    cells.fill(-1);
    sampled.fill(0);
    adjacency.clear();
    for (let z = 0; z < n; z++)
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const base = z * plane + y * row + x;
          let mask = 0;
          for (const i of corners) {
            const value = samples[base + (i & 1) + ((i >> 1) & 1) * row + (i >> 2) * plane]!;
            values[i] = value;
            if (value < 0) mask |= 1 << i;
          }
          if (mask === 0 || mask === 255) continue;
          fit.fill(0);
          let hits = 0;
          const ox = min[0] + x * step[0]!,
            oy = min[1] + y * step[1]!,
            oz = min[2] + z * step[2]!;
          for (const [a, b] of edges) {
            const va = values[a!]!,
              vb = values[b!]!;
            if (va < 0 === vb < 0) continue;
            const t = va / (va - vb);
            const px = ((a! & 1) + ((b! & 1) - (a! & 1)) * t) * step[0]!;
            const py = (((a! >> 1) & 1) + (((b! >> 1) & 1) - ((a! >> 1) & 1)) * t) * step[1]!;
            const pz = ((a! >> 2) + ((b! >> 2) - (a! >> 2)) * t) * step[2]!;
            const wx = ox + px,
              wy = oy + py,
              wz = oz + pz;
            const edgeStart = base + (a! & 1) + ((a! >> 1) & 1) * row + (a! >> 2) * plane;
            const key = edgeStart * 3 + ((b! - a!) >> 1),
              gradient = key * 3;
            if (!sampled[key]) {
              const nx = distance(wx + epsilon, wy, wz) - distance(wx - epsilon, wy, wz);
              const ny = distance(wx, wy + epsilon, wz) - distance(wx, wy - epsilon, wz);
              const nz = distance(wx, wy, wz + epsilon) - distance(wx, wy, wz - epsilon);
              const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
              gradients[gradient] = nx / length;
              gradients[gradient + 1] = ny / length;
              gradients[gradient + 2] = nz / length;
              sampled[key] = 1;
            }
            const nx = gradients[gradient]!,
              ny = gradients[gradient + 1]!,
              nz = gradients[gradient + 2]!;
            const d = nx * px + ny * py + nz * pz;
            fit[0]! += nx * nx;
            fit[1]! += nx * ny;
            fit[2]! += nx * nz;
            fit[3]! += ny * ny;
            fit[4]! += ny * nz;
            fit[5]! += nz * nz;
            fit[6]! += nx * d;
            fit[7]! += ny * d;
            fit[8]! += nz * d;
            fit[9]! += px;
            fit[10]! += py;
            fit[11]! += pz;
            hits++;
          }
          // Weak centroid regularization keeps planar/rank-deficient cells stable.
          const lambda = hits * 0.02;
          const a = fit[0]! + lambda,
            b = fit[1]!,
            c = fit[2]!;
          const d = fit[3]! + lambda,
            e = fit[4]!,
            f = fit[5]! + lambda;
          const rx = fit[6]! + (lambda * fit[9]!) / hits;
          const ry = fit[7]! + (lambda * fit[10]!) / hits;
          const rz = fit[8]! + (lambda * fit[11]!) / hits;
          const aa = d * f - e * e,
            bb = c * e - b * f,
            cc = b * e - c * d;
          const dd = a * f - c * c,
            ee = b * c - a * e,
            ff = a * d - b * b;
          const determinant = a * aa + b * bb + c * cc;
          vertices[count * 3] =
            ox + Math.max(0, Math.min(step[0]!, (aa * rx + bb * ry + cc * rz) / determinant));
          vertices[count * 3 + 1] =
            oy + Math.max(0, Math.min(step[1]!, (bb * rx + dd * ry + ee * rz) / determinant));
          vertices[count * 3 + 2] =
            oz + Math.max(0, Math.min(step[2]!, (cc * rx + ee * ry + ff * rz) / determinant));
          cells[(z * n + y) * n + x] = count++;
        }
    for (let z = 1; z < n; z++)
      for (let y = 1; y < n; y++)
        for (let x = 1; x < n; x++) {
          const s = z * plane + y * row + x,
            c = (z * n + y) * n + x;
          const inside = samples[s]! < 0;
          if (inside !== samples[s + 1]! < 0)
            quad(
              cells[c]!,
              cells[c - n]!,
              cells[c - n - n * n]!,
              cells[c - n * n]!,
              !inside,
              s * 9,
            );
          if (inside !== samples[s + row]! < 0)
            quad(
              cells[c]!,
              cells[c - n * n]!,
              cells[c - 1 - n * n]!,
              cells[c - 1]!,
              !inside,
              s * 9 + 3,
            );
          if (inside !== samples[s + plane]! < 0)
            quad(cells[c]!, cells[c - 1]!, cells[c - 1 - n]!, cells[c - n]!, !inside, s * 9 + 6);
        }
    geometry.setDrawRange(0, drawn);
    outline.setDrawRange(0, stroked);
    for (const [attribute, length] of [
      [position, drawn],
      [normal, drawn],
      [line, stroked],
      [color, stroked],
    ] as const) {
      attribute.clearUpdateRanges();
      if (length) {
        attribute.addUpdateRange(0, length * attribute.itemSize);
        attribute.needsUpdate = true;
      }
    }
  }
  return { geometry, outline, update };
}
