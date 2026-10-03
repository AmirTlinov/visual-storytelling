import * as T from './engine.js';

export type Point3 = readonly [number, number, number];
export interface TensorCell {
  box: T.Object3D;
  base: T.Vector3;
  text?: { show(visible: boolean): void };
}
export interface TensorHandle {
  group: T.Group;
  cells: TensorCell[];
  reveal(progress: number): void;
  highlight(index: number): void;
  titleLabel?: { show(visible: boolean): void } | null;
}
const clamp = (p: number) => Math.max(0, Math.min(1, p));
const smooth = (p: number) => {
  p = clamp(p);
  return p * p * (3 - 2 * p);
};
const range = (p: number, start: number, end: number) => smooth((p - start) / (end - start));

/** Reposition the original rows: separate their lanes before closing horizontal gaps. */
export function arrangeTensorRows(rows: TensorHandle[], targets: Point3[]) {
  if (rows.length !== targets.length) throw new Error('Each tensor row needs one destination');
  const starts = rows.map((row) => row.group.position.clone());
  return (progress: number) => {
    const vertical = range(progress, 0, 0.58),
      horizontal = range(progress, 0.42, 1);
    rows.forEach((row, i) => {
      const from = starts[i]!,
        to = targets[i]!;
      row.group.position.set(
        from.x + (to[0] - from.x) * horizontal,
        from.y + (to[1] - from.y) * vertical,
        from.z + (to[2] - from.z) * vertical,
      );
    });
  };
}

/** The receiving cells themselves travel and remain on arrival; no second result is created. */
export function deliverTensorCells(
  target: TensorHandle,
  options: { from: Point3[]; start?: number; end?: number },
) {
  if (options.from.length !== target.cells.length)
    throw new Error('Each tensor cell needs an origin');
  const start = options.start ?? 0,
    end = options.end ?? 1;
  if (!(end > start)) throw new Error('A tensor delivery needs a positive time interval');
  const destinations = target.cells.map((c) => c.base.clone());
  const origins = options.from.map((p) => new T.Vector3(...p));
  return (progress: number | readonly number[]) => {
    target.reveal(1);
    const phases = target.cells.map((_, i) =>
      clamp(((typeof progress === 'number' ? progress : progress[i]!) - start) / (end - start)),
    );
    target.cells.forEach((cell, i) => {
      const p = phases[i]!,
        travel = range(p, 0.18, 0.9);
      cell.box.visible = p > 0;
      cell.box.position.copy(origins[i]!).lerp(destinations[i]!, travel);
      cell.box.scale.setScalar(Math.max(0.001, range(p, 0, 0.18)));
      cell.text?.show(p >= 0.18);
    });
    target.titleLabel?.show(phases.every((p) => p >= 0.9));
    return phases.map((p) => p >= 0.9);
  };
}

/** Pair -> evaluate -> deliver -> hold. Inputs keep their own slots; only the result travels. */
export function calculateTensorColumns(
  inputs: TensorHandle[],
  output: TensorHandle,
  { lift = 0.7, parallel = false }: { lift?: number; parallel?: boolean } = {},
) {
  const count = output.cells.length;
  if (!count || inputs.some((row) => row.cells.length !== count))
    throw new Error('Coordinate-wise arithmetic requires equal, non-empty rows');
  const deliver = deliverTensorCells(output, {
    from: output.cells.map((c) => [c.base.x, c.base.y + lift, c.base.z] as Point3),
    start: 0.38,
    end: 0.96,
  });
  return (progress: number) => {
    const p = clamp(progress),
      index = Math.min(count - 1, Math.floor(p * count));
    const phases = output.cells.map((_, i) => (parallel ? p : clamp(p * count - i)));
    const active = p > 0 && p < 1;
    for (const row of inputs) row.highlight(active && !parallel ? index : -1);
    const arrived = deliver(phases);
    return { index, phases, arrived, active, evaluated: phases[index]! >= 0.38 };
  };
}
