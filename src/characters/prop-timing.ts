import type { PropChange } from './types.js';
import type { Plan } from './staging/blocking.js';
import { pressTime } from './staging/press.js';

/** Resolve authored causality against the same prepared plans that move the actor. */
export function propStart(change: PropChange, plans: readonly Plan[], start: number, beat: string) {
  if (change.on === undefined) return start;
  if (
    !change.on ||
    typeof change.on !== 'object' ||
    typeof change.on.press !== 'string' ||
    !change.on.press.trim() ||
    Object.keys(change.on).some((key) => key !== 'press')
  )
    throw new Error(`Beat ${beat}: a prop reaction needs on: {press: 'control-id'}`);
  const matching = plans.filter(
    (p) => p.action.action === 'press' && p.action.target === change.on!.press,
  );
  if (matching.length !== 1)
    throw new Error(
      `Beat ${beat}: on.press ${change.on.press} needs exactly one matching press action`,
    );
  return pressTime(matching[0]!);
}
