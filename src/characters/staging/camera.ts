import type { Shot } from './types.js';
export interface FrameBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
export const union = (boxes: FrameBox[]): FrameBox => {
  const x = Math.min(...boxes.map((b) => b.x)),
    y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  };
};
export function stageFrame(
  width: number,
  height: number,
  objects: Readonly<Record<string, FrameBox>>,
  shot?: Shot,
): FrameBox {
  const keys = shot?.focus ?? Object.keys(objects),
    boxes = keys.map((id) => {
      const box = objects[id];
      if (!box) throw new Error(`Unknown camera subject: ${id}`);
      return box;
    });
  if (!boxes.length) return { x: 0, y: 0, width, height };
  const margin = shot?.framing === 'detail' ? 16 : shot?.framing === 'wide' ? 70 : 32;
  const subject = union(boxes);
  let b = {
    x: subject.x - margin,
    y: subject.y - margin,
    width: subject.width + 2 * margin,
    height: subject.height + 2 * margin,
  };
  if (!shot) b = union([{ x: 0, y: 0, width, height }, b]);
  const w = Math.max(b.width, (b.height * width) / height),
    h = (w * height) / width;
  const frame = { x: b.x + (b.width - w) / 2, y: b.y + (b.height - h) / 2, width: w, height: h };
  // Keep a smaller frame inside the room, or the room inside a larger frame.
  // Relax that interval only as far as the subject requires, preserving its fit
  // continuously as it crosses the set boundary; padding may shrink at an edge.
  for (const [position, size, extent] of [
    ['x', 'width', width],
    ['y', 'height', height],
  ] as const) {
    const edge = extent - frame[size],
      start = Math.min(0, edge, subject[position]),
      end = Math.max(0, edge, subject[position] + subject[size] - frame[size]);
    frame[position] = Math.max(start, Math.min(end, frame[position]));
  }
  return frame;
}
