import { scalarExpression } from '../formula/expression.js';
import { integrate } from '../formula/calculus.js';
import {
  finite,
  positive,
  number,
  line,
  path,
  axes,
  sample,
  boundsOf,
  padded,
  lerp,
} from './geometry.js';
import type { ConstructionModel, DiagramBounds, ScalarFunction, DiagramPoint } from './types.js';

function scalar(fn: ScalarFunction) {
  if (typeof fn === 'string') return scalarExpression(fn);
  const value = (x: number) => {
    finite(x);
    const y = fn(x);
    finite(y);
    return y;
  };
  return {
    value,
    derivative(x: number) {
      let h = Math.cbrt(Number.EPSILON) * Math.max(1, Math.abs(x)),
        previous = NaN,
        previousGap = Infinity;
      const y = value(x);
      for (let i = 0; i < 12; i++, h /= 2) {
        if (x + h === x || x - h === x) break;
        const left = (y - value(x - h)) / h,
          right = (value(x + h) - y) / h;
        const estimate = (left + right) / 2,
          scale = Math.max(1, Math.abs(estimate));
        const gap = Math.abs(left - right);
        const converging =
          gap <= Math.max(Math.abs(left), Math.abs(right)) * 1e-4 || gap < previousGap * 0.75;
        if (Math.abs(estimate - previous) <= scale * 1e-5 && converging) return estimate;
        previous = estimate;
        previousGap = gap;
      }
      throw new Error('The curve needs a finite, two-sided derivative at this point');
    },
  };
}
const written = (fn: ScalarFunction, label?: string) =>
  label ??
  (typeof fn === 'string'
    ? fn
        .replace(/\^2(?![\w.])/g, '²')
        .replace(/\^3(?![\w.])/g, '³')
        .replace(/\*/g, '·')
    : 'f(x)');

