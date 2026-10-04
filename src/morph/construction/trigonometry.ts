import { finite, number, line, path, sample, axes, lerp } from './geometry.js';
import type { ConstructionModel, DiagramBounds, DiagramPoint } from './types.js';

/** The moving point, radius, projection and function trace share one angle. */
export function projection(angle: number): ConstructionModel {
  finite(angle);
  if (!(angle > 0 && angle < Math.PI * 2))
    throw new Error('Projection angle must be between 0 and 2π');
  const circleBounds: DiagramBounds = [
    [-1.35, -1.3],
    [1.35, 1.35],
  ];
  const end = angle + Math.PI * 2;
  const waveBounds: DiagramBounds = [
    [-0.2, -1.3],
    [end + 0.25, 1.3],
  ];
  return {
    stages: 3,
    result: Math.sin(angle),
    sample(stage, p) {
      const theta = stage === 0 ? angle * p : stage === 1 ? angle : lerp(angle, end, p);
      const x = Math.cos(theta),
        y = Math.sin(theta),
        point: DiagramPoint = [x, y];
      const reveal = stage === 0 ? 0 : stage === 1 ? p : 1;
      const projectionX = x * (1 - reveal);
      return {
        panels: [
          {
            id: 'circle',
            title: 'Поворот → вертикальная проекция',
            bounds: circleBounds,
            paths: [
              ...axes(circleBounds),
              {
                ...path(
                  'circle',
                  sample((t) => [Math.cos(t), Math.sin(t)], 0, Math.PI * 2),
                ),
                quiet: true,
              },
              { ...line('radius', [0, 0], point, 'blue'), arrow: true },
              {
                ...path(
                  'arc',
                  sample((t) => [0.28 * Math.cos(t), 0.28 * Math.sin(t)], 0, theta),
                ),
                pigment: 'purple',
              },
              {
                ...line('horizontal-projection', point, [0, y], 'orange'),
                dashed: true,
                opacity: reveal,
              },
              { ...line('sine', [projectionX, 0], [projectionX, y], 'orange'), opacity: reveal },
              {
                ...path(
                  'tip',
                  sample(
                    (t) => [x + 0.035 * Math.cos(t), y + 0.035 * Math.sin(t)],
                    0,
                    Math.PI * 2,
                    20,
                  ),
                  'blue',
                ),
                closed: true,
                fill: true,
              },
            ],
            labels: [
              {
                id: 'radius-label',
                text: 'r = 1',
                at: [x * 0.56, y * 0.56],
                pigment: 'blue',
                side: 'right',
              },
              {
                id: 'angle-label',
                text: `${number((theta * 180) / Math.PI)}°`,
                at: [0.3, -0.25],
                pigment: 'purple',
                side: 'bottom',
              },
              {
                id: 'sine-label',
                text: `sin = ${number(y)}`,
                at: [0, y / 2],
                pigment: 'orange',
                side: 'left',
                opacity: reveal,
              },
            ],
          },
          {
            id: 'wave',
            title: 'Высота того же конца радиуса',
            bounds: waveBounds,
            aspect: 'free',
            paths: [
              ...axes(waveBounds),
              {
                ...path(
                  'wave-context',
                  sample((t) => [t, Math.sin(t)], 0, end),
                  'orange',
                ),
                quiet: true,
                opacity: 0.25,
              },
              {
                ...path(
                  'wave',
                  sample((t) => [t, Math.sin(t)], 0, theta),
                  'orange',
                ),
                opacity: reveal,
              },
              { ...line('wave-projection', [theta, 0], [theta, y], 'orange'), opacity: reveal },
              {
                ...line('same-height', [0, y], [theta, y], 'orange'),
                opacity: reveal * 0.5,
                dashed: true,
              },
            ],
            labels: [
              { id: 'pi', text: 'π', at: [Math.PI, 0], side: 'bottom' },
              { id: 'two-pi', text: '2π', at: [Math.PI * 2, 0], side: 'bottom' },
              { id: 'max', text: '1', at: [0, 1], side: 'left' },
              { id: 'min', text: '−1', at: [0, -1], side: 'left' },
            ],
          },
        ],
        formula: stage === 0 ? 'Радиус сохраняет длину при повороте' : `y = sin θ = ${number(y)}`,
        explanation: [
          'Синий радиус поворачивается. Проследи за высотой его конца.',
          'Переносим эту высоту на ось: она и есть синус угла.',
          'Записываем высоту по мере поворота. Полный оборот возвращает ту же высоту: синус периодичен.',
        ][stage]!,
      };
    },
  };
}
