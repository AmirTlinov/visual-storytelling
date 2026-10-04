import { finite, positive, number, rect, line, axes, padded, boundsOf } from './geometry.js';
import type { ConstructionModel, DiagramPoint, Matrix2 } from './types.js';

/** A dissection preserves the material coordinates of both pieces, including their inscriptions. */
export function distribution(a: number, b: number, c: number): ConstructionModel {
  positive(a, b, c);
  const gap = (b + c) * 0.16;
  finite(a * (b + c), b + c + gap, a + 0.5);
  return {
    stages: 3,
    result: a * (b + c),
    sample(stage, p) {
      const separation = stage === 0 ? 0 : stage === 1 ? p : 1 - p;
      const left = rect(
        'left-piece',
        [
          [0, 0],
          [b, a],
        ],
        'blue',
        `${number(a)} × ${number(b)}`,
      );
      const right = rect(
        'right-piece',
        [
          [b, 0],
          [b + c, a],
        ],
        'orange',
        `${number(a)} × ${number(c)}`,
      );
      left.map = ([x, y]) => [x - (gap * separation) / 2, y];
      right.map = ([x, y]) => [x + (gap * separation) / 2, y];
      left.grid = [Math.min(12, Math.ceil(b)), Math.min(12, Math.ceil(a))];
      right.grid = [Math.min(12, Math.ceil(c)), Math.min(12, Math.ceil(a))];
      return {
        panels: [
          {
            id: 'area',
            title: 'Одна и та же площадь',
            bounds: [
              [-gap, -0.5],
              [b + c + gap, a + 0.5],
            ],
            patches: [left, right],
            paths: [
              {
                ...line('cut', [b, 0], [b, a], 'purple'),
                opacity: stage === 0 ? p : stage === 1 ? 1 - p : 0,
                dashed: true,
              },
            ],
            labels: [
              {
                id: 'height',
                text: number(a),
                at: left.map([0, 0]),
                to: left.map([0, a]),
                side: 'left',
              },
              {
                id: 'left-width',
                text: number(b),
                at: left.map([0, 0]),
                to: left.map([b, 0]),
                side: 'bottom',
                pigment: 'blue',
              },
              {
                id: 'right-width',
                text: number(c),
                at: right.map([b, 0]),
                to: right.map([b + c, 0]),
                side: 'bottom',
                pigment: 'orange',
              },
            ],
          },
        ],
        formula:
          stage === 0
            ? `${number(a)} × (${number(b)} + ${number(c)})`
            : stage === 1
              ? `${number(a)} × ${number(b)} + ${number(a)} × ${number(c)} = ${number(a * b)} + ${number(a * c)}`
              : p < 1
                ? `${number(a * b)} + ${number(a * c)}`
                : `${number(a)} × (${number(b)} + ${number(c)}) = ${number(a * b)} + ${number(a * c)} = ${number(a * (b + c))}`,
        explanation: [
          'Проведи границу: высота обеих частей остаётся той же.',
          'Раздвигаем те же клетки. Ни одна не исчезла и не появилась.',
          'Собираем обратно: умножение распределяется по сумме.',
        ][stage]!,
      };
    },
  };
}

/** A linear map carries the whole grid. Its determinant is the signed area of the image. */
export function linearMap(matrix: Matrix2): ConstructionModel {
  const [[a, b], [c, d]] = matrix;
  finite(a, b, c, d);
  const determinant = a * d - b * c;
  finite(determinant);
  const transformed = (x: number, y: number, p: number): DiagramPoint => [
    x + p * ((a - 1) * x + b * y),
    y + p * (c * x + (d - 1) * y),
  ];
  const corners: DiagramPoint[] = [
    [0, 0],
    [2, 0],
    [2, 2],
    [0, 2],
  ];
  const extents = [
    ...corners,
    ...corners.map(([x, y]) => transformed(x, y, 1)),
    [-0.35, -0.35] as DiagramPoint,
  ];
  const bounds = padded(boundsOf(extents), 0.15);
  return {
    stages: 2,
    result: determinant,
    sample(stage, motion) {
      const p = stage === 0 ? motion : 1;
      const e1 = transformed(1, 0, p),
        e2 = transformed(0, 1, p);
      const amount = (1 + p * (a - 1)) * (1 + p * (d - 1)) - p * p * b * c;
      const sheet = rect(
        'unit-area',
        [
          [0, 0],
          [1, 1],
        ],
        'blue',
        '1',
      );
      sheet.map = ([x, y]) => transformed(x, y, p);
      sheet.grid = [4, 4];
      const lines = [0, 0.5, 1, 1.5, 2].flatMap((v, i) => [
        {
          ...line(`horizontal-${i}`, transformed(0, v, p), transformed(2, v, p)),
          quiet: true,
          opacity: 0.42,
        },
        {
          ...line(`vertical-${i}`, transformed(v, 0, p), transformed(v, 2, p)),
          quiet: true,
          opacity: 0.42,
        },
      ]);
      return {
        panels: [
          {
            id: 'map',
            title: 'Сетка деформируется целиком',
            bounds,
            patches: [sheet],
            paths: [
              ...axes(bounds),
              ...lines,
              { ...line('basis-x', [0, 0], e1, 'orange'), arrow: true },
              { ...line('basis-y', [0, 0], e2, 'purple'), arrow: true },
            ],
            labels: [
              {
                id: 'basis-x-label',
                text: `(${number(e1[0])}; ${number(e1[1])})`,
                at: e1,
                side: 'bottom',
                pigment: 'orange',
              },
              {
                id: 'basis-y-label',
                text: `(${number(e2[0])}; ${number(e2[1])})`,
                at: e2,
                side: 'top',
                pigment: 'purple',
              },
            ],
          },
        ],
        formula:
          stage === 0
            ? `Площадь: ${number(Math.abs(amount))}`
            : `det A = ${number(a)} × ${number(d)} − ${number(b)} × ${number(c)} = ${number(determinant)}`,
        explanation:
          stage === 0
            ? 'Каждая точка следует одному преобразованию; надпись и клетки движутся вместе.'
            : 'Модуль определителя показывает, во сколько раз меняется площадь; знак отражает ориентацию клетки.',
      };
    },
  };
}
