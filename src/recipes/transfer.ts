import type { Surface } from '../ink/surface.js';
import type { Point } from '../ink/pen.js';
import type { Pigment } from '../ink/palette.js';
import { object } from '../ink/object.js';
import { token } from './tokens.js';
import { interpolate } from '../story/cues.js';

/** Arrival is a derived value, so back-seeking also restores the receiver. */
export function transfer(
  view: Surface,
  id: string,
  options: { from: Point; to: Point; value: string | number; pigment?: Pigment; size?: number },
) {
  const mark = object(view.layer, id, options.pigment ?? 'purple');
  const arrow = view.pen.arrow(mark.content, `${id}:route`, options.from, options.to);
  const packet = token(view, `${id}:packet`, options.value, {
    pigment: options.pigment ?? 'purple',
    size: options.size ?? 34,
  });
  return {
    element: mark.element,
    render(progress: number, reduced = false) {
      const p = Math.max(0, Math.min(1, progress));
      arrow.reveal(reduced ? Number(p > 0) : Math.min(1, p * 3));
      packet.show(!reduced && p > 0 && p < 1);
      packet.at(
        interpolate(options.from[0], options.to[0], p),
        interpolate(options.from[1], options.to[1], p),
      );
      return { arrived: p >= 1 };
    },
    dispose() {
      mark.dispose();
      packet.dispose();
      arrow.dispose();
    },
  };
}
