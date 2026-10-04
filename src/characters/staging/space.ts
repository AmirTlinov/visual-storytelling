import type { Facing, GroundPoint, Projected, Projection } from './types.js';

export function project(space: Projection, at: GroundPoint): Projected {
  if (
    ![space.horizon, space.floor, space.center, space.unit, space.distance].every(
      Number.isFinite,
    ) ||
    space.unit <= 0 ||
    space.distance <= 0
  )
    throw new Error('Stage projection needs finite coordinates and positive unit and distance');
  if (![at.x, at.z, at.height ?? 0].every(Number.isFinite))
    throw new Error('Stage coordinates must be finite');
  const scale = space.distance / (space.distance + at.z);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Position is behind the stage camera');
  return {
    x: space.center + at.x * space.unit * scale,
    y: space.horizon + (space.floor - space.horizon - (at.height ?? 0) * space.unit) * scale,
    scale,
    depth: at.z,
  };
}
export function interpolate(a: GroundPoint, b: GroundPoint, t: number): GroundPoint {
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    height: (a.height ?? 0) + ((b.height ?? 0) - (a.height ?? 0)) * t,
  };
}
export const distance = (a: GroundPoint, b: GroundPoint) =>
  Math.hypot(b.x - a.x, b.z - a.z, (b.height ?? 0) - (a.height ?? 0));
/** Sample a route by travelled distance, so feet and body follow the same bends. */
export function alongPath(points: readonly GroundPoint[], progress: number): GroundPoint {
  const lengths = points.slice(1).map((p, i) => distance(points[i]!, p));
  let left = clamp(progress) * lengths.reduce((sum, n) => sum + n, 0);
  for (const [i, length] of lengths.entries()) {
    if (left <= length && length > 0) return interpolate(points[i]!, points[i + 1]!, left / length);
    left -= length;
  }
  return { ...points.at(-1)! };
}
export const ground = (x: number, z = 0, height = 0): GroundPoint => ({ x, z, height });
export function floorGrid(space: Projection, color: string, depth = 25) {
  const line = (a: GroundPoint, b: GroundPoint) => {
    const p = project(space, a),
      q = project(space, b);
    return `M${p.x} ${p.y}L${q.x} ${q.y}`;
  };
  const lines = [];
  for (let x = -18; x <= 18; x += 2) lines.push(line(ground(x, -0.3), ground(x, depth)));
  for (const z of [0, 1.8, 4, 7, 12, 20].filter((z) => z <= depth))
    lines.push(line(ground(-20, z), ground(20, z)));
  return `<path d="${lines.join('')}" fill="none" stroke="${color}" stroke-width="1.5" opacity=".55"/>`;
}

export const clamp = (x: number) => Math.max(0, Math.min(1, x));
export const ease = (x: number) => {
  x = clamp(x);
  return x * x * (3 - 2 * x);
};
export const facing = (a: GroundPoint, b: GroundPoint): Facing =>
  Math.abs(b.x - a.x) > 0.45 * Math.abs(b.z - a.z)
    ? b.x > a.x
      ? 'right'
      : 'left'
    : b.z > a.z
      ? 'back'
      : 'front';
