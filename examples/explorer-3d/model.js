// One cell is one cubic centimetre; x runs along a row, z through rows, y through layers.
export const ease = (p) => {
  p = Math.max(0, Math.min(1, p));
  return p * p * (3 - 2 * p);
};
export const part = (p, start, end = 1) => ease((p - start) / (end - start));
export function volume({ x, y, z }) {
  return x * y * z;
}
export function lessonState(frame) {
  return {
    x: frame.finished('compare_view') ? 6 : 3,
    extent: 3 + 3 * part(frame.progress('compare_view'), 0.32, 1),
    y: 2,
    z: 2,
    place: frame.progress('place_unit'),
    row: frame.progress('complete_row'),
    layer: frame.progress('complete_layer'),
    stack: frame.progress('complete_stack'),
    extension: frame.progress('fill_extension'),
  };
}
export function cellState(x, y, z, state, exploring = false) {
  const target = [x + 0.5, y + 0.5, -z - 0.5];
  if (exploring)
    return { visible: x < state.x && y < state.y && z < state.z, position: target, settled: true };
  if (x >= 6 || y >= 2 || z >= 2) return { visible: false, position: target, settled: false };
  if (x === 0 && y === 0 && z === 0) {
    const p = ease(state.place);
    return {
      visible: true,
      position: [-1.75 + 2.25 * p, 0.5 + 0.7 * Math.sin(p * Math.PI), 0.3 - 0.8 * p],
      settled: p === 1,
    };
  }
  let p, offset;
  if (x >= 3) {
    p = ease(state.extension);
    offset = [3 * (1 - p), 0, 0];
  } else if (y > 0) {
    p = ease(state.stack);
    offset = [0, 1.75 * (1 - p), 0];
  } else if (z > 0) {
    p = ease(state.layer);
    offset = [0, 1.3 * (1 - p), 0];
  } else {
    p = part(state.row, (x - 1) * 0.42, (x - 1) * 0.42 + 0.58);
    offset = [0, 1.3 * (1 - p), 0];
  }
  return { visible: p > 0, position: target.map((n, i) => n + offset[i]), settled: p === 1 };
}
