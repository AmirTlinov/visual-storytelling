import type { InkPath, InkPoint } from './transport.js';

/** Thin a coverage mask, then retain its original local radii to reconstruct filled ink. */
export function medialPaths(
  distance: Float32Array,
  width: number,
  height: number,
  unit: number,
): InkPath[] {
  const ink = Uint8Array.from(distance, (d) => Number(d < 0));
  let live = Array.from(ink.keys()).filter((i) => ink[i]);
  const ring = [-width, -width + 1, 1, width + 1, width, width - 1, -1, -width - 1];
  // Keep one deepest sample per component. An even-sized disk can otherwise lose
  // its final 2×2 plateau in a parallel thinning pass.
  const anchors = new Set<number>(),
    visited = new Uint8Array(ink.length);
  for (const start of live) {
    if (visited[start]) continue;
    const queue = [start];
    visited[start] = 1;
    let deepest = start;
    for (let at = 0; at < queue.length; at++) {
      const i = queue[at]!;
      if (distance[i]! < distance[deepest]!) deepest = i;
      for (const offset of ring) {
        const next = i + offset;
        if (ink[next] && !visited[next] && Math.abs((next % width) - (i % width)) <= 1) {
          visited[next] = 1;
          queue.push(next);
        }
      }
    }
    anchors.add(deepest);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      const remove: number[] = [];
      for (const i of live) {
        if (anchors.has(i)) continue;
        const x = i % width,
          y = Math.floor(i / width);
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) continue;
        const p = ring.map((offset) => ink[i + offset]!);
        const count = p.reduce((a, b) => a + b, 0);
        if (count < 2 || count > 6) continue;
        let transitions = 0;
        for (let j = 0; j < 8; j++) if (!p[j] && p[(j + 1) % 8]) transitions++;
        if (transitions !== 1) continue;
        if (
          pass === 0
            ? p[0]! * p[2]! * p[4]! || p[2]! * p[4]! * p[6]!
            : p[0]! * p[2]! * p[6]! || p[0]! * p[4]! * p[6]!
        )
          continue;
        remove.push(i);
      }
      if (remove.length) {
        changed = true;
        remove.forEach((i) => (ink[i] = 0));
        live = live.filter((i) => ink[i]);
      }
    }
  }
  const neighbors = (i: number) =>
    ring
      .filter((offset, k) => {
        if (!ink[i + offset]) return false;
        if (k % 2 && (ink[i + ring[k - 1]!] || ink[i + ring[(k + 1) % 8]!])) return false;
        return Math.abs(((i + offset) % width) - (i % width)) <= 1;
      })
      .map((offset) => i + offset);
  const adjacent = new Map(live.map((i) => [i, neighbors(i)]));
  const seen = new Set<string>(),
    paths: InkPoint[][] = [];
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  const point = (i: number): InkPoint => [
    ((i % width) + 0.5 - width / 2) * unit,
    (Math.floor(i / width) + 0.5 - height / 2) * unit,
    Math.max(unit / 2, -distance[i]! + unit * 0.35),
  ];
  const trace = (start: number, next: number) => {
    const points = [point(start)];
    let previous = start,
      at = next;
    while (!seen.has(key(previous, at))) {
      seen.add(key(previous, at));
      points.push(point(at));
      const links = adjacent.get(at)!;
      if (links.length !== 2) break;
      const following = links.find((i) => i !== previous)!;
      previous = at;
      at = following;
    }
    paths.push(points);
  };
  for (const i of live) {
    const links = adjacent.get(i)!;
    if (!links.length) paths.push([point(i)]);
    else if (links.length !== 2)
      links.forEach((next) => {
        if (!seen.has(key(i, next))) trace(i, next);
      });
  }
  for (const i of live)
    adjacent.get(i)!.forEach((next) => {
      if (!seen.has(key(i, next))) trace(i, next);
    });
  return paths;
}
