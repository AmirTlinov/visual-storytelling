import { scalarExpression } from '../formula/expression.js';
import { integrate } from '../formula/calculus.js';
import { finite, positive, number, sample, boundsOf, padded, lerp } from './geometry.js';
import { createModel } from '../model/index.js';
import type { ConstructionPlan, ScalarFunction, DiagramPoint } from './types.js';

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
): ConstructionPlan {
  finite(at);
  positive(span);
  const f = scalar(fn),
    y = f.value(at),
    slope = f.derivative(at);
  finite(slope);
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
  const m = createModel({ convergence: 0, settle: 0 });
  const h = m.value((s) => initialH * Math.exp(-4 * s.convergence) * (1 - s.settle));
  const rate = h.map(rateAt),
    other = h.join(rate, (h, r) => [at + h, y + r * h]);
  const a = rate.map((r) => [at - span * 0.7, y - r * span * 0.7]),
    b = rate.map((r) => [at + span * 0.85, y + r * span * 0.85]);
  const normalized = rate.map((r) => [1, r]);
  const ratio = rate.map((r) => `Δy / Δx = ${number(r)}`);
  return m.explain({
    panels: [
      {
        title: `Два близких значения ${written(fn, label)}`,
        axes: true,
        aspect: 'free',
        objects: [
          m.curve((x) => [x, f.value(x)], { domain: [at - span, at + span] }),
          m.segment(a, b, { pigment: 'purple' }),
          m.polygon([[at, y], h.map((h) => [at + h, y]), other], { pigment: 'orange', fill: true }),
          m.point([at, y], { label: `x = ${number(at)}`, side: 'bottom' }),
          m.label(
            h.map((h) => (h === 0 ? 'Δx → 0' : `Δx = ${number(h)}`)),
            h.map((h) => [at + h, y]),
            { pigment: 'orange', side: 'right' },
          ),
        ],
      },
      {
        title: 'Тот же наклон, ширина приведена к 1',
        axes: true,
        aspect: 'free',
        objects: [
          m.polygon([[0, 0], [1, 0], normalized], { pigment: 'orange', fill: true }),
          m.segment([0, 0], normalized, { pigment: 'purple' }),
          m.segment([0, 0], [1, slope], {
            pigment: 'green',
            dashed: true,
            visible: m.parameter('settle'),
          }),
          m.measure([0, 0], [1, 0], { side: 'bottom', pigment: 'ink' }),
          m.measure([1, 0], normalized, {
            label: rate.map(number),
            side: 'right',
            pigment: 'purple',
          }),
        ],
      },
    ],
    steps: [
      {
        to: {},
        formula: ratio,
        explanation:
          'Секущая соединяет две точки. Оранжевый треугольник показывает отношение приращений.',
      },
      {
        to: { convergence: 1 },
        formula: ratio,
        explanation:
          'Сближаем точки. Справа сохраняем видимый размер треугольника, чтобы следить за наклоном.',
      },
      {
        to: { settle: 1 },
        formula: m
          .parameter('settle')
          .join(rate, (p, r) =>
            p === 1 ? `f′(${number(at)}) = ${number(slope)}` : `Δy / Δx = ${number(r)}`,
          ),
        explanation: 'Расстояние стремится к нулю; секущая непрерывно становится касательной.',
      },
    ],
    result: slope,
  });
}

export function integral(
  fn: ScalarFunction,
  from: number,
  to: number,
  label?: string,
): ConstructionPlan {
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
  const m = createModel({ growth: 0, refinement: 0, flatten: 0 });
  const boundary = edge.map(({ x, fine, coarse }) =>
    m.value((s) => [x, lerp(lerp(coarse, fine, s.refinement), average, s.flatten) * s.growth]),
  );
  const shown = m.value((s) => lerp(approximate, result, s.refinement) * s.growth);
  const separators = [1, 2, 3].map((i) => {
    const x = from + (length * i) / 4;
    const height = m.value((s) => [
      x,
      lerp(
        lerp(Math.max(heights[i - 1]!, heights[i]!), value(x), s.refinement),
        average,
        s.flatten,
      ) * s.growth,
    ]);
    return m.segment([x, 0], height, { visible: m.value((s) => (1 - s.flatten) * 0.5) });
  });
  // The quadrature's corrected ordinates are the mathematical polygon: every intermediate
  // ordinate has the same signed integral, including functions that cross the horizontal axis.
  const curveValues = curve.map((p) => p[1]);
  const functionAt = (x: number) => {
    const p = Math.max(0, Math.min(curve.length - 1, ((x - from) / length) * (curve.length - 1))),
      i = Math.min(curve.length - 2, Math.floor(p));
    return lerp(curveValues[i]!, curveValues[i + 1]!, p - i);
  };
  const approximation = shown.map((v) => `${symbol} ≈ ${number(v)}`);
  return m.explain({
    panels: [
      {
        title: `${signed ? 'Ориентированная площадь под' : 'Площадь под'} ${written(fn, label)}`,
        aspect: 'free',
        axes: true,
        bounds,
        objects: [
          m.polygon([[from, 0], ...boundary, [to, 0]], { fill: true }),
          m.curve((x) => [x, functionAt(x)], {
            domain: [from, to],
            visible: m.value((s) => 1 - s.flatten * 0.6),
          }),
          ...separators,
          m.segment([from, average], [to, average], {
            pigment: 'green',
            dashed: true,
            visible: m.parameter('flatten'),
          }),
          m.measure([from, 0], [to, 0], { pigment: 'ink' }),
          m.label(number(from), [from, 0], { side: 'left', pigment: 'ink' }),
          m.label(`Средняя высота ${number(average)}`, [to, average], {
            side: 'top',
            pigment: 'green',
            visible: m.parameter('flatten'),
          }),
        ],
      },
    ],
    steps: [
      {
        to: { growth: 1 },
        formula: approximation,
        explanation:
          'Поднимаем четыре прямоугольника к серединам отрезков: их площадь даёт первую оценку.',
      },
      {
        to: { refinement: 1 },
        formula: approximation,
        explanation: 'Уточняем ту же границу. Сумма площадей приближается к интегралу.',
      },
      {
        to: { flatten: 1 },
        formula: `${symbol} = ${number(length)} × ${number(average)} = ${number(result)}`,
        explanation: signed
          ? 'Выравниваем высоту, сохраняя ориентированную площадь: части ниже оси вычитаются из частей выше неё.'
          : 'Выравниваем высоту, сохраняя площадь. Интеграл равен ширине, умноженной на среднюю высоту.',
      },
    ],
    result,
  });
}
