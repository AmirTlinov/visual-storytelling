import { createModel, type Coordinate } from '../model/index.js';
import { finite, positive, number } from './geometry.js';
import type { ConstructionPlan, Matrix2 } from './types.js';

/** The dimensions and inscriptions belong to the same two material pieces. */
export function distribution(a: number, b: number, c: number): ConstructionPlan {
  positive(a, b, c);
  const gap = (b + c) * 0.16,
    result = a * (b + c);
  finite(result, b + c + gap, a + 0.5);
  const model = createModel({ separation: 0, cut: 0 });
  const left = model.material(([x, y], state) => [x! - (gap * state.separation) / 2, y!], {
    domain: [
      [0, 0],
      [b, a],
    ],
    pigment: 'blue',
    fill: true,
    text: `${number(a)} × ${number(b)}`,
    grid: [Math.min(12, Math.ceil(b)), Math.min(12, Math.ceil(a))],
  });
  const right = model.material(([x, y], state) => [x! + (gap * state.separation) / 2, y!], {
    domain: [
      [b, 0],
      [b + c, a],
    ],
    pigment: 'orange',
    fill: true,
    text: `${number(a)} × ${number(c)}`,
    grid: [Math.min(12, Math.ceil(c)), Math.min(12, Math.ceil(a))],
  });
  return model.explain({
    panels: [
      {
        title: 'Одна и та же площадь',
        objects: [
          left,
          right,
          model.segment([b, 0], [b, a], {
            pigment: 'purple',
            dashed: true,
            visible: model.parameter('cut'),
          }),
          model.measure(left.at([0, 0]), left.at([0, a]), { side: 'left', pigment: 'ink' }),
          model.measure(left.at([0, 0]), left.at([b, 0]), { side: 'bottom', pigment: 'blue' }),
          model.measure(right.at([b, 0]), right.at([b + c, 0]), {
            side: 'bottom',
            pigment: 'orange',
          }),
        ],
      },
    ],
    steps: [
      {
        to: { cut: 1 },
        formula: `${number(a)} × (${number(b)} + ${number(c)})`,
        explanation: 'Проведи границу: высота обеих частей остаётся той же.',
      },
      {
        to: { separation: 1, cut: 0 },
        formula: `${number(a)} × ${number(b)} + ${number(a)} × ${number(c)} = ${number(a * b)} + ${number(a * c)}`,
        explanation: 'Раздвигаем те же клетки. Ни одна не исчезла и не появилась.',
      },
      {
        to: { separation: 0 },
        formula: model.value(({ separation }) =>
          separation > 0
            ? `${number(a * b)} + ${number(a * c)}`
            : `${number(a)} × (${number(b)} + ${number(c)}) = ${number(a * b)} + ${number(a * c)} = ${number(result)}`,
        ),
        explanation: 'Собираем обратно: умножение распределяется по сумме.',
      },
    ],
    result,
  });
}

/** Basis vectors, material and measured area all follow one interpolated linear map. */
export function linearMap(matrix: Matrix2): ConstructionPlan {
  const [[a, b], [c, d]] = matrix;
  finite(a, b, c, d);
  const determinant = a * d - b * c;
  finite(determinant);
  const model = createModel({ deformation: 0 });
  const transform = model.value(({ deformation: p }) => ([x, y]: Coordinate) => [
    x! + p * ((a - 1) * x! + b * y!),
    y! + p * (c * x! + (d - 1) * y!),
  ]);
  const grid = model.material(transform, {
    domain: [
      [0, 0],
      [2, 2],
    ],
    grid: [4, 4],
    fill: false,
    quiet: true,
    visible: 0.42,
  });
  const sheet = model.material(transform, {
    domain: [
      [0, 0],
      [1, 1],
    ],
    grid: [4, 4],
    fill: true,
    text: '1',
  });
  const origin = sheet.at([0, 0]),
    e1 = sheet.at([1, 0]),
    e2 = sheet.at([0, 1]);
  const coordinates = (v: Coordinate) => `(${number(v[0]!)}; ${number(v[1]!)})`;
  const area = e1.join(e2, (u, v) => u[0]! * v[1]! - u[1]! * v[0]!);
  return model.explain({
    panels: [
      {
        title: 'Сетка деформируется целиком',
        axes: true,
        objects: [
          grid,
          sheet,
          model.vector(origin, e1, {
            pigment: 'orange',
            label: e1.map(coordinates),
            side: 'bottom',
          }),
          model.vector(origin, e2, { pigment: 'purple', label: e2.map(coordinates), side: 'top' }),
        ],
      },
    ],
    steps: [
      {
        to: { deformation: 1 },
        formula: area.map((value) => `Площадь: ${number(Math.abs(value))}`),
        explanation:
          'Каждая точка следует одному преобразованию; надпись и клетки движутся вместе.',
      },
      {
        to: {},
        formula: `det A = ${number(a)} × ${number(d)} − ${number(b)} × ${number(c)} = ${number(determinant)}`,
        explanation:
          'Модуль определителя показывает, во сколько раз меняется площадь; знак отражает ориентацию клетки.',
      },
    ],
    result: area,
  });
}
