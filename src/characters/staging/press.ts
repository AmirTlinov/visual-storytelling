import type { Actor } from '../types.js';
import type { Placement } from './blocking.js';
import type { BipedRig, GroundPoint, Projection } from './types.js';
import { project } from './space.js';

export const pressTravel = 4;

/** Put the chosen shoulder inside the control's reachable annulus, then invert the projection. */
export function pressApproach(
  space: Projection,
  actor: Actor,
  before: Placement,
  target: GroundPoint,
  rig: BipedRig,
) {
  if (!rig.reach) throw new Error('Press needs measured rig geometry; rebuild the character pack');
  const z = target.z - 0.6,
    height = before.at.height ?? 0;
  const base = project(space, { x: 0, z, height }),
    control = project(space, target);
  const scale = (base.scale * (actor.scale ?? 0.77) * space.unit) / 100;
  const mirror = actor.flip ? -1 : 1;
  const sides: ('left' | 'right')[] =
    before.holding && before.hands === 1
      ? [before.holdingHand === 'left' ? 'right' : 'left']
      : ['left', 'right'];
  const candidates = sides.flatMap((side) => {
    const arm = rig.reach![side],
      min = arm.min * scale,
      max = arm.max * scale;
    const shoulderY = base.y - arm.shoulder.height * scale;
    const dy = control.y - shoulderY,
      pushed = dy + pressTravel * scale;
    const vertical = Math.max(Math.abs(dy), Math.abs(pushed));
    if (vertical >= max) return [];
    const outer = Math.sqrt(max * max - vertical * vertical);
    const nearest = dy <= 0 && pushed >= 0 ? 0 : Math.min(Math.abs(dy), Math.abs(pushed));
    const inner = Math.sqrt(Math.max(0, min * min - nearest * nearest));
    if (inner >= outer) return [];
    // Leave elbow flexion while keeping the control to the side of the torso.
    const horizontal = inner + (outer - inner) * 0.85;
    const direction = Math.sign(arm.shoulder.x * mirror) || (side === 'right' ? mirror : -mirror);
    const rootX = control.x - direction * horizontal - arm.shoulder.x * scale * mirror;
    const at = { x: (rootX - space.center) / (space.unit * base.scale), z, height };
    return [{ at, side, distance: Math.hypot(at.x - before.at.x, at.z - before.at.z) }];
  });
  candidates.sort((a, b) => a.distance - b.distance);
  const result = candidates[0];
  if (!result)
    throw new Error(
      `Cannot reach a press control at height ${target.height ?? 0} from floor ${height}`,
    );
  return { at: result.at, side: result.side };
}
