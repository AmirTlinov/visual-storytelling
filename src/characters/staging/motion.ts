import type { Blocking, BlockingActor, PairContact, Placement } from './blocking.js';
import { durationOf, phaseAt } from './timing.js';
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
  const place = (poses: Record<string, Placement>) => {
    for (const [id, pose] of Object.entries(poses)) actors[id] = structuredClone(pose);
  };
  for (const plan of blocking.plans) {
    if (time < plan.start) continue;
    const a = plan.action;
    const elapsed = durationOf(plan.timing) * clamp((time - plan.start) / (plan.end - plan.start));
    const phase = (name: keyof typeof plan.timing) => phaseAt(plan.timing, elapsed, name);
    // These channels overlay the placement sampled by the locomotion/contact owner.
    if (a.action === 'point' || a.action === 'look' || a.action === 'mood') {
      if (time >= plan.end) continue;
      const p = actors[a.actor]!;
      if (a.action === 'mood') {
        p.mood = a.name;
        p.moodTime = elapsed;
      } else {
        const weight = reduced ? 1 : ease(phase('engage')) * (1 - ease(phase('release')));
        if (a.action === 'look') p.gaze = { at: plan.target!, weight };
        else (p.reaches ??= []).push({ at: plan.target!, side: plan.reachSide, weight, press: 0 });
      }
      continue;
    }
    if (time >= plan.end || reduced) {
      place(plan.to);
      if (plan.transfer && !plan.transfer.taking) items[plan.transfer.id] = { ...plan.transfer.at };
      if (a.action === 'openDoor' || a.action === 'closeDoor') objects[a.door] = plan.objectTo!;
      if (a.action === 'read' || a.action === 'openBook' || a.action === 'closeBook')
        objects[a.book] = plan.objectTo!;
      if (plan.effect) objects[plan.effect.id] = plan.effect.to;
      continue;
    }
    place(plan.from);
    if (plan.effect)
      objects[plan.effect.id] = phase('act') < 0.5 ? plan.effect.from : plan.effect.to;
    const weight = ease(phase('engage')) * (1 - ease(phase('release')));
    if ('actor' in a) {
      const p = actors[a.actor]!,
        before = plan.from[a.actor]!,
        after = plan.to[a.actor]!;
      const rise = () => {
        p.seated = before.seated * (1 - ease(phase('rise')));
      };
      const approach = () => {
        moving(p, before.at, after.at, phase('approach'), plan.via);
        if (phase('approach') >= 1) {
          p.travel = undefined;
          p.facing = 'front';
        }
      };
      if (plan.transfer) {
        rise();
        approach();
        p.holdingHand = after.holdingHand;
        p.hands = after.hands;
        const tr = plan.transfer;
        p.transfer = {
          ...tr,
          progress: ease(phase('act')),
          grip: tr.taking ? ease(phase('engage')) : 1 - ease(phase('release')),
        };
      }
      if (
        a.action === 'walk' ||
        a.action === 'run' ||
        a.action === 'flee' ||
        a.action === 'passDoor'
      ) {
        rise();
        moving(p, before.at, after.at, phase('act'), plan.via);
        if (p.travel)
          p.travel.running =
            a.action === 'run' ||
            a.action === 'flee' ||
            (a.action === 'passDoor' && a.gait === 'run');
        if (a.action === 'flee') {
          p.mood = 'scared';
          p.moodTime = elapsed;
        }
      }
      if (a.action === 'openBook' || a.action === 'closeBook')
        objects[a.book] =
          plan.objectFrom! + (plan.objectTo! - plan.objectFrom!) * ease(phase('act'));
      if (a.action === 'turn') p.facing = phase('act') < 0.5 ? before.facing : after.facing;
      if (a.action === 'openDoor' || a.action === 'closeDoor') {
        const door = blocking.staging.objects[a.door]!,
          scale = blocking.scales[a.actor]!;
        const open = plan.objectFrom! + (plan.objectTo! - plan.objectFrom!) * ease(phase('act'));
        objects[a.door] = open;
        const start = doorApproach(door, scale, plan.objectFrom!, plan.doorSide);
        if (phase('approach') < 1)
          moving(p, before.at, start, phase('approach'), plan.approaches?.[a.actor]);
        else {
          const arc = Array.from({ length: 15 }, (_, i) =>
            doorApproach(
              door,
              scale,
              plan.objectFrom! + ((plan.objectTo! - plan.objectFrom!) * (i + 1)) / 16,
              plan.doorSide,
            ),
          );
          moving(p, start, after.at, phase('act'), arc);
          if (phase('act') === 0 || phase('act') === 1) p.travel = undefined;
          p.facing = 'left';
        }
        rise();
        p.reaches = [{ at: doorHandle(door, open), weight, press: 0 }];
      }
      if (a.action === 'climb' || a.action === 'descend') {
        const stairs = blocking.staging.objects[a.stairs]!,
          start = a.action === 'climb' ? { ...stairs.at } : stairEnd(stairs);
        if (phase('approach') < 1)
          moving(p, before.at, start, phase('approach'), plan.approaches?.[a.actor]);
        else moving(p, start, after.at, phase('act'));
        rise();
      }
      if (a.action === 'stand') p.seated = before.seated * (1 - ease(phase('act')));
      if (a.action === 'sit' || a.action === 'read') {
        approach();
        p.seatHeight = after.seatHeight;
        p.seated = before.seated + (after.seated - before.seated) * ease(phase('engage'));
        if (a.action === 'read') {
          p.holding = a.book;
          p.bookBlend = 1;
          objects[a.book] =
            plan.objectFrom! +
            (plan.objectTo! - plan.objectFrom!) * ease((elapsed - plan.timing.approach) / 0.35);
          const reading = phase('act'),
            cycle = reading * (a.pages ?? 3),
            page = cycle % 1;
          p.turn = reading >= 1 ? 0 : ease((page - 0.26) / 0.4);
          p.handTurn = reading >= 1 ? 0 : p.turn * (1 - ease((page - 0.72) / 0.25));
        }
      }
      if (a.action === 'press') {
        rise();
        approach();
        p.reaches = [
          {
            at: plan.target!,
            gesture: 'press',
            side: plan.reachSide,
            weight,
            press: Math.sin(Math.PI * phase('act')),
          },
        ];
      }
    } else {
      const ids = a.actors,
        center = plan.meeting!;
      for (const id of ids) {
        const p = actors[id]!,
          before = plan.from[id]!,
          after = plan.to[id]!;
        if (a.action === 'highFive' || a.action === 'handTap') {
          moving(p, before.at, after.at, phase('approach'), plan.approaches?.[id]);
          if (phase('approach') >= 1) {
            p.travel = undefined;
            p.facing = 'front';
          }
        } else {
          const destination = interpolate(plan.to[ids[0]]!.at, plan.to[ids[1]]!.at, 0.5);
          const offset = after.at.x - destination.x,
            joined = { ...center, x: center.x + offset };
          if (phase('approach') < 1)
            moving(p, before.at, joined, phase('approach'), plan.approaches?.[id]);
          else
            moving(
              p,
              joined,
              after.at,
              phase('act'),
              plan.via?.map((p) => ({ ...p, x: p.x + offset })),
            );
        }
        p.seated = before.seated * (1 - ease(phase('rise')));
        p.contact = true;
      }
      pairs.push({ actors: ids, gesture: a.action, weight });
    }
  }
  return { actors, pairs, objects, items };
}
