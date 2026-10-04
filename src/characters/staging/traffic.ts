import type { Plan, Placement } from './blocking.js';
import type { GroundPoint, Staging } from './types.js';
import { route } from './navigation.js';
import { distance } from './space.js';

const samples = 80;
/** Check the swept separation between samples, so a fast crossing cannot tunnel. */
function crossing(a: GroundPoint[], b: GroundPoint[], clearance: number) {
  let previous: GroundPoint | undefined;
  for (let i = 0; i <= samples; i++) {
    const p = a[i]!,
      q = b[i]!;
    const r = { x: p.x - q.x, z: p.z - q.z, height: (p.height ?? 0) - (q.height ?? 0) };
    if (Math.abs(r.height) < 0.3) {
      if (Math.hypot(r.x, r.z) < clearance) return true;
      if (previous && Math.abs(previous.height ?? 0) < 0.3) {
        const dx = r.x - previous.x,
          dz = r.z - previous.z,
          t = Math.max(
            0,
            Math.min(1, -(previous.x * dx + previous.z * dz) / (dx * dx + dz * dz || 1)),
          );
        if (Math.hypot(previous.x + dx * t, previous.z + dz * t) < clearance) return true;
      }
    }
    previous = r;
  }
  return false;
}
/** Sample the actual action owner, including its approach phase; no second motion model. */
export function coordinateTraffic(
  staging: Staging,
  plans: Plan[],
  before: Record<string, Placement>,
  scales: Record<string, number>,
  sample: (plan: Plan, progress: number) => Record<string, Placement>,
) {
  const walkers = plans.filter((p) => ['walk', 'run', 'flee'].includes(p.action.action));
  if (!walkers.length) return;
  const movingIds = new Set(walkers.map((p) => ('actor' in p.action ? p.action.actor : '')));
  const trace = (plan: Plan, id: string) =>
    Array.from({ length: samples + 1 }, (_, i) => sample(plan, i / samples)[id]!.at);
  const reserved = Object.entries(before)
    .filter(([id]) => !movingIds.has(id))
    .map(([id, p]) => {
      const action = plans.find((plan) => Object.hasOwn(plan.from, id));
      return {
        id,
        plan: action,
        at: p.at,
      };
    });
  for (const plan of walkers) {
    if (!('actor' in plan.action)) continue;
    const id = plan.action.actor,
      from = plan.from[id]!.at,
      to = plan.to[id]!.at;
    const free = (path: GroundPoint[]) =>
      reserved.every(
        (other) =>
          other.id === id ||
          !crossing(
            path,
            other.plan
              ? trace(other.plan, other.id)
              : Array.from({ length: samples + 1 }, () => other.at),
            0.52 * (scales[id]! + scales[other.id]!),
          ),
      );
    const path = trace(plan, id);
    if (!free(path)) {
      const dx = to.x - from.x,
        dz = to.z - from.z,
        length = Math.hypot(dx, dz),
        original = plan.via;
      if (length < 0.001) throw new Error(`Actor ${id} occupies another actor's route`);
      let candidate: GroundPoint[] | undefined,
        cost = Infinity;
      for (const offset of [0.9, -0.9, 1.5, -1.5, 2.4, -2.4, 3.8, -3.8]) {
        const mid = {
          x: (from.x + to.x) / 2 - (dz / length) * offset,
          z: (from.z + to.z) / 2 + (dx / length) * offset,
          height: from.height,
        };
        try {
          const next = [
            from,
            ...route(staging, from, mid, scales[id]! * 0.46),
            mid,
            ...route(staging, mid, to, scales[id]! * 0.46),
            to,
          ];
          const length = next.slice(1).reduce((sum, p, i) => sum + distance(next[i]!, p), 0);
          plan.via = next.slice(1, -1);
          if (length < cost && free(trace(plan, id))) {
            candidate = plan.via;
            cost = length;
          }
        } catch {
          /* Try the other side of the same corridor. */
        }
      }
      plan.via = candidate ?? original;
      if (!candidate)
        throw new Error(
          `No clear passing route for ${id}; the destination or corridor is occupied`,
        );
    }
    reserved.push({ id, plan, at: to });
  }
}
