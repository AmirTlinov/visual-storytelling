import { dampedSpring } from '../../physics/spring.js';
import { number, positive, line, path, rect, sample } from './geometry.js';
import type { ConstructionModel } from './types.js';

/** The physical spring owns displacement and velocity; both energy regions use that same state. */
export function spring(mass: number, stiffness: number, amplitude: number): ConstructionModel {
  positive(mass, stiffness, amplitude);
  const omega = Math.sqrt(stiffness / mass),
    energy = (stiffness * amplitude * amplitude) / 2;
  positive(omega, energy, 1 / omega);
  const motion = dampedSpring(omega / (2 * Math.PI), 0);
  return {
    stages: 3,
    result: energy,
    sample(stage, p) {
      const physicalTime = stage === 0 ? 0 : ((stage - 1 + p) * Math.PI) / omega;
      const [x, velocity] =
        stage === 0 ? [amplitude * p, 0] : motion.step(amplitude, 0, 0, physicalTime);
      const potential = (stiffness * x * x) / 2,
        kinetic = (mass * velocity * velocity) / 2;
      const anchor = -2.3 * amplitude,
        bob = x + amplitude * 1.9;
      const coil = sample(
        (u) => [
          anchor + (bob - anchor - amplitude * 0.3) * u,
          Math.sin(u * Math.PI * 18) * amplitude * 0.13 * Math.sin(Math.PI * u) ** 0.25,
        ],
        0,
        1,
        180,
      );
      const object = rect(
        'mass',
        [
          [-0.3 * amplitude, -0.3 * amplitude],
          [0.3 * amplitude, 0.3 * amplitude],
        ],
        'blue',
        `${number(mass)}`,
      );
      object.map = ([u, v]) => [bob + u, v];
      const total = (potential + kinetic) / energy,
        fraction = potential / energy;
      return {
        panels: [
          {
            id: 'spring',
            title: 'Пружина передаёт энергию грузу',
            bounds: [
              [anchor - 0.2 * amplitude, -amplitude],
              [3.5 * amplitude, amplitude],
            ],
            patches: [object],
            paths: [
              line('wall', [anchor, -0.5 * amplitude], [anchor, 0.5 * amplitude]),
              path('coil', coil, 'purple'),
              {
                ...line(
                  'equilibrium',
                  [1.9 * amplitude, -0.6 * amplitude],
                  [1.9 * amplitude, 0.7 * amplitude],
                ),
                dashed: true,
                quiet: true,
              },
              {
                ...line(
                  'velocity',
                  [bob, 0.6 * amplitude],
                  [bob + (velocity / omega) * 0.8, 0.6 * amplitude],
                  'orange',
                ),
                arrow: true,
                opacity: Math.min(1, (Math.abs(velocity) / omega / amplitude) * 4),
              },
            ],
            labels: [
              {
                id: 'displacement',
                text: `x = ${number(x)}`,
                at: [1.9 * amplitude, -0.3 * amplitude],
                to: [bob, -0.3 * amplitude],
                side: 'bottom',
                pigment: 'purple',
              },
              {
                id: 'rest',
                text: 'Равновесие',
                at: [1.9 * amplitude, -0.7 * amplitude],
                side: 'bottom',
              },
              {
                id: 'velocity-value',
                text: `v = ${number(velocity)}`,
                at: [bob, 0.6 * amplitude],
                side: 'top',
                pigment: 'orange',
                opacity: stage === 0 ? 0 : 1,
              },
            ],
          },
          {
            id: 'energy',
            title: 'Одна энергия в двух формах',
            bounds: [
              [-0.05, -0.3],
              [1.05, 1.25],
            ],
            patches: [
              {
                ...rect(
                  'elastic-energy',
                  [
                    [0, 0],
                    [1, 1],
                  ],
                  'purple',
                ),
                map: ([u, v]) => [u, v * fraction],
              },
              {
                ...rect(
                  'kinetic-energy',
                  [
                    [0, 0],
                    [1, 1],
                  ],
                  'orange',
                ),
                map: ([u, v]) => [u, fraction + (v * kinetic) / energy],
              },
            ],
            paths: [
              {
                ...path('capacity', [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 1],
                ]),
                closed: true,
                quiet: true,
                dashed: true,
              },
            ],
            labels: [
              {
                id: 'potential',
                text: `Пружина: ${number(potential)} Дж`,
                at: [1, fraction / 2],
                side: 'right',
                pigment: 'purple',
              },
              {
                id: 'kinetic',
                text: `Движение: ${number(kinetic)} Дж`,
                at: [1, (fraction + total) / 2],
                side: 'right',
                pigment: 'orange',
              },
              {
                id: 'total',
                text: `Всего ${number(potential + kinetic)} Дж`,
                at: [0.5, 1.1],
                side: 'top',
                pigment: 'green',
              },
            ],
          },
        ],
        formula: `kx²/2 + mv²/2 = ${number(potential + kinetic)} Дж`,
        explanation: [
          'Медленно растягиваем пружину: выполненная работа накапливается в её деформации.',
          'Отпускаем груз. У равновесия пружина отдаёт энергию движению.',
          'В крайних положениях груз останавливается. После полного колебания возвращается в исходное положение; энергия сохраняется.',
        ][stage]!,
      };
    },
  };
}
