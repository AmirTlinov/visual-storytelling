/** Centerline samples with a local ink radius, in shape coordinates. */
export type InkPoint = readonly [x: number, y: number, radius: number];
export type InkPath = readonly InkPoint[];
export interface InkRoute {
  source: number;
  /** Shape receiving this route; target identifies its stroke across all destination shapes. */
  destination: number;
  target: number;
  origin: number;
  /** A disjoint part of a shared destination contour. */
  part?: number;
  /** Surplus ink joins this sample of the target's sole owning stroke. */
  attachment?: number;
  text?: {
    from: readonly [number, number];
    glyph: number;
    origin: number;
    same: boolean;
    /** Original ink with its own destination span; generated seeds wait until readable. */
    established: boolean;
    word: number;
    originWord: number;
    wordSame: boolean;
    fromWord: readonly [number, number];
    toWord: readonly [number, number];
  };
  from: InkPoint[];
  to: InkPoint[];
}

function length(path: InkPath) {
  let value = 0;
  for (let i = 1; i < path.length; i++)
    value += Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1]);
  return value;
}
function center(path: InkPath): [number, number] {
  return [
    path.reduce((s, p) => s + p[0], 0) / path.length,
    path.reduce((s, p) => s + p[1], 0) / path.length,
  ];
}
function resample(path: InkPath, count: number): InkPoint[] {
  const distances = [0];
  for (let i = 1; i < path.length; i++)
    distances.push(
      distances[i - 1]! + Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1]),
    );
  const total = distances.at(-1)!;
  let at = 1;
  return Array.from({ length: count }, (_, i) => {
    if (!total) return [...path[0]!] as [number, number, number];
    const wanted = (total * i) / (count - 1);
    while (at < path.length - 1 && distances[at]! < wanted) at++;
    const t = (wanted - distances[at - 1]!) / (distances[at]! - distances[at - 1]! || 1);
    const a = path[at - 1]!,
      b = path[at]!;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  });
}

