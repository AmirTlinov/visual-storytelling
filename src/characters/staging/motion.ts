import type { Blocking, BlockingActor, PairContact } from './blocking.js';
import type { GroundPoint } from './types.js';
import { objectShape, stairEnd } from './objects.js';
import { doorApproach, doorHandle } from './doorway.js';
import { clamp, ease, distance, interpolate, facing, alongPath } from './space.js';

/** Pure sampling of prepared actions at absolute story time. */
function moving(
  actor: BlockingActor,
  from: GroundPoint,
  to: GroundPoint,
  p: number,
  via?: GroundPoint[],
) {
  const path = via ? [from, ...via, to] : undefined;
  const length = path
    ? path.slice(1).reduce((sum, point, i) => sum + distance(path[i]!, point), 0)
    : distance(from, to);
  if (length < 0.001) {
    actor.at = { ...to };
    return;
  }
  const t = ease(p);
  actor.at = path ? alongPath(path, t) : interpolate(from, to, t);
  actor.facing = path
    ? facing(alongPath(path, Math.max(0, t - 0.01)), alongPath(path, Math.min(1, t + 0.01)))
    : facing(from, to);
  actor.travel = { from, to, progress: t, length, path };
  // Routing connects levels only through prepared stairs. Keep the root on that
  // route while the gait finishes each floor section and uses real tread contacts.
  const points = path ?? [from, to],
    breaks = [0];
  for (let i = 1; i < points.length; i++) {
    if (Math.abs((points[i]!.height ?? 0) - (points[i - 1]!.height ?? 0)) < 0.05) continue;
    if (breaks.at(-1) !== i - 1) breaks.push(i - 1);
    breaks.push(i);
  }
  if (breaks.length === 1) return;
  if (breaks.at(-1) !== points.length - 1) breaks.push(points.length - 1);
  let left = t * length;
  for (let i = 1; i < breaks.length; i++) {
    const section = points.slice(breaks[i - 1], breaks[i]! + 1);
    const span = section.slice(1).reduce((sum, p, j) => sum + distance(section[j]!, p), 0);
    if (span < 0.001) continue;
    if (left <= span || i === breaks.length - 1) {
      const start = section[0]!,
        end = section.at(-1)!;
      actor.travel = {
        from: start,
        to: end,
        progress: clamp(left / span),
        length: span,
        path: section.length > 2 ? section : undefined,
        steps:
          Math.abs((end.height ?? 0) - (start.height ?? 0)) >= 0.05
            ? objectShape.stairs.steps
            : undefined,
      };
      return;
    }
    left -= span;
  }
}
export function blockAt(blocking: Blocking, time: number, reduced = false) {
  if (!Number.isFinite(time)) throw new Error('Stage time must be finite');
  const actors: Record<string, BlockingActor> = structuredClone(blocking.initial);
  const pairs: PairContact[] = [],
    objects: Record<string, number> = { ...blocking.initialObjects },
    items = structuredClone(blocking.initialItems);
  for (const plan of blocking.plans) {
    if (time < plan.start) continue;
    if (time >= plan.end || reduced) {
      Object.assign(actors, structuredClone(plan.to));
      if (plan.transfer && !plan.transfer.taking) items[plan.transfer.id] = { ...plan.transfer.at };
      if (plan.action.action === 'openDoor' || plan.action.action === 'closeDoor')
        objects[plan.action.door] = plan.objectTo!;
      if (plan.effect) objects[plan.effect.id] = plan.effect.to;
      continue;
    }
    const span = plan.end - plan.start,
      t = clamp((time - plan.start) / span),
      a = plan.action;
    Object.assign(actors, structuredClone(plan.from));
    if (plan.effect) objects[plan.effect.id] = t < 0.5 ? plan.effect.from : plan.effect.to;
    if ('actor' in a) {
      const p = actors[a.actor]!,
        before = plan.from[a.actor]!,
        after = plan.to[a.actor]!;
      if (plan.transfer) {
        moving(p, before.at, after.at, t / 0.3, plan.via);
        if (t >= 0.3) {
          p.travel = undefined;
          p.facing = 'front';
        }
        p.seated = before.seated * (1 - ease(t / 0.15));
        const tr = plan.transfer;
        if (!tr.taking) p.bookOpen = (before.bookOpen ?? 0) * (1 - ease(t / 0.3));
        p.transfer = {
          ...tr,
          progress: ease((t - 0.48) / 0.32),
          grip: tr.taking ? ease((t - 0.3) / 0.18) : 1 - ease((t - 0.83) / 0.17),
        };
      }
      if (a.action === 'walk' || a.action === 'run' || a.action === 'flee') {
        moving(p, before.at, after.at, t, plan.via);
        p.seated = before.seated * (1 - ease(t / 0.15));
        if (p.travel) p.travel.running = a.action !== 'walk';
        if (a.action === 'flee') p.mood = 'scared';
      }
      if (a.action === 'openBook' || a.action === 'closeBook') {
        p.bookOpen =
          (before.bookOpen ?? 0) + ((after.bookOpen ?? 0) - (before.bookOpen ?? 0)) * ease(t);
      }
      if (a.action === 'turn') p.facing = t < 0.5 ? before.facing : after.facing;
      if (a.action === 'openDoor' || a.action === 'closeDoor') {
        const door = blocking.staging.objects[a.door]!,
          scale = blocking.scales[a.actor]!;
        const open =
          plan.objectFrom! + (plan.objectTo! - plan.objectFrom!) * ease((t - 0.35) / 0.45);
        objects[a.door] = open;
        if (t < 0.3)
          moving(
            p,
            before.at,
            doorApproach(door, scale, plan.objectFrom!, plan.doorSide),
            t / 0.3,
            plan.approaches?.[a.actor],
          );
        else {
          const arc = Array.from({ length: 15 }, (_, i) =>
            doorApproach(
              door,
              scale,
              plan.objectFrom! + ((plan.objectTo! - plan.objectFrom!) * (i + 1)) / 16,
              plan.doorSide,
            ),
          );
          moving(
            p,
            doorApproach(door, scale, plan.objectFrom!, plan.doorSide),
            after.at,
            (t - 0.35) / 0.45,
            arc,
          );
          p.facing = 'left';
        }
        p.seated = before.seated * (1 - ease(t / 0.15));
        p.reach = {
          at: doorHandle(door, open),
          weight: ease((t - 0.28) / 0.1) * (1 - ease((t - 0.86) / 0.14)),
          press: 0,
        };
      }
      if (a.action === 'passDoor') {
        moving(p, before.at, after.at, t, plan.via);
        p.seated = before.seated * (1 - ease(t / 0.15));
        if (p.travel) p.travel.running = a.gait === 'run';
      }
      if (a.action === 'climb' || a.action === 'descend') {
        const stairs = blocking.staging.objects[a.stairs]!,
          start = a.action === 'climb' ? { ...stairs.at } : stairEnd(stairs);
        if (t < 0.24) moving(p, before.at, start, t / 0.24, plan.approaches?.[a.actor]);
        else {
          moving(p, start, after.at, (t - 0.24) / 0.76);
        }
        p.seated = before.seated * (1 - ease(t / 0.15));
      }
      if (a.action === 'stand') {
        p.seated = before.seated * (1 - ease(t));
      }
      if (a.action === 'sit' || a.action === 'read') {
        const pathLength = distance(before.at, after.at);
        const approach = pathLength > 0.01 ? Math.min(0.42, pathLength / 1.2 / span) : 0;
        const settle = a.action === 'sit' ? 1 - approach : Math.min(0.18, 1 / span);
        moving(p, before.at, after.at, approach ? t / approach : 1, plan.via);
        if (t >= approach) {
          p.travel = undefined;
          p.facing = 'front';
        }
        p.seatHeight = after.seatHeight;
        p.seated =
          before.seated +
          (after.seated - before.seated) * ease((t - approach) / Math.max(0.01, settle));
        if (a.action === 'read') {
          p.holding = a.book;
          p.bookBlend = 1;
          p.bookOpen = (before.bookOpen ?? 0) + (1 - (before.bookOpen ?? 0)) * ease(t / 0.16);
          const reading = clamp((t - approach - settle) / Math.max(0.01, 1 - approach - settle));
          const cycle = reading * (a.pages ?? 3);
          // Hold each spread before reaching for and turning a page.
          const phase = cycle % 1;
          p.turn = reading >= 1 ? 0 : ease((phase - 0.26) / 0.4);
          p.handTurn = reading >= 1 ? 0 : p.turn * (1 - ease((phase - 0.72) / 0.25));
        }
      }
      if (a.action === 'point' || a.action === 'press') {
        if (a.action === 'press') {
          moving(p, before.at, after.at, t / 0.3, plan.via);
          p.seated = before.seated * (1 - ease(t / 0.15));
          if (t >= 0.3) {
            p.travel = undefined;
            p.facing = 'front';
          }
        }
        p.reach = {
          at: plan.target!,
          gesture: a.action === 'press' ? 'press' : undefined,
          side: plan.reachSide,
          weight: ease((t - (a.action === 'press' ? 0.3 : 0)) / 0.15) * (1 - ease((t - 0.8) / 0.2)),
          press: a.action === 'press' ? Math.sin(Math.PI * clamp((t - 0.35) / 0.25)) : 0,
        };
      }
    } else {
      const ids = a.actors;
      const center = plan.meeting!;
      for (const id of ids) {
        const p = actors[id]!,
          before = plan.from[id]!,
          after = plan.to[id]!;
        if (a.action === 'highFive' || a.action === 'handTap') {
          moving(p, before.at, after.at, t / 0.28, plan.approaches?.[id]);
          if (t >= 0.28) {
            p.travel = undefined;
            p.facing = 'front';
          }
        } else {
          const destination = interpolate(plan.to[ids[0]]!.at, plan.to[ids[1]]!.at, 0.5);
          const offset = after.at.x - destination.x;
          const joined = { ...center, x: center.x + offset };
          if (t < 0.2) moving(p, before.at, joined, t / 0.2, plan.approaches?.[id]);
          else
            moving(
              p,
              joined,
              after.at,
              (t - 0.2) / 0.8,
              plan.via?.map((p) => ({ ...p, x: p.x + offset })),
            );
        }
        p.seated = before.seated * (1 - ease(t / 0.15));
        p.contact = true;
      }
      pairs.push({
        actors: ids,
        gesture: a.action,
        weight:
          a.action === 'handTap'
            ? ease((t - 0.3) / 0.14) * (1 - ease((t - 0.5) / 0.18))
            : a.action === 'highFive'
              ? ease((t - 0.28) / 0.22) * (1 - ease((t - 0.66) / 0.25))
              : ease((t - 0.08) / 0.15) * (1 - ease((t - 0.9) / 0.1)),
      });
    }
  }
  return { actors, pairs, objects, items };
}
