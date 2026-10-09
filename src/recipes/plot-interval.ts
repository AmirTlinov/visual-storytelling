import { object } from '../ink/object.js';
import { lettering } from '../ink/lettering.js';
import { svg } from '../ink/dom.js';
import type { Surface } from '../ink/surface.js';
import type { Point } from '../ink/pen.js';
import type { Pigment } from '../ink/palette.js';

export interface PlotIntervalOptions {
  from: Point;
  to: Point;
  pigment?: Pigment;
  size?: number;
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
  const size = options.size ?? 20;
  const horizontal = lettering(mark.content, '', { size });
  const vertical = lettering(mark.content, '', { size, anchor: 'start' });
  // Reserve paper under each measurement so another trace cannot strike through its ink.
  const inscriptions = [horizontal, vertical].map((label) => {
    const paper = svg('rect', {
      fill: 'var(--ve-surface)',
      rx: 3,
      'aria-hidden': 'true',
      'pointer-events': 'none',
    });
    mark.content.insertBefore(paper, label.element);
    return { label, paper };
  });
  let delta: Point;
  const at = (from: Point, to: Point) => {
    const a = point(...from),
      b = point(...to);
    delta = [to[0] - from[0], to[1] - from[1]];
    area.update([a, [b[0], a[1]], b]);
    horizontal.text(options.formatX(delta[0]));
    horizontal.at((a[0] + b[0]) / 2, Math.min(bounds.y + bounds.height - 10, a[1] + size + 7));
    vertical.text(options.formatY(delta[1]));
    vertical.at(0, 0);
    const ink = vertical.bounds,
      paper = view.element.viewBox.baseVal,
      dx = b[0] - a[0],
      dy = b[1] - a[1],
      gap = Math.max(8, size * 0.4);
    const length = Math.hypot(dx, dy);
    const distances = (box: { x: number; y: number; width: number; height: number }) =>
      [box.x, box.x + box.width].flatMap((x) =>
        [box.y, box.y + box.height].map((y) => (dx * (y - a[1]) - dy * (x - a[0])) / (length || 1)),
      );
    // An annotation may use the paper margin outside the data rectangle, like
    // an axis label. Measure the actual pen, not the font's advance width.
    let x = dx >= 0 ? b[0] + gap : b[0] - gap - ink.width,
      y = (a[1] + b[1] - ink.height) / 2;
    let fits = x >= paper.x + 4 && x + ink.width <= paper.x + paper.width - 4;
    if (!fits) {
      // The right-angle corner is the widest available part of the triangle.
      // Moving a label inside requires clearance from the diagonal as well.
      x = dx >= 0 ? b[0] - gap - ink.width : b[0] + gap;
      y = dy <= 0 ? a[1] - gap - ink.height : a[1] + gap;
      const side = Math.sign(-dx * dy);
      fits = length > 0 && distances({ ...ink, x, y }).every((d) => side * d >= gap);
    }
    vertical.at(x - ink.x, y - ink.y);
    // Tiny intervals keep their true geometry. Their numbers remain in the surrounding
    // explanation instead of colliding with the point and coordinate ticks.
    const runClearance = distances(horizontal.bounds);
    horizontal.element.style.visibility =
      Math.abs(dx) >= horizontal.bounds.width + 18 &&
      (runClearance.every((d) => d >= gap) || runClearance.every((d) => d <= -gap))
        ? ''
        : 'hidden';
    vertical.element.style.visibility = fits && Math.abs(dy) >= ink.height + 12 ? '' : 'hidden';
    for (const { label, paper } of inscriptions) {
      const box = label.bounds;
      paper.setAttribute('x', String(box.x - 4));
      paper.setAttribute('y', String(box.y - 3));
      paper.setAttribute('width', String(box.width + 8));
      paper.setAttribute('height', String(box.height + 6));
      paper.style.visibility = label.element.style.visibility;
    }
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
