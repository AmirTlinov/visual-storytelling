import type { Surface } from '../ink/surface.js';
import { roundedRect, type Point } from '../ink/pen.js';
import type { Pigment } from '../ink/palette.js';
import { object } from '../ink/object.js';
import { svg } from '../ink/dom.js';
import { token } from './tokens.js';

/** Arrival is a derived value, so back-seeking also restores the receiver. */
export function transfer(
  view: Surface,
  id: string,
  options: {
    from: Point;
    to: Point;
    value: string | number;
    pigment?: Pigment;
    size?: number;
    width?: number;
    path?: string;
  },
) {
  const mark = object(view.layer, id, options.pigment ?? 'purple');
  const d = options.path ?? `M${options.from.join(' ')} L${options.to.join(' ')}`;
  const geometry = svg('path', { d }),
    defs = svg('defs');
  defs.append(geometry);
  mark.content.append(defs);
  const length = geometry.getTotalLength(),
    end = geometry.getPointAtLength(Math.max(0, length - 10));
  const angle = Math.atan2(options.to[1] - end.y, options.to[0] - end.x);
  const head = (offset: number) =>
    `${options.to[0] - 7 * Math.cos(angle + offset)} ${options.to[1] - 7 * Math.sin(angle + offset)}`;
  const arrow = view.pen.path(
    mark.content,
    `${id}:route`,
    `${d} M${head(0.48)} Q${options.to.join(' ')} ${head(-0.48)}`,
  );
  const size = options.size ?? 34,
    width = options.width ?? size;
  const packet = token(view, `${id}:packet`, options.value, {
    pigment: options.pigment ?? 'purple',
    size,
    width,
  });
  packet.highlight(false);
  // A travelling label masks the route beneath its own characters.
  packet.content.prepend(
    svg('path', { d: roundedRect(-width / 2, -size / 2, width, size), fill: 'var(--vs-surface)' }),
  );
  return {
    element: mark.element,
    render(progress: number, reduced = false) {
      const p = Math.max(0, Math.min(1, progress));
      arrow.reveal(reduced ? Number(p > 0) : Math.min(1, p * 3));
      packet.show(!reduced && p > 0 && p < 1);
      const point = geometry.getPointAtLength(length * p);
      packet.at(point.x, point.y);
      return { arrived: p >= 1 };
    },
    dispose() {
      mark.dispose();
      packet.dispose();
      arrow.dispose();
    },
  };
}
