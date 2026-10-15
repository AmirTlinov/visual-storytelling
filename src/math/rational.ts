/** JSON-safe exact rational values. Geometry alone converts them to floating point. */
export interface Rational {
  readonly numerator: number;
  readonly denominator: number;
}
const limit = BigInt(Number.MAX_SAFE_INTEGER);
function terms(n: bigint, d: bigint): readonly [bigint, bigint] {
  if (d === 0n) throw new Error('A rational denominator cannot be zero.');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  let a = n < 0n ? -n : n,
    b = d;
  while (b) {
    const rest = a % b;
    a = b;
    b = rest;
  }
  n /= a;
  d /= a;
  return [n, d];
}
function reduced(n: bigint, d: bigint): Rational {
  [n, d] = terms(n, d);
  if (n > limit || n < -limit || d > limit)
    throw new Error('Exact rational result exceeds safe integer storage.');
  return Object.freeze({ numerator: Number(n), denominator: Number(d) });
}
export function rational(numerator: number, denominator = 1): Rational {
  if (![numerator, denominator].every(Number.isSafeInteger))
    throw new Error('Rational terms must be safe integers.');
  return reduced(BigInt(numerator), BigInt(denominator));
}
export function rationalValue(value: Rational): Rational {
  return rational(value.numerator, value.denominator);
}
export function addRational(a: Rational, b: Rational): Rational {
  return sumRational([a, b]);
}
/** Storage bounds apply to the complete sum, independent of input order. */
export function sumRational(values: Iterable<Rational>): Rational {
  let n = 0n,
    d = 1n;
  for (const value of values) {
    const next = rationalValue(value);
    [n, d] = terms(
      n * BigInt(next.denominator) + BigInt(next.numerator) * d,
      d * BigInt(next.denominator),
    );
  }
  return reduced(n, d);
}
export function divideRational(a: Rational, count: number): Rational {
  a = rationalValue(a);
  if (!Number.isSafeInteger(count) || count < 1)
    throw new Error('Divide a quantity into a positive integer number of parts.');
  return reduced(BigInt(a.numerator), BigInt(a.denominator) * BigInt(count));
}
export function multiplyRational(a: Rational, b: Rational): Rational {
  a = rationalValue(a);
  b = rationalValue(b);
  return reduced(
    BigInt(a.numerator) * BigInt(b.numerator),
    BigInt(a.denominator) * BigInt(b.denominator),
  );
}
export function equalRational(a: Rational, b: Rational): boolean {
  a = rationalValue(a);
  b = rationalValue(b);
  return a.numerator === b.numerator && a.denominator === b.denominator;
}
export function rationalNumber(value: Rational): number {
  value = rationalValue(value);
  return value.numerator / value.denominator;
}
export function rationalText(value: Rational): string {
  value = rationalValue(value);
  return value.denominator === 1
    ? String(value.numerator)
    : `${value.numerator}/${value.denominator}`;
}
export function commonDenominator(a: number, b: number): number {
  const reducedValue = rational(a, b);
  const result = BigInt(reducedValue.numerator) * BigInt(b);
  if (a < 1 || b < 1 || result > limit)
    throw new Error('Common denominator needs bounded positive integers.');
  return Number(result);
}
