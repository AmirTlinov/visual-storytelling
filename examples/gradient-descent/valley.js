// The domain owns the quadratic and the update. MathMorph owns all drawing.
export const rotation = (35 * Math.PI) / 180;
const c = Math.cos(rotation),
  s = Math.sin(rotation);
export const n = (value) => Number(value.toFixed(3)).toString().replace('-', '−');
export const xy = ([u, v]) => [c * u - s * v, s * u + c * v];
export const loss = ([u, v]) => (u * u + 12 * v * v) / 2;
export const lift = (uv) => {
  const [x, y] = xy(uv);
  return [x, 0.16 * loss(uv), -y];
};
export function iterate(uv, step, preconditioned = false) {
  return [uv[0] * (1 - step), uv[1] * (1 - (preconditioned ? 1 : 12) * step)];
}
export function pathAt(start, step, k, preconditioned = false) {
  const whole = Math.floor(k),
    fraction = k - whole;
  const a = [
    start[0] * (1 - step) ** whole,
    start[1] * (1 - (preconditioned ? 1 : 12) * step) ** whole,
  ];
  const b = iterate(a, step, preconditioned);
  return a.map((value, i) => value + fraction * (b[i] - value));
}