export function derivative(
  fn: ScalarFunction,
  at: number,
  span = 1.5,
  label?: string,
): ConstructionModel {
  finite(at);
  positive(span);
  const f = scalar(fn),
    y = f.value(at),
    slope = f.derivative(at);
  finite(slope);
  const curve = sample((x) => [x, f.value(x)], at - span, at + span);
  const initialH = span * 0.75;
  const resolution = Math.max(span * 1e-7, 32 * Number.EPSILON * Math.abs(at));
  const rateAt = (h: number) => {
    if (h === 0 || at + h === at) return slope;
    const quotient = (f.value(at + h) - y) / h;
    const weight = Math.min(1, h / resolution);
    const rate = lerp(slope, quotient, weight * weight * (3 - 2 * weight));
    finite(rate);
    return rate;
  };
  const rates = Array.from({ length: 97 }, (_, i) => rateAt((initialH * i) / 96));
  const bounds = padded(
    boundsOf([
      ...curve,
      [at, 0],
      ...rates.flatMap((rate): DiagramPoint[] => [
        [at - span * 0.7, y - rate * span * 0.7],
        [at + span * 0.85, y + rate * span * 0.85],
      ]),
    ]),
  );
  const localBounds: DiagramBounds = [
    [-0.2, Math.min(0, ...rates) - 0.4],
    [1.4, Math.max(0, ...rates) + 0.5],
  ];
  return {
    stages: 3,
    result: slope,
    sample(stage, p) {
      const h =
        stage === 0
          ? initialH
          : stage === 1
            ? initialH * Math.exp(-4 * p)
            : initialH * Math.exp(-4) * (1 - p);
      const rate = rateAt(h);
      const other: DiagramPoint = [at + h, y + rate * h];
      return {
        panels: [
          {
            id: 'curve',
            title: `Два близких значения ${written(fn, label)}`,
            bounds,
            aspect: 'free',
            paths: [
              ...axes(bounds),
              path('function', curve),
              line(
                'secant',
                [at - span * 0.7, y - rate * span * 0.7],
                [at + span * 0.85, y + rate * span * 0.85],
                'purple',
              ),
              {
                ...path('difference', [[at, y], [at + h, y], other], 'orange'),
                closed: true,
                fill: true,
              },
              {
                ...path(
                  'point',
                  sample(
                    (t) => [at + span * 0.02 * Math.cos(t), y + span * 0.02 * Math.sin(t)],
                    0,
                    Math.PI * 2,
                    20,
                  ),
                ),
                closed: true,
                fill: true,
              },
            ],
            labels: [
              {
                id: 'x-label',
                text: `x = ${number(at)}`,
                at: [at, y],
                side: 'bottom',
                pigment: 'blue',
              },
              {
                id: 'dx',
                text: stage === 2 && p === 1 ? 'Δx → 0' : `Δx = ${number(h)}`,
                at: [at + h, y],
                side: 'right',
                pigment: 'orange',
              },
            ],
          },
          {
            id: 'slope',
            title: 'Тот же наклон, ширина приведена к 1',
            bounds: localBounds,
            aspect: 'free',
            paths: [
              ...axes(localBounds),
              {
                ...path(
                  'slope-triangle',
                  [
                    [0, 0],
                    [1, 0],
                    [1, rate],
                  ],
                  'orange',
                ),
                closed: true,
                fill: true,
              },
              line('slope-line', [0, 0], [1, rate], 'purple'),
              {
                ...line('limit', [0, 0], [1, slope], 'green'),
                dashed: true,
                opacity: stage === 2 ? p : 0,
              },
            ],
            labels: [
              { id: 'unit', text: '1', at: [0, 0], to: [1, 0], side: 'bottom' },
              {
                id: 'slope-value',
                text: number(rate),
                at: [1, 0],
                to: [1, rate],
                side: 'right',
                pigment: 'purple',
              },
            ],
          },
        ],
        formula:
          stage === 2 && p > 0.99
            ? `f′(${number(at)}) = ${number(slope)}`
            : `Δy / Δx = ${number(rate)}`,
        explanation: [
          'Секущая соединяет две точки. Оранжевый треугольник показывает отношение приращений.',
          'Сближаем точки. Справа сохраняем видимый размер треугольника, чтобы следить за наклоном.',
          'Расстояние стремится к нулю; секущая непрерывно становится касательной.',
        ][stage]!,
      };
    },
  };
}