/** Partition arc length without duplicating or dropping the original contour. */
function sections(path: InkPath, weights: number[]): InkPath[] {
  if (weights.length === 1) return [path];
  const samples = resample(path, Math.max(2, Math.ceil(length(path) / 0.75)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const at = (fraction: number): InkPoint => {
    const f = Math.max(0, Math.min(samples.length - 1, fraction * (samples.length - 1))),
      index = Math.floor(f),
      t = f - index;
    const a = samples[index]!,
      b = samples[Math.min(index + 1, samples.length - 1)]!;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  };
  let start = 0;
  return weights.map((weight) => {
    const end = start + weight / total;
    const section: InkPoint[] = [at(start)];
    for (let i = Math.floor(start * (samples.length - 1)) + 1; i < end * (samples.length - 1); i++)
      section.push(samples[i]!);
    section.push(at(end));
    start = end;
    return section;
  });
}

/** Choose direction (and loop seam) before interpolation, avoiding twisting strokes. */
function align(a: InkPoint[], b: InkPoint[]): InkPoint[] {
  const ca = center(a),
    cb = center(b),
    n = a.length;
  const closed = (p: InkPoint[]) =>
    p.length > 2 &&
    Math.hypot(p[0]![0] - p.at(-1)![0], p[0]![1] - p.at(-1)![1]) < Math.min(1.5, length(p) * 0.05);
  const loop = closed(a) && closed(b);
  let best = Infinity,
    result = b;
  for (const direction of [1, -1]) {
    for (let shift = 0; shift < (loop ? n - 1 : 1); shift++) {
      const candidate = b.map(
        (_, i) =>
          b[
            loop
              ? (shift + direction * (i % (n - 1)) + n - 1) % (n - 1)
              : direction === 1
                ? i
                : n - 1 - i
          ]!,
      );
      let cost = 0;
      for (let i = 0; i < n; i++) {
        const dx = a[i]![0] - ca[0] - candidate[i]![0] + cb[0];
        const dy = a[i]![1] - ca[1] - candidate[i]![1] + cb[1];
        cost += dx * dx + dy * dy;
      }
      if (cost < best) {
        best = cost;
        result = candidate;
      }
    }
  }
  return result;
}

/** Minimum-cost correspondence: text shares destination spans; filled masks absorb surplus ink. */
export function inkRoutes(
  inputs: readonly (readonly InkPath[])[],
  outputs: readonly (readonly InkPath[])[],
  { local = false, partitionTargets = false }: { local?: boolean; partitionTargets?: boolean } = {},
): InkRoute[] {
  const source = inputs.flatMap((paths, source) => paths.map((path) => ({ path, source })));
  const destinations = outputs.flatMap((paths, destination) =>
    paths.map((path) => ({ path, destination })),
  );
  const target = destinations.map(({ path }) => path);
  if (!source.length || !target.length)
    throw new Error('Ink transport requires visible source and target paths');
  const centers = source.map(({ path }) => center(path)),
    centersTo = target.map(center);
  // Normalize each shape into its own span. Source and destination order stay explicit.
  function extent(paths: readonly InkPath[]) {
    const xs = paths.flatMap((path) => path.map((p) => p[0]));
    return xs.length ? ([Math.min(...xs), Math.max(...xs)] as const) : ([0, 1] as const);
  }
  function spans(shapes: readonly (readonly InkPath[])[]) {
    const bounds = shapes.map(extent),
      widths = bounds.map(([a, b], i) => (shapes[i]!.length ? Math.max(1, b - a) : 0));
    let total = 0;
    const offsets = widths.map((width) => {
      const offset = total;
      total += width;
      return offset;
    });
    return { bounds, offsets, total };
  }
  const from = spans(inputs),
    to = spans(outputs);
  const cost = source.map(({ path, source: group }, i) =>
    target.map((pathTo, j) => {
      const destination = destinations[j]!.destination;
      const rank = (centers[i]![0] - from.bounds[group]![0] + from.offsets[group]!) / from.total;
      const destinationRank =
        (centersTo[j]![0] - to.bounds[destination]![0] + to.offsets[destination]!) / to.total;
      const a = resample(path, 12),
        b = align(a, resample(pathTo, 12));
      let shape = 0;
      for (let k = 0; k < a.length; k++)
        shape +=
          ((a[k]![0] - centers[i]![0] - b[k]![0] + centersTo[j]![0]) ** 2 +
            (a[k]![1] - centers[i]![1] - b[k]![1] + centersTo[j]![1]) ** 2) /
          12;
      return (
        (local
          ? (centers[i]![0] - centersTo[j]![0]) ** 2 +
            (centers[i]![1] - centersTo[j]![1]) ** 2 +
            // Symmetric incoming loops still have an order: do not swap their
            // destinations and send one projection through the other.
            (rank - destinationRank) ** 2 * 400
          : (rank - destinationRank) ** 2 * 40000) +
        shape +
        Math.log((length(path) + 3) / (length(pathTo) + 3)) ** 2 * 180
      );
    }),
  );
  // Hungarian assignment of the smaller set into the larger set, then closest attachment
  // for the remaining strokes.
  const transpose = source.length < target.length;
  const n = Math.min(source.length, target.length),
    m = Math.max(source.length, target.length);
  const price = (i: number, j: number) => (transpose ? cost[i]![j]! : cost[j]![i]!);
  const u = new Float64Array(n + 1),
    v = new Float64Array(m + 1),
    p = new Int32Array(m + 1),
    way = new Int32Array(m + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const min = new Float64Array(m + 1).fill(Infinity),
      used = new Uint8Array(m + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0]!;
      let delta = Infinity,
        j1 = 0;
      for (let j = 1; j <= m; j++)
        if (!used[j]) {
          const cur = price(i0 - 1, j - 1) - u[i0]! - v[j]!;
          if (cur < min[j]!) {
            min[j] = cur;
            way[j] = j0;
          }
          if (min[j]! < delta) {
            delta = min[j]!;
            j1 = j;
          }
        }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]!]! += delta;
          v[j]! -= delta;
        } else min[j]! -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0);
  }
  const pairs: [number, number][] = [];
  const owners = new Map<number, number>();
  for (let j = 1; j <= m; j++) {
    let i = p[j]! - 1;
    if (i < 0) {
      i = 0;
      for (let k = 1; k < n; k++) if (price(k, j - 1) < price(i, j - 1)) i = k;
    }
    const pair: [number, number] = transpose ? [i, j - 1] : [j - 1, i];
    pairs.push(pair);
    if (transpose || p[j]) owners.set(pair[1], pair[0]);
  }
  // When one original supplies several final strokes, divide its arc length.
  // Reusing the whole path would sprout duplicate loops before they could settle.
  const pieces = new Map<string, InkPath>();
  source.forEach(({ path }, i) => {
    const destinations = pairs
      .filter(([from]) => from === i)
      .map(([, to]) => to)
      .sort(
        (a, b) =>
          center(target[a]!)[0] - center(target[b]!)[0] ||
          center(target[a]!)[1] - center(target[b]!)[1],
      );
    const weights = destinations.map((j) => Math.max(3, length(target[j]!)));
    sections(path, weights).forEach((section, k) => pieces.set(`${i}:${destinations[k]}`, section));
  });
  const receiving = new Map<string, InkPath>();
  if (partitionTargets)
    target.forEach((path, j) => {
      const stations = resample(path, 64);
      const nearest = (i: number) => {
        const c = center(pieces.get(`${i}:${j}`)!);
        let best = 0;
        for (let k = 1; k < stations.length; k++)
          if (
            Math.hypot(stations[k]![0] - c[0], stations[k]![1] - c[1]) <
            Math.hypot(stations[best]![0] - c[0], stations[best]![1] - c[1])
          )
            best = k;
        return best;
      };
      const suppliers = pairs
        .filter(([, to]) => to === j)
        .map(([i]) => i)
        .sort((a, b) => nearest(a) - nearest(b) || centers[a]![0] - centers[b]![0] || a - b);
      const weights = suppliers.map((i) => Math.max(3, length(pieces.get(`${i}:${j}`)!)));
      sections(path, weights).forEach((section, k) =>
        receiving.set(`${suppliers[k]}:${j}`, section),
      );
    });
  const counts = partitionTargets
    ? []
    : target.map((to, j) =>
        Math.max(
          2,
          Math.ceil(
            Math.max(
              length(to),
              ...pairs
                .filter(([, index]) => index === j)
                .map(([i]) => length(pieces.get(`${i}:${j}`)!)),
            ) / 2.5,
          ),
        ),
      );
  return pairs.map(([i, j]) => {
    const into = receiving.get(`${i}:${j}`) ?? target[j]!;
    const count = partitionTargets
      ? Math.max(2, Math.ceil(Math.max(length(into), length(pieces.get(`${i}:${j}`)!)) / 2.5))
      : counts[j]!;
    const b = resample(into, count),
      a = align(b, resample(pieces.get(`${i}:${j}`)!, count));
    if (!partitionTargets && owners.get(j) !== i) {
      // A second complete target would produce a displaced copy of the letter.
      // Feed surplus ink into the nearest point of the one owning contour.
      const c = center(a);
      let attachment = 0;
      for (let k = 1; k < b.length; k++)
        if (
          Math.hypot(b[k]![0] - c[0], b[k]![1] - c[1]) <
          Math.hypot(b[attachment]![0] - c[0], b[attachment]![1] - c[1])
        )
          attachment = k;
      return {
        source: source[i]!.source,
        destination: destinations[j]!.destination,
        origin: i,
        target: j,
        attachment,
        from: a,
        to: b.map(() => b[attachment]!),
      };
    }
    return {
      source: source[i]!.source,
      destination: destinations[j]!.destination,
      origin: i,
      target: j,
      ...(partitionTargets ? { part: i } : {}),
      from: a,
      to: b,
    };
  });
}
