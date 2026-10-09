import { object } from '../ink/object.js';
import { lettering, type Handwriting } from '../ink/lettering.js';
import { svg, clamp } from '../ink/dom.js';
import type { Surface } from '../ink/surface.js';
import type { Point } from '../ink/pen.js';
import type { Pigment } from '../ink/palette.js';
import { plotInterval, type PlotIntervalOptions } from './plot-interval.js';
import { plotLabels, besidePoint } from './plot-labels.js';
import type { LabelBox } from '../layout/labels.js';

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
  /** Logical lettering size; the enclosing scene owns the screen scale. */
  tickSize?: number;
  labelSize?: number;
}

export interface PlotLabelOptions {
  at: Point;
  side?: 'left' | 'right' | 'top' | 'bottom';
  pigment?: Pigment;
  size?: number;
  handwriting?: Handwriting;
  /** Higher priority retains its preferred place when space is crowded. */
  priority?: number;
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
  const labels = plotLabels(view, chart.content);
  const cleanups = new Set<() => void>();
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
  labels.geometry(() => ({
    segments: [
      { from: [o.x, zero[1]], to: [o.x + o.width + 7, zero[1]], width: 4 },
      { from: [zero[0], o.y + o.height], to: [zero[0], o.y - 7], width: 4 },
    ],
  }));
  const xTicks: ReturnType<typeof lettering>[] = [];
  const yTicks: { label: ReturnType<typeof lettering>; y: number }[] = [];
  const tickSize = o.tickSize ?? 18;
  const labelSize = o.labelSize ?? 24;
  for (const tick of o.xTicks ?? []) {
    const [x] = point(tick.value, 0);
    view.pen.line(axes.content, `${id}:xtick:${tick.value}`, [x, zero[1] - 3], [x, zero[1] + 3], {
      width: 1,
    });
    const label = lettering(axes.content, tick.label, { size: tickSize });
    label.element.dataset.plotLabel = 'x-tick';
    xTicks.push(label);
    cleanups.add(() => label.dispose());
    labels.add(label, (ink) => {
      const preferred = besidePoint(ink, [x, zero[1]], 'bottom', 13);
      return {
        anchor: [x, zero[1]],
        preferred,
        limits: {
          left: preferred.x,
          right: preferred.x + ink.width,
          top: zero[1] + 8,
          bottom: preferred.y + ink.height + 6,
        },
        priority:
          tick.value === o.xDomain[0] || tick.value === o.xDomain[1] || tick.value === 0
            ? 110
            : 100,
      };
    });
  }
  for (const tick of o.yTicks ?? []) {
    const [, y] = point(0, tick.value);
    view.pen.line(axes.content, `${id}:ytick:${tick.value}`, [zero[0] - 3, y], [zero[0] + 3, y], {
      width: 1,
    });
    const label = lettering(axes.content, tick.label, { size: tickSize });
    label.element.dataset.plotLabel = 'y-tick';
    yTicks.push({ label, y });
    cleanups.add(() => label.dispose());
    labels.add(label, (ink) => {
      const preferred = besidePoint(ink, [zero[0], y], 'left', 13);
      return {
        anchor: [zero[0], y],
        preferred,
        limits: {
          top: preferred.y,
          bottom: preferred.y + ink.height,
          right: preferred.x + ink.width,
        },
        priority:
          tick.value === o.yDomain[0] || tick.value === o.yDomain[1] || tick.value === 0
            ? 110
            : 100,
      };
    });
  }
  if (o.xLabel) {
    const label = lettering(axes.content, o.xLabel, { size: labelSize, handwriting: 'note' });
    label.element.dataset.plotLabel = 'x-title';
    cleanups.add(() => label.dispose());
    labels.add(label, (ink) => {
      const end: Point = [o.x + o.width + 7, zero[1]];
      const right = besidePoint(ink, end, 'right', 14);
      const paper = view.element.viewBox.baseVal;
      const below = zero[1] + 13 + Math.max(0, ...xTicks.map((tick) => tick.bounds.height)) + 14;
      const preferred =
        right.x + ink.width <= paper.x + paper.width - 4
          ? right
          : { ...ink, x: o.x + o.width - ink.width, y: below };
      return {
        anchor: end,
        preferred,
        limits: preferred === right ? {} : { top: below },
        priority: 120,
      };
    });
  }
  if (o.yLabel) {
    const label = lettering(axes.content, o.yLabel, { size: labelSize, handwriting: 'note' });
    label.element.dataset.plotLabel = 'y-title';
    cleanups.add(() => label.dispose());
    labels.add(label, (ink) => ({
      anchor: [zero[0], o.y - 7],
      preferred: {
        ...ink,
        x: Math.max(view.element.viewBox.baseVal.x + 4, zero[0] - ink.width / 2),
        y:
          Math.min(o.y - 7, ...yTicks.map(({ label, y }) => y - label.bounds.height / 2)) -
          10 -
          ink.height,
      },
      priority: 120,
    }));
  }
  labels.render();
  return {
    ...chart,
    point,
    /** Commit all changed points, text and visibility in one deterministic placement. */
    layout: labels.render,
    /** Protect a formula, control or other meaningful ink in the plot's surrounding composition. */
    avoid: labels.avoid,
    label(name: string, initial: string, options: PlotLabelOptions) {
      const mark = object(chart.content, `${id}:${name}`, options.pigment ?? 'ink');
      const label = lettering(mark.content, initial, {
        size: options.size ?? 24,
        handwriting: options.handwriting,
      });
      label.element.dataset.plotLabel = name;
      let at = options.at,
        visible = true;
      const remove = labels.add(
        label,
        (ink) => ({
          anchor: point(...at),
          preferred: besidePoint(ink, point(...at), options.side),
          priority: options.priority ?? 60,
        }),
        () => visible,
        true,
      );
      const removePoint = labels.geometry(() => ({
        boxes: visible
          ? [{ x: point(...at)[0] - 5, y: point(...at)[1] - 5, width: 10, height: 10 }]
          : [],
      }));
      const dispose = () => {
        if (!cleanups.delete(dispose)) return;
        remove();
        removePoint();
        label.dispose();
        mark.dispose();
      };
      cleanups.add(dispose);
      return {
        ...mark,
        text: label.text,
        get bounds(): LabelBox {
          return label.bounds;
        },
        at(x: number, y: number) {
          at = [x, y];
        },
        show(value: boolean) {
          visible = value;
          mark.show(value);
        },
        dispose,
      };
    },
    interval(name: string, options: PlotIntervalOptions) {
      const interval = plotInterval(view, chart.content, `${id}:${name}`, point, labels, options);
      const release = interval.dispose;
      const dispose = () => {
        if (!cleanups.delete(dispose)) return;
        release();
      };
      cleanups.add(dispose);
      return Object.assign(interval, { dispose });
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
      let visible = true,
        ahead = true,
        currentX = o.xDomain[0];
      const remove = labels.geometry(() => {
        if (!visible) return {};
        const limit = ahead ? Infinity : currentX;
        return {
          segments: samples.slice(1).flatMap((b, i) => {
            const a = samples[i]!;
            if (a[0] > limit && b[0] > limit) return [];
            const crossing: Point = [
              limit,
              a[1] + (b[1] - a[1]) * ((limit - a[0]) / (b[0] - a[0] || 1)),
            ];
            return [
              {
                from: point(...(a[0] > limit ? crossing : a)),
                to: point(...(b[0] > limit ? crossing : b)),
                width: 3.6,
              },
            ];
          }),
        };
      });
      const dispose = () => {
        if (!cleanups.delete(dispose)) return;
        remove();
        mark.dispose();
      };
      cleanups.add(dispose);
      return {
        element: mark.element,
        show(value: boolean) {
          visible = value;
          mark.show(value);
        },
        /** Hide the future trace while the learner records a prediction. */
        showAhead(visible: boolean) {
          ahead = visible;
          context.style.display = visible ? '' : 'none';
        },
        dispose,
        at(x: number, y: number) {
          currentX = x;
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
    dispose() {
      for (const cleanup of [...cleanups]) cleanup();
      cleanups.clear();
      labels.dispose();
      chart.dispose();
    },
  };
}
