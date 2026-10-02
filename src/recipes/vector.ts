import { object } from '../ink/object.js';
import type { Surface } from '../ink/surface.js';
import type { Point } from '../ink/pen.js';
import type { Pigment } from '../ink/palette.js';

/** Stretch only the stem: line weight and arrowhead stay legible at every length. */
export function vector(view: Surface, id: string, pigment: Pigment, width = 2) {
  const mark = object(view.layer, id, pigment);
  const stem = view.pen.line(mark.content, `${id}:stem`, [0, 0], [100, 0], { width });
  for (const path of stem.element.querySelectorAll('path'))
    path.setAttribute('vector-effect', 'non-scaling-stroke');
  const head = view.pen.path(mark.content, `${id}:head`, 'M-8 -4 Q-3 0 0 0 Q-3 0 -8 4', { width });
  return {
    ...mark,
    set(from: Point, to: Point) {
      const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
      mark.at(from[0], from[1], (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI);
      stem.element.setAttribute('transform', `scale(${length / 100} 1)`);
      head.element.setAttribute('transform', `translate(${length} 0)`);
      mark.show(length > 1);
    },
  };
}
