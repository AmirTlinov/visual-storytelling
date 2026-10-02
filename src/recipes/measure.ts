import { object } from '../ink/object.js';
import { lettering } from '../ink/lettering.js';
import type { Surface } from '../ink/surface.js';
import type { Pigment } from '../ink/palette.js';
import type { Point } from '../ink/pen.js';

/** Endpoints and unit scale determine both the measured value and its annotation. */
export function measure(
  view: Surface,
  id: string,
  options: {
    from: Point;
    to: Point;
    pixelsPerUnit: number;
    unit: string;
    offset?: number;
    pigment?: Pigment;
    size?: number;
  },
) {
  if (!(options.pixelsPerUnit > 0)) throw new Error('Measurement scale must be positive');
  const { from, to } = options;
  const dx = to[0] - from[0],
    dy = to[1] - from[1];
  const length = Math.hypot(dx, dy),
    offset = options.offset ?? -18;
  const mark = object(view.layer, id, options.pigment ?? 'blue');
  mark.at(from[0], from[1], (Math.atan2(dy, dx) * 180) / Math.PI);
  const line = view.pen.path(
    mark.content,
    `${id}:line`,
    `M0 ${offset} Q${length / 2} ${offset - 0.4} ${length} ${offset} M0 ${offset - 4} v8 M${length} ${offset - 4} v8`,
  );
  const value = Math.round((length / options.pixelsPerUnit) * 1000) / 1000;
  const label = lettering(mark.content, `${value} ${options.unit}`, {
    x: length / 2,
    y: offset - 9,
    size: options.size ?? 24,
  });
  return {
    ...mark,
    value,
    label,
    reveal(lineProgress: number, labelProgress = lineProgress) {
      line.reveal(lineProgress);
      label.write(labelProgress);
    },
  };
}
