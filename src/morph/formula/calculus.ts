// Positive nodes and weights of the embedded Gauss 7 / Kronrod 15 rule on [-1,1].
// Numerical table: https://github.com/scipy/scipy/blob/main/scipy/integrate/_quad_vec.py
const nodes = [
  0.9914553711208126, 0.9491079123427585, 0.8648644233597691, 0.7415311855993944,
  0.5860872354676911, 0.4058451513773972, 0.2077849550078985,
];
const kronrod = [
  0.02293532201052922, 0.06309209262997855, 0.1047900103222502, 0.1406532597155259,
  0.1690047266392679, 0.1903505780647854, 0.2044329400752989, 0.2094821410847278,
];
const gauss = [0.1294849661688697, 0.2797053914892767, 0.3818300505051189, 0.4179591836734694];
const midpoint = (a: number, b: number) =>
  Number.isFinite(b - a) ? a + (b - a) / 2 : a / 2 + b / 2;
const spanProduct = (a: number, b: number, mean: number) =>
  Number.isFinite(b - a) ? (b - a) * mean : (b / 2 - a / 2) * mean * 2;

/** Adaptive Gauss–Kronrod integration. All evaluation happens before publishing a scene. */
export function integrate(fn: (x: number) => number, from: number, to: number) {
  if (!Number.isFinite(from) || !Number.isFinite(to))
    throw new Error('Integral bounds must be finite');
  if (from === to) return 0;
  let calls = 0;
  const failed = () => new Error('Integral did not converge; check its interval and singularities');
  const value = (x: number) => {
    if (++calls > 8192) throw failed();
    const y = fn(x);
    if (!Number.isFinite(y))
      throw new Error('The integrand must be finite throughout the interval');
    return y;
  };
  function panel(a: number, b: number) {
    const middle = midpoint(a, b),
      half = Number.isFinite(b - a) ? (b - a) / 2 : b / 2 - a / 2,
      center = value(middle),
      samples = new Float64Array(14);
    // Normalized weights form finite means even for a large integrand on a short interval.
    let fine = (center * kronrod[7]!) / 2,
      coarse = (center * gauss[3]!) / 2,
      absolute = (Math.abs(center) * kronrod[7]!) / 2;
    for (let i = 0; i < nodes.length; i++) {
      const offset = half * nodes[i]!,
        left = value(middle - offset),
        right = value(middle + offset),
        weight = kronrod[i]! / 2;
      samples[i * 2] = left;
      samples[i * 2 + 1] = right;
      fine += left * weight + right * weight;
      absolute += Math.abs(left) * weight + Math.abs(right) * weight;
      if (i % 2) coarse += (left * gauss[(i - 1) / 2]!) / 2 + (right * gauss[(i - 1) / 2]!) / 2;
    }
    const result = spanProduct(a, b, fine);
    if (!Number.isFinite(result)) throw new Error('The integral must have a finite real value');
    let deviation = (Math.abs(center - fine) * kronrod[7]!) / 2;
    for (let i = 0; i < nodes.length; i++)
      deviation +=
        (Math.abs(samples[i * 2]! - fine) / 2 + Math.abs(samples[i * 2 + 1]! - fine) / 2) *
        kronrod[i]!;
    deviation = spanProduct(a, b, deviation);
    let error = Math.abs(result - spanProduct(a, b, coarse));
    if (deviation > 0 && error > 0)
      error = deviation * Math.min(1, (200 * (error / deviation)) ** 1.5);
    error = Math.max(error, spanProduct(a, b, absolute * (50 * Number.EPSILON)));
    return { result, error };
  }
  const a = Math.min(from, to),
    b = Math.max(from, to);
  // The public contract requires a finite integrand on the closed interval;
  // the quadrature nodes themselves intentionally avoid its endpoints.
  value(a);
  value(b);
  const initial = panel(a, b),
    tolerance = 1e-8 * Math.max(1, Math.abs(initial.result));
  function refine(
    a: number,
    b: number,
    estimate: ReturnType<typeof panel>,
    eps: number,
    depth: number,
  ): number {
    if (estimate.error <= eps) return estimate.result;
    const middle = midpoint(a, b);
    if (!depth || middle === a || middle === b) throw failed();
    return (
      refine(a, middle, panel(a, middle), eps / 2, depth - 1) +
      refine(middle, b, panel(middle, b), eps / 2, depth - 1)
    );
  }
  const result = (to < from ? -1 : 1) * refine(a, b, initial, tolerance, 18);
  if (!Number.isFinite(result)) throw new Error('The integral must have a finite real value');
  return result;
}
