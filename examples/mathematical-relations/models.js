import { MathMorph } from '@visual-storytelling/core';
import { dampedSpring } from '@visual-storytelling/core/physics';

const n = (value) => Number(value.toFixed(2)).toString().replace('-', '−');

export function complexSquare(radius = 1) {
  const m = MathMorph.model({ angle: 0 });
  const z = m.value(({ angle }) => [radius * Math.cos(angle), radius * Math.sin(angle)]);
  const square = z.map(([x, y]) => [x * x - y * y, 2 * x * y]);
  const circle = (r) =>
    m.curve((t) => [r * Math.cos(t), r * Math.sin(t)], { domain: [0, 2 * Math.PI], quiet: true });
  return m.explain({
    panels: [
      {
        title: 'Исходное число z',
        axes: true,
        objects: [circle(radius), m.vector([0, 0], z, { label: 'z' }), m.point(z)],
      },
      {
        title: 'Квадрат того же числа',
        axes: true,
        objects: [
          circle(radius * radius),
          m.trace(square, 'angle', { pigment: 'orange' }),
          m.vector([0, 0], square, { label: 'z²', pigment: 'orange' }),
          m.point(square, { pigment: 'orange' }),
        ],
      },
    ],
    steps: [
      {
        to: { angle: Math.PI / 2 },
        formula: m
          .parameter('angle')
          .map((a) => `θ = ${n((a * 180) / Math.PI)}°  →  2θ = ${n((a * 360) / Math.PI)}°`),
        explanation:
          'Поворачиваем исходное число на четверть оборота. Его квадрат проходит пол-оборота.',
      },
      {
        to: { angle: Math.PI },
        formula: '(−z)² = z²',
        explanation:
          'Противоположные исходные числа дают один квадрат. Справа завершился полный оборот.',
      },
      {
        to: { angle: 2 * Math.PI },
        formula: `|z²| = |z|² = ${n(radius * radius)}`,
        explanation:
          'За один оборот исходного числа квадрат делает два. Расстояние от нуля тоже возводится в квадрат.',
      },
    ],
    result: square,
  });
}

export function complexMaterial() {
  const m = MathMorph.model({ k: 0 });
  const patch = m.material(
    ([u, v], { k }) => [u + k * (u * u - v * v - u), v + k * (2 * u * v - v)],
    {
      domain: [
        [0.45, -0.65],
        [1.45, 0.65],
      ],
      grid: [6, 6],
      text: 'z',
      pigment: 'blue',
    },
  );
  const a = patch.at([0.95, 0.15]),
    b = patch.at([1.25, 0.15]);
  return m.explain({
    panels: [
      {
        title: 'Что z² делает с маленькой областью?',
        axes: true,
        objects: [
          patch,
          m.point(a, { label: 'A', pigment: 'purple' }),
          m.point(b, { label: 'B', pigment: 'orange' }),
          m.measure(a, b, { pigment: 'orange' }),
        ],
      },
    ],
    steps: [
      {
        to: { k: 1 },
        formula: '(u + iv)² = (u² − v²) + i·2uv',
        explanation:
          'Применяем квадрат к каждой точке материала. Сетка, буква и измерение следуют тем же точкам: расстояния и направления меняются вместе.',
      },
    ],
  });
}

export function phasePortrait(damping = 0.13) {
  const m = MathMorph.model({ time: 0 }),
    oscillator = dampedSpring(0.5, damping);
  const state = m.value(({ time }) => oscillator.step(1.3, 0, 0, time));
  const bob = state.map(([x]) => x + 2);
  const block = m.material(
    bob.map((x) => ([u, v]) => [x + u, v]),
    {
      domain: [
        [-0.24, -0.3],
        [0.24, 0.3],
      ],
      text: 'm',
    },
  );
  const coil = m.curve(
    bob.map((x) => (t) => [
      -0.8 + (x - 0.24 + 0.8) * t,
      0.1 * Math.sin(18 * Math.PI * t) * Math.sin(Math.PI * t),
    ]),
    { domain: [0, 1], pigment: 'purple' },
  );
  const phase = state.map(([x, v]) => [x, v]);
  const energy = state.map(([x, v]) => (oscillator.stiffness * x * x + v * v) / 2);
  return m.explain({
    panels: [
      {
        title: 'Груз теряет энергию',
        objects: [
          block,
          coil,
          m.segment([-0.8, -0.5], [-0.8, 0.5], { pigment: 'ink' }),
          m.segment([2, -0.6], [2, 0.6], { dashed: true, quiet: true }),
          m.measure([2, -0.3], block.at([0, -0.3]), {
            label: state.map(([x]) => `x = ${n(x)}`),
            pigment: 'purple',
          }),
          m.vector(
            block.at([0, 0.5]),
            state.map(([x, v]) => [2 + x + v / 4, 0.5]),
            { label: 'v', pigment: 'orange' },
          ),
        ],
      },
      {
        title: 'Одна точка хранит положение и скорость',
        axes: true,
        objects: [
          m.trace(phase, 'time', { pigment: 'purple' }),
          m.point(phase, { label: state.map(([x, v]) => `(${n(x)}; ${n(v)})`), pigment: 'orange' }),
        ],
      },
    ],
    steps: [
      {
        to: { time: 2 },
        formula: energy.map((e) => `E = kx²/2 + v²/2 = ${n(e)}`),
        explanation:
          'Каждому положению и скорости груза соответствует одна точка справа. След делает первый виток.',
      },
      {
        to: { time: 8 },
        formula: energy.map((e) => `E = ${n(e)}`),
        explanation:
          'Сопротивление забирает энергию. Размах уменьшается, а фазовая траектория закручивается к покою.',
      },
    ],
    result: state,
  });
}

export function rolledSurface() {
  const m = MathMorph.model({ bend: 0 });
  const paper = m.material(
    ([u, v], { bend: k }) =>
      Math.abs(k) < 1e-7 ? [u, v, 0] : [Math.sin(k * u) / k, v, (1 - Math.cos(k * u)) / k],
    {
      domain: [
        [-2.8, -1],
        [2.8, 1],
      ],
      grid: [14, 5],
      text: 'МАТЕРИАЛ',
    },
  );
  const marked = paper.at([1.3, 0.45]);
  return m.explain({
    panels: [
      {
        title: 'Штрихи принадлежат поверхности',
        objects: [paper, m.point(marked, { pigment: 'orange' })],
      },
    ],
    steps: [
      {
        to: { bend: 0.5 },
        formula: 'r(u,v) = (sin(ku)/k, v, (1−cos(ku))/k)',
        explanation:
          'Лист сгибается в пространстве. Точки, клетки и каждый штрих надписи остаются на своих местах в материале.',
      },
      {
        to: { bend: 1 },
        formula: '|∂r/∂u| = 1',
        explanation:
          'Лист сворачивается без растяжения. Передняя часть закрывает дальние штрихи. Поверни поверхность мышью, чтобы проверить объём.',
      },
    ],
    result: m.parameter('bend'),
  });
}

export const chapters = [
  { id: 'complex', title: 'Почему квадрат удваивает угол?', create: complexSquare },
  { id: 'material', title: 'Формула меняет целую область', create: complexMaterial },
  { id: 'phase', title: 'Движение становится траекторией', create: phasePortrait },
  { id: 'surface', title: 'Подписанный лист сворачивается в 3D', create: rolledSurface },
];
