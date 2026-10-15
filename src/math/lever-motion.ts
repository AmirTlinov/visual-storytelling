import { rationalNumber } from './rational.js';
import type { LeverState } from './lever.js';
import { leverStopAngle, leverTrajectory } from './lever-trajectory.js';

/** A weightless bar with attached point masses F/g, released horizontally from rest.
 * Fixed stops at ±18° absorb impact. Every changed condition starts a separate trial.
 * I theta'' = tau(0) cos(theta); the normalized Rapier trace is shared by all trials.
 */
export function leverMotion(state: LeverState, time: number) {
  if (!Number.isFinite(time) || time < 0) throw new Error('Lever time must be nonnegative.');
  const force = (side: 'left' | 'right') => rationalNumber(state[side].force);
  const radius = (side: 'left' | 'right') => rationalNumber(state[side].arm);
  const inertia =
    (force('left') * radius('left') ** 2 + force('right') * radius('right') ** 2) / 9.81;
  const torque = rationalNumber(state.netMoment),
    direction = Math.sign(torque);
  const rate = inertia > 0 ? Math.sqrt(Math.abs(torque) / inertia) : 0;
  const s = time * rate;
  let low = 0,
    high = leverTrajectory.length - 1;
  while (high - low > 1) {
    const middle = Math.floor((high + low) / 2);
    if (leverTrajectory[middle]![0] <= s) low = middle;
    else high = middle;
  }
  const a = leverTrajectory[low]!,
    b = leverTrajectory[high]!;
  const p = Math.max(0, Math.min(1, (s - a[0]) / (b[0] - a[0])));
  const unconstrained = a[1] + (b[1] - a[1]) * p;
  const contact = unconstrained >= leverStopAngle;
  const angle = direction * Math.min(leverStopAngle, unconstrained);
  return {
    time,
    angle,
    inertia,
    angularVelocity: contact ? 0 : direction * rate * (a[2] + (b[2] - a[2]) * p),
    moment: torque * Math.cos(angle),
    leftMoment: force('left') * radius('left') * Math.cos(angle),
    rightMoment: force('right') * radius('right') * Math.cos(angle),
    status: torque === 0 ? 'balanced' : time === 0 ? 'held' : contact ? 'stop' : 'moving',
  } as const;
}
