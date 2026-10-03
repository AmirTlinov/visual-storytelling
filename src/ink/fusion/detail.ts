import type { InkPatch, InkVertices } from './motion.js';

const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

/** Suppress unreadable stroke fragments after deformation, in displayed coordinates. */
export function inkDetailVisibility(patches: readonly InkPatch[], text: boolean) {
  const counts = Array<number>(Math.max(...patches.map((patch) => patch.source)) + 1).fill(0);
  for (const patch of patches)
    for (const [offset, length] of patch.ranges)
      counts[patch.source] = Math.max(counts[patch.source]!, (offset + length) / 6);
  const output = counts.map((count) => new Float32Array(count).fill(1));
  return (vertices: InkVertices, morph: number, pixel: number) => {
    // Punctuation and fine handwriting remain exact at both ends. During travel,
    // detail emerges only once its footprint is large enough to read as a stroke.
    const active = text ? smooth(morph / 0.08) * smooth((1 - morph) / 0.18) : 0;
    if (!active) {
      output.forEach((values) => values.fill(1));
      return output;
    }
    for (const patch of patches) {
      const data = vertices[patch.source]!,
        values = output[patch.source]!;
      for (const [offset, length] of patch.ranges) {
        let left = Infinity,
          right = -Infinity,
          top = Infinity,
          bottom = -Infinity,
          radius = 0;
        for (let i = offset; i < offset + length; i += 6) {
          left = Math.min(left, data[i]!, data[i + 2]!);
          right = Math.max(right, data[i]!, data[i + 2]!);
          top = Math.min(top, data[i + 1]!, data[i + 3]!);
          bottom = Math.max(bottom, data[i + 1]!, data[i + 3]!);
          radius = Math.max(radius, data[i + 4]!, data[i + 5]!);
        }
        const footprint = Math.max(right - left, bottom - top) + 2 * radius;
        const minimum = Math.max(8 * pixel, 10 * radius);
        const visible = smooth((footprint - minimum) / (minimum * 0.6));
        values.fill(1 - active * (1 - visible), offset / 6, (offset + length) / 6);
      }
    }
    return output;
  };
}
