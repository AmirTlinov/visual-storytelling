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
  let b = union(boxes);
  b = {
    x: b.x - margin,
    y: b.y - margin,
    width: b.width + 2 * margin,
    height: b.height + 2 * margin,
  };
  if (!shot) b = union([{ x: 0, y: 0, width, height }, b]);
  const w = Math.max(b.width, (b.height * width) / height),
    h = (w * height) / width;
  return { x: b.x + (b.width - w) / 2, y: b.y + (b.height - h) / 2, width: w, height: h };
}
