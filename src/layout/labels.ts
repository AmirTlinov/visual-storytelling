export interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Closest readable placement in a prepared vertical order. No frame history or side swapping. */
export function placeLabels(preferred: readonly LabelBox[], area: LabelBox) {
  const gap = 8;
  const placed = preferred.map((box) => ({
    ...box,
    x: Math.max(area.x, Math.min(area.x + area.width - box.width, box.x)),
  }));
  const centers = placed.map((box) => box.y + box.height / 2);
  // Each constraint is a half-space a·y >= b. Dykstra projection retains the closest solution;
  // unlike attraction/repulsion, it does not settle while labels still overlap.
  const constraints: { i: number; j?: number; sign: number; distance: number; dual: number }[] = [];
  placed.forEach((box, i) => {
    constraints.push(
      { i, sign: 1, distance: area.y + box.height / 2, dual: 0 },
      { i, sign: -1, distance: -(area.y + area.height - box.height / 2), dual: 0 },
    );
    for (let j = i + 1; j < placed.length; j++) {
      const other = placed[j]!;
      const clearance =
        Math.abs(box.x + box.width / 2 - other.x - other.width / 2) - (box.width + other.width) / 2;
      // Start making room before contact. The full separation is already active at an 8 px gap.
      const t = Math.max(0, Math.min(1, (gap + 24 - clearance) / 24));
      if (t === 0) continue;
      const contact = t * t * (3 - 2 * t);
      constraints.push({
        i,
        j,
        sign: -1,
        distance: contact * ((box.height + other.height) / 2 + gap) - (1 - contact) * area.height,
        dual: 0,
      });
    }
  });
  for (let iteration = 0; iteration < Math.max(256, 64 * placed.length ** 2); iteration++) {
    let change = 0;
    for (const constraint of constraints) {
      const { i, j, sign, distance } = constraint;
      const value = sign * centers[i]! + (j === undefined ? 0 : centers[j]!);
      const dual = Math.max(0, constraint.dual + (distance - value) / (j === undefined ? 1 : 2));
      const step = dual - constraint.dual;
      centers[i]! += sign * step;
      if (j !== undefined) centers[j]! += step;
      constraint.dual = dual;
      change = Math.max(change, Math.abs(step));
    }
    if (change < 1e-7) break;
  }
  placed.forEach((box, i) => {
    box.y = centers[i]! - box.height / 2;
  });
  return placed;
}
