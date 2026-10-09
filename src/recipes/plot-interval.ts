import { object } from '../ink/object.js';
import { lettering } from '../ink/lettering.js';
import type { Surface } from '../ink/surface.js';
import type { Point } from '../ink/pen.js';
import type { Pigment } from '../ink/palette.js';

export interface PlotIntervalOptions {
  from: Point;
  to: Point;
  pigment?: Pigment;
  formatX(value: number): string;
  formatY(value: number): string;
}

/** The rise, run and their inscriptions are all derived from the same two data points. */
export function plotInterval(
  view: Surface,
  parent: SVGElement,
  id: string,
  point: (x: number, y: number) => Point,
  bounds: { x: number; y: number; width: number; height: number },
  options: PlotIntervalOptions,
) {
  const mark = object(parent, id, options.pigment ?? 'blue');
  const area = view.pen.contour(
    mark.content,
    `${id}:area`,
    [
      [0, 0],
      [1, 0],
      [1, 1],
    ],
    {
      fill: 'marker',
      width: 1.2,
    },
  );
  const horizontal = lettering(mark.content, '', { size: 20 });
  const vertical = lettering(mark.content, '', { size: 20, anchor: 'start' });
  let delta: Point;
  const at = (from: Point, to: Point) => {
    const a = point(...from),
      b = point(...to);
    delta = [to[0] - from[0], to[1] - from[1]];
    area.update([a, [b[0], a[1]], b]);
    horizontal.text(options.formatX(delta[0]));
    horizontal.at((a[0] + b[0]) / 2, Math.min(bounds.y + bounds.height - 10, a[1] + 27));
    vertical.text(options.formatY(delta[1]));
    const right = b[0] + 12;
    vertical.at(
      right + vertical.width > bounds.x + bounds.width ? b[0] - vertical.width - 12 : right,
      (a[1] + b[1]) / 2 + 6,
    );
    // Tiny intervals keep their true geometry. Their numbers remain in the surrounding
    // explanation instead of colliding with the point and coordinate ticks.
    horizontal.element.style.visibility =
      Math.abs(b[0] - a[0]) >= horizontal.bounds.width + 18 ? '' : 'hidden';
    vertical.element.style.visibility =
      Math.abs(b[1] - a[1]) >= vertical.bounds.height + 20 ? '' : 'hidden';
  };
  at(options.from, options.to);
  return {
    ...mark,
    at,
    get delta() {
      return delta;
    },
    dispose() {
      horizontal.dispose();
      vertical.dispose();
      area.dispose();
      mark.dispose();
    },
  };
}
