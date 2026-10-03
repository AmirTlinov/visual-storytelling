export const clamp = (x: number) => Math.max(0, Math.min(1, x));
export const smooth = (p: number) => {
  p = clamp(p);
  return p * p * (3 - 2 * p);
};
export const mix = (a: number, b: number, p: number) => a + (b - a) * p;
export const mathNumber = (n: number) => Number(n.toPrecision(4)).toString().replace('-', '−');
export function equation(expression: string, result: number, inputs: readonly number[] = []) {
  const rounded = [...inputs, result].some(
    (n) => Math.abs(Number(n.toPrecision(4)) - n) > Math.abs(n) * Number.EPSILON * 8,
  );
  return `${expression} ${rounded ? '≈' : '='} ${mathNumber(result)}`;
}
