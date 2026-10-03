import * as T from '../viewport/engine.js';
import { inflate, route } from '../layout/geometry.js';
const smooth = (p: number) => {
  p = Math.max(0, Math.min(1, p));
  return p * p * (3 - 2 * p);
};

/** A compact carrier travels through free lanes, then opens at its destination. */
export function transfer(
  start: T.Vector3,
  end: T.Vector3,
  obstacles: readonly T.Object3D[],
  width: number,
) {
  const small = 0.06,
    clearance = (width * small) / 2 + 0.006;
  const boxes = obstacles.map((object) => {
    object.updateWorldMatrix(true, true);
    const b = new T.Box3().setFromObject(object);
    return inflate(
      { x: b.min.x, y: b.min.y, width: b.max.x - b.min.x, height: b.max.y - b.min.y },
      clearance,
    );
  });
  const points = route(start, end, boxes);
  if (points.length < 2) throw new Error('No free lane for this transfer');
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
  const total = lengths.reduce((a, b) => a + b, 0);
  return (progress: number) => {
    const p = Math.max(0, Math.min(1, progress));
    if (p < 0.14)
      return {
        position: start.clone(),
        scale: 1 - (1 - small) * smooth(p / 0.14),
        lettering: false,
      };
    if (p > 0.84)
      return {
        position: end.clone(),
        scale: small + (1 - small) * smooth((p - 0.84) / 0.16),
        lettering: p >= 0.999,
      };
    const t = smooth((p - 0.14) / 0.7);
    let distance = t * total;
    for (let i = 0; i < lengths.length; i++) {
      if (distance <= lengths[i]! || i === lengths.length - 1) {
        const q = lengths[i]! > 0 ? distance / lengths[i]! : 0,
          a = points[i]!,
          b = points[i + 1]!;
        return {
          position: new T.Vector3(
            a.x + (b.x - a.x) * q,
            a.y + (b.y - a.y) * q,
            start.z + (end.z - start.z) * t,
          ),
          scale: small,
          lettering: false,
        };
      }
      distance -= lengths[i]!;
    }
    return { position: end.clone(), scale: 1, lettering: true };
  };
}
