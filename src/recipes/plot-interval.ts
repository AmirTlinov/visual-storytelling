import { object } from '../ink/object.js';
import { lettering } from '../ink/lettering.js';
import type { Surface } from '../ink/surface.js';
import type { Point } from '../ink/pen.js';
import type { Pigment } from '../ink/palette.js';
import { besidePoint, type PlotLabels } from './plot-labels.js';

export interface PlotIntervalOptions {
  from: Point;
  to: Point;
  pigment?: Pigment;
  size?: number;
  formatX(value: number): string;
  formatY(value: number): string;
}

/** Measured lines and inscriptions participate in the plot's single placement pass. */
export function plotInterval(
  view: Surface,
  parent: SVGElement,
  id: string,
  point: (x: number, y: number) => Point,
  labels: PlotLabels,
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
  const vertical = lettering(mark.content, '', { size });
  horizontal.element.dataset.plotLabel = 'interval-x';
  vertical.element.dataset.plotLabel = 'interval-y';
  let a: Point = [0, 0],
    b: Point = [0, 0],
    delta: Point = [0, 0],
    visible = true;
  const removeX = labels.add(
    horizontal,
    (ink) => {
      const anchor: Point = [(a[0] + b[0]) / 2, a[1]];
      return { anchor, preferred: besidePoint(ink, anchor, 'bottom', 12), priority: 65 };
    },
    () => visible && Math.abs(b[0] - a[0]) >= horizontal.bounds.width + 18,
    true,
  );
  const removeY = labels.add(
    vertical,
    (ink) => {
      const anchor: Point = [b[0], (a[1] + b[1]) / 2];
      return {
        anchor,
        preferred: besidePoint(ink, anchor, b[0] >= a[0] ? 'right' : 'left', 12),
        priority: 65,
      };
    },
    () => visible && Math.abs(b[1] - a[1]) >= vertical.bounds.height + 12,
    true,
  );
  const removeGeometry = labels.geometry(() => ({
    segments: visible
      ? [
          { from: a, to: [b[0], a[1]], width: 2 },
          { from: [b[0], a[1]], to: b, width: 2 },
          { from: a, to: b, width: 2 },
        ]
      : [],
  }));
  const at = (from: Point, to: Point) => {
    a = point(...from);
    b = point(...to);
    delta = [to[0] - from[0], to[1] - from[1]];
    area.update([a, [b[0], a[1]], b]);
    horizontal.text(options.formatX(delta[0]));
    vertical.text(options.formatY(delta[1]));
  };
  at(options.from, options.to);
  return {
    ...mark,
    at,
    show(value: boolean) {
      visible = value;
      mark.show(value);
    },
    get delta() {
      return delta;
    },
    dispose() {
      removeX();
      removeY();
      removeGeometry();
      horizontal.dispose();
      vertical.dispose();
      area.dispose();
      mark.dispose();
    },
  };
}
