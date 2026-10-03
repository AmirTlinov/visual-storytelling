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
