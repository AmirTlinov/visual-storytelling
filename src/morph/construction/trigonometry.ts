import { createModel } from '../model/index.js';
import { finite, number } from './geometry.js';
import type { ConstructionPlan } from './types.js';

/** Radius, projected height and trace are relationships of one angle. */
export function projection(angle: number): ConstructionPlan {
  finite(angle);
  if (!(angle > 0 && angle < Math.PI * 2))
    throw new Error('Projection angle must be between 0 and 2π');
  const end = angle + Math.PI * 2;
  const model = createModel({ angle: 0, reveal: 0 });
  const theta = model.parameter('angle'),
    reveal = model.parameter('reveal');
  const circle = model.curve((t) => [Math.cos(t), Math.sin(t)], {
    domain: [0, 2 * Math.PI],
    closed: true,
    quiet: true,
  });
  const tip = circle.at(theta),
    height = tip.map((point) => point[1]!);
  const wave = theta.join(height, (x, y) => [x, y]);
  const projection = tip.join(reveal, ([x, y], amount) => [x! * (1 - amount), y!]);
  const sine = height.map((y) => `y = sin θ = ${number(y)}`);
  return model.explain({
    panels: [
      {
        title: 'Поворот → вертикальная проекция',
        axes: true,
        objects: [
          circle,
          model.vector([0, 0], tip),
          model.point(tip),
          model.curve(
            (u, state) => [0.28 * Math.cos(u * state.angle), 0.28 * Math.sin(u * state.angle)],
            { domain: [0, 1], pigment: 'purple' },
          ),
          model.segment(
            tip,
            height.map((y) => [0, y]),
            { pigment: 'orange', dashed: true, visible: reveal },
          ),
          model.segment(
            projection.map(([x]) => [x!, 0]),
            projection,
            { pigment: 'orange', visible: reveal },
          ),
          model.label(
            'r = 1',
            tip.map(([x, y]) => [x! * 0.56, y! * 0.56]),
            { side: 'right' },
          ),
          model.label(
            theta.map((t) => `${number((t * 180) / Math.PI)}°`),
            [0.3, -0.25],
            { pigment: 'purple', side: 'bottom' },
          ),
          model.label(
            height.map((y) => `sin = ${number(y)}`),
            height.map((y) => [0, y / 2]),
            { pigment: 'orange', side: 'left', visible: reveal },
          ),
        ],
      },
      {
        title: 'Высота того же конца радиуса',
        axes: true,
        aspect: 'free',
        objects: [
          model.curve((t) => [t, Math.sin(t)], {
            domain: [0, end],
            pigment: 'orange',
            quiet: true,
            visible: 0.25,
          }),
          model.trace(wave, 'angle', { pigment: 'orange', visible: reveal }),
          model.segment(
            theta.map((t) => [t, 0]),
            wave,
            { pigment: 'orange', visible: reveal },
          ),
          model.segment(
            height.map((y) => [0, y]),
            wave,
            { pigment: 'orange', dashed: true, visible: reveal.map((v) => v * 0.5) },
          ),
          model.label('π', [Math.PI, 0], { pigment: 'ink', side: 'bottom' }),
          model.label('2π', [Math.PI * 2, 0], { pigment: 'ink', side: 'bottom' }),
          model.label('1', [0, 1], { pigment: 'ink', side: 'left' }),
          model.label('−1', [0, -1], { pigment: 'ink', side: 'left' }),
        ],
      },
    ],
    steps: [
      {
        to: { angle },
        formula: 'Радиус сохраняет длину при повороте',
        explanation: 'Синий радиус поворачивается. Проследи за высотой его конца.',
      },
      {
        to: { reveal: 1 },
        formula: sine,
        explanation: 'Переносим эту высоту на ось: она и есть синус угла.',
      },
      {
        to: { angle: end },
        formula: sine,
        explanation:
          'Записываем высоту по мере поворота. Полный оборот возвращает ту же высоту: синус периодичен.',
      },
    ],
    result: height,
  });
}
