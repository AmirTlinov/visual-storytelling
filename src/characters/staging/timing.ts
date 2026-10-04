import type { Plan } from './blocking.js';
import type { CharacterPack } from '../types.js';
import type { GroundPoint, Staging } from './types.js';
import { distance, interpolate } from './space.js';
import { doorApproach } from './doorway.js';
import { stairEnd } from './objects.js';

/** Seconds in the action's own physical phases; the Story still owns absolute time. */
export interface ActionTiming {
  rise: number;
  approach: number;
  engage: number;
  act: number;
  release: number;
}
export const durationOf = (timing: ActionTiming) =>
  timing.rise + timing.approach + timing.engage + timing.act + timing.release;
export function phaseAt(timing: ActionTiming, elapsed: number, phase: keyof ActionTiming) {
  let start = 0;
  for (const name of ['rise', 'approach', 'engage', 'act', 'release'] as const) {
    if (name === phase)
      return timing[name]
        ? Math.max(0, Math.min(1, (elapsed - start) / timing[name]))
        : elapsed >= start
          ? 1
          : 0;
    start += timing[name];
  }
  return 0;
}
const length = (from: GroundPoint, to: GroundPoint, via: readonly GroundPoint[] = []) => {
  const path = [from, ...via, to];
  return path.slice(1).reduce((n, p, i) => n + distance(path[i]!, p), 0);
};

/** Geometry chooses approach time. Contact phases keep their own readable physical duration. */
export function actionTiming(
  plan: Plan,
  staging: Staging,
  scales: Record<string, number>,
  actions: CharacterPack['actions'],
): ActionTiming {
  const a = plan.action;
  const timing: ActionTiming = { rise: 0, approach: 0, engage: 0, act: 0, release: 0 };
  const walkSpeed = 1.25;
  if ('actor' in a) {
    const from = plan.from[a.actor]!,
      to = plan.to[a.actor]!;
    const travel = length(from.at, to.at, plan.via);
    if (
      !['sit', 'read', 'stand', 'point', 'look', 'mood', 'openBook', 'closeBook'].includes(a.action)
    )
      timing.rise = from.seated > 0 ? 0.55 : 0;
    if (
      a.action === 'walk' ||
      a.action === 'run' ||
      a.action === 'flee' ||
      a.action === 'passDoor'
    ) {
      const speed = 'speed' in a ? a.speed : undefined;
      timing.act = Math.max(
        0.12,
        travel /
          (speed ??
            (a.action === 'walk' || (a.action === 'passDoor' && a.gait !== 'run')
              ? walkSpeed
              : 2.8)),
      );
    } else if (a.action === 'take' || a.action === 'put' || a.action === 'press') {
      timing.approach = travel / walkSpeed;
      timing.engage = 0.35;
      timing.act = a.action === 'press' ? 0.45 : 0.65;
      timing.release = 0.35;
    } else if (a.action === 'openDoor' || a.action === 'closeDoor') {
      const door = staging.objects[a.door]!;
      const start = doorApproach(door, scales[a.actor]!, plan.objectFrom!, plan.doorSide);
      timing.approach = length(from.at, start, plan.approaches?.[a.actor]) / walkSpeed;
      timing.engage = 0.3;
      const arc = Array.from({ length: 15 }, (_, i) =>
        doorApproach(
          door,
          scales[a.actor]!,
          plan.objectFrom! + ((plan.objectTo! - plan.objectFrom!) * (i + 1)) / 16,
          plan.doorSide,
        ),
      );
      timing.act = Math.max(0.8, length(start, to.at, arc) / walkSpeed);
      timing.release = 0.3;
    } else if (a.action === 'climb' || a.action === 'descend') {
      const stairs = staging.objects[a.stairs]!;
      const start = a.action === 'climb' ? stairs.at : stairEnd(stairs);
      timing.approach = length(from.at, start, plan.approaches?.[a.actor]) / walkSpeed;
      timing.act = Math.max(0.5, distance(start, to.at) / 0.75);
    } else if (a.action === 'sit' || a.action === 'read') {
      timing.approach = travel / walkSpeed;
      timing.engage = Math.abs(to.seated - from.seated) * 0.7;
      timing.act = a.action === 'read' ? (a.pages ?? 3) * 1.8 + 0.35 : 0.3;
    } else if (a.action === 'point' || a.action === 'look') {
      timing.engage = 0.3;
      timing.act = 1.2;
      timing.release = 0.3;
    } else timing.act = a.action === 'mood' ? Math.max(0.12, actions[a.name]!.pose ?? 1.2) : 0.65;
  } else {
    const center = plan.meeting!;
    const destination = interpolate(plan.to[a.actors[0]]!.at, plan.to[a.actors[1]]!.at, 0.5);
    timing.rise = a.actors.some((id) => plan.from[id]!.seated > 0) ? 0.55 : 0;
    timing.approach = Math.max(
      ...a.actors.map((id) => {
        const end =
          a.action === 'walkTogether'
            ? { ...center, x: center.x + plan.to[id]!.at.x - destination.x }
            : plan.to[id]!.at;
        return length(plan.from[id]!.at, end, plan.approaches?.[id]) / walkSpeed;
      }),
    );
    timing.engage = 0.35;
    timing.act =
      a.action === 'walkTogether'
        ? Math.max(0.2, length(center, destination, plan.via) / walkSpeed)
        : a.action === 'handTap'
          ? 0.25
          : 0.55;
    timing.release = 0.3;
  }
  return timing;
}
