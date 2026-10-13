import {
  rational,
  rationalValue,
  addRational,
  multiplyRational,
  type Rational,
} from './rational.js';
export interface LeverLoad {
  readonly force: Rational;
  readonly arm: Rational;
}
export interface LeverState {
  readonly left: LeverLoad & { readonly moment: Rational };
  readonly right: LeverLoad & { readonly moment: Rational };
  /** Positive is counterclockwise: the left side initially descends. */
  readonly netMoment: Rational;
  /** Required for vertical force balance; a pin cannot cancel a nonzero moment. */
  readonly requiredVerticalReaction: Rational;
  readonly equilibrium: boolean;
  readonly direction: 'left-down' | 'right-down' | 'balanced';
}
/** A horizontal weightless rigid lever, downward loads in N, perpendicular arms in m. */
export function leverState(left: LeverLoad, right: LeverLoad): LeverState {
  const load = (input: LeverLoad) => {
    const force = rationalValue(input.force),
      arm = rationalValue(input.arm);
    if (force.numerator < 0 || arm.numerator < 0)
      throw new Error('Lever load and perpendicular arm must be nonnegative.');
    return Object.freeze({ force, arm, moment: multiplyRational(force, arm) });
  };
  const a = load(left),
    b = load(right);
  const netMoment = addRational(a.moment, rational(-b.moment.numerator, b.moment.denominator));
  return Object.freeze({
    left: a,
    right: b,
    netMoment,
    requiredVerticalReaction: addRational(a.force, b.force),
    equilibrium: netMoment.numerator === 0,
    direction:
      netMoment.numerator === 0 ? 'balanced' : netMoment.numerator > 0 ? 'left-down' : 'right-down',
  });
}
