import { dampedSpring } from '../../physics/spring.js';
import { createModel, type Coordinate } from '../model/index.js';
import { number, positive } from './geometry.js';
import type { ConstructionPlan } from './types.js';

/** One physical value drives the mass, spring, velocity and both energy regions. */
export function spring(mass: number, stiffness: number, amplitude: number): ConstructionPlan {
  positive(mass, stiffness, amplitude);
  const omega = Math.sqrt(stiffness / mass),
    energy = (stiffness * amplitude * amplitude) / 2;
  positive(omega, energy, 1 / omega);
  const oscillator = dampedSpring(omega / (2 * Math.PI), 0);
  const model = createModel({ load: 0, phase: 0 });
  const motion = model.value(({ load, phase }) => {
    const [x, velocity] = oscillator.step(amplitude * load, 0, 0, phase / omega);
    return {
      x,
      velocity,
      potential: (stiffness * x * x) / 2,
      kinetic: (mass * velocity * velocity) / 2,
      bob: x + 1.9 * amplitude,
    };
  });
  const anchor = -2.3 * amplitude;
  const block = model.material(
    motion.map(({ bob }) => ([u, v]: Coordinate) => [bob + u!, v!]),
    {
      domain: [
        [-0.3 * amplitude, -0.3 * amplitude],
        [0.3 * amplitude, 0.3 * amplitude],
      ],
      fill: true,
      text: number(mass),
      pigment: 'blue',
    },
  );
  const coil = model.curve(
    motion.map(({ bob }) => (u: number) => [
      anchor + (bob - anchor - 0.3 * amplitude) * u,
      Math.sin(u * Math.PI * 18) * amplitude * 0.13 * Math.sin(Math.PI * u) ** 0.25,
    ]),
    { domain: [0, 1], pigment: 'purple' },
  );
  const potential = model.material(
    motion.map((state) => ([u, v]: Coordinate) => [u!, (v! * state.potential) / energy]),
    {
      domain: [
        [0, 0],
        [1, 1],
      ],
      fill: true,
      pigment: 'purple',
    },
  );
  const kinetic = model.material(
    motion.map((state) => ([u, v]: Coordinate) => [
      u!,
      (state.potential + v! * state.kinetic) / energy,
    ]),
    {
      domain: [
        [0, 0],
        [1, 1],
      ],
      fill: true,
      pigment: 'orange',
    },
  );
  const formula = motion.map(
    (state) => `kx²/2 + mv²/2 = ${number(state.potential + state.kinetic)} Дж`,
  );
  return model.explain({
    panels: [
      {
        title: 'Пружина передаёт энергию грузу',
        objects: [
          block,
          coil,
          model.segment([anchor, -0.5 * amplitude], [anchor, 0.5 * amplitude], { pigment: 'ink' }),
          model.segment([1.9 * amplitude, -0.6 * amplitude], [1.9 * amplitude, 0.7 * amplitude], {
            pigment: 'ink',
            quiet: true,
            dashed: true,
          }),
          model.vector(
            motion.map(({ bob }) => [bob, 0.6 * amplitude]),
            motion.map(({ bob, velocity }) => [bob + (velocity / omega) * 0.8, 0.6 * amplitude]),
            {
              pigment: 'orange',
              visible: motion.map(({ velocity }) =>
                Math.min(1, (Math.abs(velocity) / omega / amplitude) * 4),
              ),
            },
          ),
          model.measure([1.9 * amplitude, -0.3 * amplitude], block.at([0, -0.3 * amplitude]), {
            label: motion.map(({ x }) => `x = ${number(x)}`),
            pigment: 'purple',
            side: 'bottom',
          }),
          model.label('Равновесие', [1.9 * amplitude, -0.7 * amplitude], {
            pigment: 'ink',
            side: 'bottom',
          }),
          model.label(
            motion.map(({ velocity }) => `v = ${number(velocity)}`),
            block.at([0, 0.6 * amplitude]),
            { pigment: 'orange', side: 'top', visible: model.parameter('load') },
          ),
        ],
      },
      {
        title: 'Одна энергия в двух формах',
        objects: [
          potential,
          kinetic,
          model.polygon(
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
            ],
            { pigment: 'ink', fill: false, quiet: true, dashed: true },
          ),
          model.label(
            motion.map((state) => `Пружина: ${number(state.potential)} Дж`),
            potential.at([1, 0.5]),
            { pigment: 'purple', side: 'right' },
          ),
          model.label(
            motion.map((state) => `Движение: ${number(state.kinetic)} Дж`),
            kinetic.at([1, 0.5]),
            { pigment: 'orange', side: 'right' },
          ),
          model.label(
            motion.map((state) => `Всего ${number(state.potential + state.kinetic)} Дж`),
            [0.5, 1.1],
            { pigment: 'green', side: 'top' },
          ),
        ],
      },
    ],
    steps: [
      {
        to: { load: 1 },
        formula,
        explanation:
          'Медленно растягиваем пружину: выполненная работа накапливается в её деформации.',
      },
      {
        to: { phase: Math.PI },
        formula,
        explanation: 'Отпускаем груз. У равновесия пружина отдаёт энергию движению.',
      },
      {
        to: { phase: 2 * Math.PI },
        formula,
        explanation:
          'В крайних положениях груз останавливается. После полного колебания возвращается в исходное положение; энергия сохраняется.',
      },
    ],
    result: energy,
  });
}
