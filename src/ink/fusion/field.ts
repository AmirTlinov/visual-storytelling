/** Negative inside. The rounded union creates a neck before two ink surfaces touch. */
export function tensionUnion(a: number, b: number, radius: number): number {
  if (radius <= 0) return Math.min(a, b);
  const neck = Math.max(radius - Math.abs(a - b), 0) / radius;
  return Math.min(a, b) - neck * neck * radius * 0.25;
}

/** Exact Euclidean distance to foreground/background on a coverage mask. */
export function signedDistance(alpha: Uint8Array, width: number, height: number): Float32Array {
  if (alpha.length !== width * height) throw new Error('Mask dimensions do not match coverage');
  const size = Math.max(width, height);
  const row = new Float64Array(size),
    out = new Float64Array(size);
  const sites = new Int32Array(size),
    limits = new Float64Array(size + 1);
  function line(n: number) {
    let k = 0;
    sites[0] = 0;
    limits[0] = -Infinity;
    limits[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let s = 0;
      do {
        const p = sites[k]!;
        s = (row[q]! + q * q - row[p]! - p * p) / (2 * (q - p));
        if (s > limits[k]!) break;
        k--;
      } while (k >= 0);
      sites[++k] = q;
      limits[k] = s;
      limits[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (limits[k + 1]! < q) k++;
      out[q] = (q - sites[k]!) ** 2 + row[sites[k]!]!;
    }
  }
  function to(inside: boolean) {
    const field = Float32Array.from(alpha, (value) => (value > 127 === inside ? 0 : 1e10));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) row[x] = field[y * width + x]!;
      line(width);
      for (let x = 0; x < width; x++) field[y * width + x] = out[x]!;
    }
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) row[y] = field[y * width + x]!;
      line(height);
      for (let y = 0; y < height; y++) field[y * width + x] = out[y]!;
    }
    return field;
  }
  const foreground = to(true),
    background = to(false);
  return foreground.map((value, i) => {
    const coverage = alpha[i]! / 255;
    if (coverage > 0 && coverage < 1) return 0.5 - coverage;
    const d = Math.sqrt(value) - Math.sqrt(background[i]!);
    return d > 0 ? d - 0.5 : d + 0.5;
  });
}

/** Choose the isocontour by ink area so thin strokes survive a change of topology. */
export function relaxationAt(t: number) {
  const ease = (n: number) => {
    n = Math.max(0, Math.min(1, n));
    return n * n * (3 - 2 * n);
  };
  return ease(t / 0.2) * ease((1 - t) / 0.2);
}

/** Heat diffusion rounds the Voronoi ridges that would otherwise pinch thin strokes. */
export function relaxField(field: Float32Array, width: number, sigma: number): Float32Array {
  if (sigma <= 0) return field.slice();
  const height = field.length / width,
    radius = Math.ceil(sigma * 3);
  const kernel = Float32Array.from({ length: radius * 2 + 1 }, (_, i) =>
    Math.exp(-(((i - radius) / sigma) ** 2) / 2),
  );
  const sum = kernel.reduce((total, value) => total + value, 0);
  for (let i = 0; i < kernel.length; i++) kernel[i] = kernel[i]! / sum;
  const pass = new Float32Array(field.length),
    result = new Float32Array(field.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let value = 0;
      for (let k = -radius; k <= radius; k++)
        value += field[y * width + Math.max(0, Math.min(width - 1, x + k))]! * kernel[k + radius]!;
      pass[y * width + x] = value;
    }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let value = 0;
      for (let k = -radius; k <= radius; k++)
        value += pass[Math.max(0, Math.min(height - 1, y + k)) * width + x]! * kernel[k + radius]!;
      result[y * width + x] = value;
    }
  return result;
}

export function areaThresholds(
  from: Float32Array,
  to: Float32Array,
  steps = 49,
  relaxed?: readonly [Float32Array, Float32Array],
): Float32Array {
  if (from.length !== to.length || !from.length)
    throw new Error('Morph fields need equal dimensions');
  const countA = from.reduce((n, d) => n + Number(d <= 0), 0);
  const countB = to.reduce((n, d) => n + Number(d <= 0), 0);
  const thresholds = new Float32Array(steps),
    values = new Float32Array(from.length);
  const histogram = new Uint32Array(2048);
  for (let step = 1; step < steps - 1; step++) {
    const t = step / (steps - 1);
    const relaxation = relaxed ? relaxationAt(t) : 0;
    let low = Infinity,
      high = -Infinity;
    for (let i = 0; i < values.length; i++) {
      const raw = from[i]! * (1 - t) + to[i]! * t;
      const smooth = relaxed ? relaxed[0][i]! * (1 - t) + relaxed[1][i]! * t : raw;
      const d = raw * (1 - relaxation) + smooth * relaxation;
      values[i] = d;
      low = Math.min(low, d);
      high = Math.max(high, d);
    }
    histogram.fill(0);
    const unit = (high - low || 1) / (histogram.length - 1);
    for (const value of values)
      histogram[Math.min(2047, Math.max(0, Math.floor((value - low) / unit)))]!++;
    const wanted = Math.round(countA * (1 - t) + countB * t);
    let count = 0,
      bin = 0;
    while (bin < histogram.length - 1 && count + histogram[bin]! < wanted)
      count += histogram[bin++]!;
    const fraction = histogram[bin] ? (wanted - count) / histogram[bin]! : 0.5;
    thresholds[step] = low + (bin + fraction) * unit;
  }
  return thresholds;
}