export function integral(
  fn: ScalarFunction,
  from: number,
  to: number,
  label?: string,
): ConstructionModel {
  finite(from, to);
  if (!(to > from)) throw new Error('Illustrated integration needs an increasing interval');
  const f = scalar(fn),
    length = to - from;
  positive(length);
  const values = new Map<number, number>();
  const value = (x: number) => {
    let y = values.get(x);
    if (y === undefined) {
      if (values.size >= 32768)
        throw new Error('The integral curve needs too much detail to illustrate');
      y = f.value(x);
      values.set(x, y);
    }
    return y;
  };
  const curve = sample((x) => [x, value(x)], from, to);
  const tolerance = Math.max(...curve.map(([, y]) => Math.abs(y)), Number.MIN_VALUE) * 0.0005;
  const heights = Array.from({ length: 4 }, (_, i) => value(from + ((i + 0.5) * length) / 4));
  const edge: { x: number; fine: number; coarse: number }[] = [];
  // Two trapezoids have area h*(fa + 2*fm + fb)/4. Fit the middle
  // ordinate to the quadrature and refine until that correction is subpixel.
  // This keeps the final polygon's area during the entire flattening motion.
  function refine(a: number, b: number, coarse: number, depth: number): number {
    const width = b - a,
      middle = a + width / 2;
    const area = integrate(value, a, b),
      fa = value(a),
      fb = value(b);
    const mean = area / width,
      center = mean + (mean - fa / 2 - fb / 2);
    finite(center);
    let error = Math.abs(center - value(middle));
    for (const t of [0.211324865405187, 0.788675134594813]) {
      const interpolated = t < 0.5 ? lerp(fa, center, t * 2) : lerp(center, fb, t * 2 - 1);
      error = Math.max(error, Math.abs(interpolated - value(a + t * width)));
    }
    if (error > tolerance) {
      if (!depth || middle === a || middle === b)
        throw new Error('The integral curve could not be resolved');
      return refine(a, middle, coarse, depth - 1) + refine(middle, b, coarse, depth - 1);
    }
    edge.push(
      { x: a, fine: fa, coarse },
      { x: middle, fine: center, coarse },
      { x: b, fine: fb, coarse },
    );
    return area;
  }
  let result = 0;
  for (let i = 0; i < 4; i++)
    result += refine(from + (i * length) / 4, from + ((i + 1) * length) / 4, heights[i]!, 12);
  const average = result / length,
    approximate = heights.reduce((sum, h) => sum + (h * length) / 4, 0);
  finite(result, average, approximate);
  const bounds = padded(
    boundsOf([
      ...curve,
      ...edge.map(({ x, fine }): DiagramPoint => [x, fine]),
      ...heights.map((h): DiagramPoint => [from, h]),
      [from, 0],
      [to, average],
    ]),
  );
  const signed = [...values.values()].some((y) => y < 0),
    symbol = signed ? 'I' : 'S';
  return {
    stages: 3,
    result,
    sample(stage, p) {
      const refinement = stage === 0 ? 0 : stage === 1 ? p : 1;
      const flatten = stage === 2 ? p : 0,
        growth = stage === 0 ? p : 1;
      const boundary: DiagramPoint[] = edge.map(({ x, fine, coarse }) => [
        x,
        lerp(lerp(coarse, fine, refinement), average, flatten) * growth,
      ]);
      const shown = lerp(approximate, result, refinement) * growth;
      const separators = [1, 2, 3].map((i) => {
        const x = from + (length * i) / 4;
        const height =
          lerp(
            lerp(Math.max(heights[i - 1]!, heights[i]!), value(x), refinement),
            average,
            flatten,
          ) * growth;
        return {
          ...line(`partition-${i}`, [x, 0], [x, height], 'blue'),
          opacity: (1 - flatten) * 0.5,
        };
      });
      return {
        panels: [
          {
            id: 'integral',
            title: `${signed ? 'Ориентированная площадь под' : 'Площадь под'} ${written(fn, label)}`,
            bounds,
            aspect: 'free',
            paths: [
              ...axes(bounds),
              { ...path('area', [[from, 0], ...boundary, [to, 0]]), closed: true, fill: true },
              { ...path('function', curve), dashed: flatten > 0, opacity: 1 - flatten * 0.6 },
              ...separators,
              {
                ...line('mean', [from, average], [to, average], 'green'),
                dashed: true,
                opacity: flatten,
              },
            ],
            labels: [
              {
                id: 'interval',
                text: `${number(length)}`,
                at: [from, 0],
                to: [to, 0],
                side: 'bottom',
              },
              { id: 'from', text: number(from), at: [from, 0], side: 'left' },
              {
                id: 'mean-height',
                text: `Средняя высота ${number(average)}`,
                at: [to, average],
                side: 'top',
                pigment: 'green',
                opacity: flatten,
              },
            ],
          },
        ],
        formula:
          stage === 2
            ? `${symbol} = ${number(length)} × ${number(average)} = ${number(result)}`
            : `${symbol} ≈ ${number(shown)}`,
        explanation: [
          'Поднимаем четыре прямоугольника к серединам отрезков: их площадь даёт первую оценку.',
          'Уточняем ту же границу. Сумма площадей приближается к интегралу.',
          signed
            ? 'Выравниваем высоту, сохраняя ориентированную площадь: части ниже оси вычитаются из частей выше неё.'
            : 'Выравниваем высоту, сохраняя площадь. Интеграл равен ширине, умноженной на среднюю высоту.',
        ][stage]!,
      };
    },
  };
}
