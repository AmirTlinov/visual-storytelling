import * as T from '../../viewport/engine.js';
import type { DiagramCamera, DiagramPanel, DiagramPoint } from './types.js';

const vector = (p: DiagramPoint) => new T.Vector3(p[0], p[1], p[2] ?? 0);

/** Prepare one view for the operation. A moving surface never steers the viewer's camera. */
export function constructionCamera(panel: DiagramPanel): DiagramCamera | undefined {
  if (panel.camera) return panel.camera;
  const patch = panel.patches?.[0];
  if (!patch) return { direction: [2, 1.2, 5] };
  const [a, b] = patch.domain;
  const u = (a[0] + b[0]) / 2,
    v = (a[1] + b[1]) / 2;
  const du = (b[0] - a[0]) * 0.01,
    dv = (b[1] - a[1]) * 0.01;
  const across = vector(patch.map([u + du, v]))
    .sub(vector(patch.map([u - du, v])))
    .normalize();
  const along = vector(patch.map([u, v + dv]))
    .sub(vector(patch.map([u, v - dv])))
    .normalize();
  const normal = across.clone().cross(along).normalize();
  if (normal.lengthSq() < 0.5) return undefined;
  const direction = normal
    .multiplyScalar(5)
    .addScaledVector(across, 1.6)
    .addScaledVector(along, -2.2);
  return { direction: direction.toArray() as [number, number, number] };
}
