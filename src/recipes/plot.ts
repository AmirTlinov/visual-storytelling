import { object } from '../ink/object.js';
import { lettering } from '../ink/lettering.js';
import { svg, clamp } from '../ink/dom.js';
import type { Surface } from '../ink/surface.js';
import type { Point } from '../ink/pen.js';
import type { Pigment } from '../ink/palette.js';
import { plotInterval, type PlotIntervalOptions } from './plot-interval.js';

export interface PlotOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  xDomain: readonly [number, number];
  yDomain: readonly [number, number];
  xTicks?: readonly { value: number; label: string }[];
  yTicks?: readonly { value: number; label: string }[];
  xLabel?: string;
  yLabel?: string;
}

/** Data coordinates own the geometry. Time clips by x, never by stroke length. */
export function plot(view: Surface, id: string, options: PlotOptions) {
  const o = options;
  if (o.xDomain[1] <= o.xDomain[0] || o.yDomain[1] <= o.yDomain[0])
    throw new Error('Plot domains must increase');
  const point = (x: number, y: number): Point => [
    o.x + ((x - o.xDomain[0]) / (o.xDomain[1] - o.xDomain[0])) * o.width,
    o.y + o.height - ((y - o.yDomain[0]) / (o.yDomain[1] - o.yDomain[0])) * o.height,
  ];
  const chart = object(view.layer, id);
  const axes = object(chart.content, `${id}:axes`);
  const zero = point(
    Math.max(o.xDomain[0], Math.min(o.xDomain[1], 0)),
    Math.max(o.yDomain[0], Math.min(o.yDomain[1], 0)),
  );
  view.pen.arrow(axes.content, `${id}:x`, [o.x, zero[1]], [o.x + o.width + 7, zero[1]], {
    width: 1.5,
  });
  view.pen.arrow(axes.content, `${id}:y`, [zero[0], o.y + o.height], [zero[0], o.y - 7], {
    width: 1.5,
  });
  if (o.xLabel)
    lettering(axes.content, o.xLabel, { x: o.x + o.width + 18, y: zero[1] + 5, size: 17 });
  if (o.yLabel) lettering(axes.content, o.yLabel, { x: zero[0] + 14, y: o.y - 9, size: 17 });
  for (const tick of o.xTicks ?? []) {
    const [x] = point(tick.value, 0);
    view.pen.line(axes.content, `${id}:xtick:${tick.value}`, [x, zero[1] - 3], [x, zero[1] + 3], {
      width: 1,
    });
    lettering(axes.content, tick.label, { x, y: zero[1] + 25, size: 18 });
  }
  for (const tick of o.yTicks ?? []) {
    const [, y] = point(0, tick.value);
    view.pen.line(axes.content, `${id}:ytick:${tick.value}`, [zero[0] - 3, y], [zero[0] + 3, y], {
      width: 1,
    });
    lettering(axes.content, tick.label, { x: zero[0] - 9, y: y + 5, anchor: 'end', size: 18 });
  }
  return {
    ...chart,
    point,
    interval(name: string, options: PlotIntervalOptions) {
      return plotInterval(view, chart.content, `${id}:${name}`, point, o, options);
    },
    trace(name: string, samples: readonly Point[], pigment: Pigment) {
      const mark = object(chart.content, `${id}:${name}`, pigment);
      const d = samples.map(([x, y], i) => `${i ? 'L' : 'M'}${point(x, y).join(' ')}`).join(' ');
      const shape = view.pen.path(mark.content, `${id}:${name}:curve`, d, { width: 2.8 });
      const context = shape.element.cloneNode(true) as SVGGElement;
      context.removeAttribute('data-stroke');
      context.removeAttribute('id');
      context.style.opacity = '.18';
      mark.content.prepend(context);
      const clipId = `${shape.element.id}-time`;
      const defs = svg('defs'),
        clip = svg('clipPath', { id: clipId });
      const window = svg('rect', { x: o.x - 2, y: o.y - 4, width: 0, height: o.height + 8 });
      clip.append(window);
      defs.append(clip);
      mark.content.append(defs);
      shape.element.setAttribute('clip-path', `url(#${clipId})`);
      const cursor = svg('circle', { r: 4.5, fill: 'currentColor', 'data-plot-point': name });
      mark.content.append(cursor);
      return {
        element: mark.element,
        show: mark.show,
        dispose: mark.dispose,
        at(x: number, y: number) {
          const pixel = point(x, y);
          window.setAttribute(
            'width',
            String(2 + clamp((x - o.xDomain[0]) / (o.xDomain[1] - o.xDomain[0])) * o.width),
          );
          cursor.setAttribute('cx', String(pixel[0]));
          cursor.setAttribute('cy', String(pixel[1]));
          cursor.dataset.value = String(y);
        },
      };
    },
  };
}
