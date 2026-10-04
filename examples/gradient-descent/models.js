import { MathMorph } from '@visual-storytelling/core';

import { n, xy, loss, lift, iterate, pathAt } from './valley.js';
export { n } from './valley.js';
const fText = (value) => {
  if (!(value > 0 && value < 0.001)) return n(value);
  const [coefficient, exponent] = value.toExponential(1).split('e');
  return `${coefficient}·10${String(Number(exponent)).replace(/[-0-9]/g, (c) => ({ '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' })[c])}`;
};

export const chapters = [
  { id: 'direction', title: 'Откуда берётся шаг?', cues: ['gradient', 'one_step'] },
  { id: 'zigzag', title: 'Почему путь зигзагом?', cues: ['cross', 'repeat', 'settle'] },
  {
    id: 'precondition',
    title: 'Как выровнять направления?',
    cues: ['rescale', 'straight', 'result'],
  },
];

export function createValley({
  chapter = 'direction',
  alpha = 0.14,
  beta = 0.7,
  u0 = 2.6,
  v0 = 0.85,
} = {}) {
  const corrected = chapter === 'precondition';
  const start = [u0, v0],
    step = corrected ? beta : alpha;
  const atMinimum = loss(start) < 1e-12;
  const tone = corrected ? 'green' : 'orange';
  const m = MathMorph.model({ k: 0, arrow: 0 });
  const uv = m.value(({ k }) => pathAt(start, step, k, corrected));
  const p = uv.map(xy),
    p3 = uv.map(lift);
  const next = uv.map((v) => xy(iterate(v, step, corrected)));
  const arrowVisible = m.value(({ arrow, k }) => arrow * (k < 0.001 && !atMinimum ? 1 : 0));
  const surface = m.material(([u, v]) => lift([u, v]), {
    domain: [
      [-3.4, -1.8],
      [3.4, 1.8],
    ],
    grid: [14, 14],
    pigment: 'blue',
  });
  const contours = [0.4, 1, 2.5, 5, 9, 14].map((f) =>
    m.curve((t) => xy([Math.sqrt(2 * f) * Math.cos(t), Math.sqrt((2 * f) / 12) * Math.sin(t)]), {
      domain: [0, 2 * Math.PI],
      pigment: 'blue',
      quiet: true,
    }),
  );
  const path = (map, tint, a, pre, max = 12, moving = true) =>
    Array.from({ length: max }, (_, i) => {
      const style = {
        pigment: tint,
        quiet: !moving,
        visible: moving ? m.value(({ k }) => (k > i ? 1 : 0)) : 1,
      };
      return map === lift
        ? m.curve(
            m.value(
              ({ k }) =>
                (t) =>
                  lift(
                    pathAt(start, a, i + t * (moving ? Math.max(0, Math.min(1, k - i)) : 1), pre),
                  ),
            ),
            { domain: [0, 1], ...style },
          )
        : m.segment(
            map(pathAt(start, a, i, pre)),
            m.value(({ k }) =>
              map(pathAt(start, a, moving ? Math.max(i, Math.min(i + 1, k)) : i + 1, pre)),
            ),
            style,
          );
    });
  const axes = [
    m.segment(xy([-3.5, 0]), xy([3.5, 0]), { dashed: true, quiet: true }),
    m.segment(xy([0, -1.7]), xy([0, 1.7]), { dashed: true, quiet: true }),
    m.label('u', xy([3.25, 0]), { side: 'bottom' }),
    m.label('v', xy([0, 1.5]), { side: 'right' }),
  ];
  const reference = corrected ? path(xy, 'orange', alpha, false, 12, false) : [];
  const status = uv.join(
    m.parameter('k'),
    (v, k) =>
      `k = ${Math.abs(k - Math.round(k)) < 1e-5 ? Math.round(k) : `${Math.floor(k)}→${Math.ceil(k)}`} · f = ${fText(loss(v))}`,
  );
  const formula = corrected
    ? uv.map((v) => `q′ = ${n(1 - beta)}q · f = ${fText(loss(v))}`)
    : uv.map((v) => `u′ = ${n(1 - alpha)}u · v′ = ${n(1 - 12 * alpha)}v · f = ${fText(loss(v))}`);
  const steps =
    chapter === 'direction'
      ? [
          {
            to: { arrow: 1 },
            formula: '∇f = R(u,12v) · Δq = −α∇f',
            explanation:
              'Линии сверху соединяют равные f. Из df ≈ ∇f·dq следует: среди одинаковых малых смещений направление −∇f даёт самый быстрый спад. Стрелка пересекает линию уровня поперёк.',
          },
          {
            to: { k: 1 },
            formula,
            explanation:
              v0 === 0
                ? 'Старт находится на дне: поперечная координата и поперечный шаг равны нулю. Остаётся движение вдоль долины.'
                : `Один и тот же шаг виден на поверхности и сверху. При α = ${n(alpha)} поперечная координата ${1 - 12 * alpha < 0 ? 'меняет знак: точка пересекает дно долины' : 'сохраняет знак: точка подходит к дну с той же стороны'}.`,
          },
        ]
      : corrected
        ? [
            {
              to: { arrow: 1 },
              formula: '∇f = R(u,12v)  →  H⁻¹∇f = R(u,v)',
              explanation:
                'В повёрнутом базисе H⁻¹ делит поперечную компоненту градиента на 12. Оба направления теперь имеют одинаковую эффективную кривизну.',
            },
            {
              to: { k: 1 },
              formula,
              explanation: `Зелёный шаг сохраняет отношение u:v. Для этой квадратичной функции точный H⁻¹ известен; при β = ${n(beta)} обе координаты умножаются на ${n(1 - beta)}.`,
            },
            {
              to: { k: 5 },
              formula,
              explanation:
                'Оранжевый след — 12 обычных шагов из того же старта. Зелёный — 5 шагов с H⁻¹. В более общей задаче используют приближённую информацию о кривизне.',
            },
          ]
        : [
            {
              to: { k: 1, arrow: 1 },
              formula,
              explanation:
                'Поперечная координата v получает множитель 1−12α. При α > 1/12 он отрицателен: точка окажется по другую сторону дна.',
            },
            {
              to: { k: 4 },
              formula,
              explanation:
                v0 === 0
                  ? 'Поперечная координата изначально равна нулю и остаётся нулевой. Точка движется только вдоль долины с множителем 1−α.'
                  : alpha > 1 / 12
                    ? 'Каждый следующий шаг снова меняет знак v. Одновременно u убывает с множителем 1−α: вдоль долины движение медленнее.'
                    : 'При этом α поперечная координата сохраняет знак. Зигзагов нет; малый шаг одновременно замедляет продвижение вдоль долины.',
            },
            {
              to: { k: 12 },
              formula,
              explanation:
                'Обычный метод устойчив при 0 < α < 1/6. На границе поперечные колебания перестают затухать; выше неё растут. Измени α и проверь прогноз.',
            },
          ];
  return m.explain({
    panels: [
      {
        title: 'Высота = 0.16 f · можно вращать',
        space: '3d',
        camera: { direction: [0, 5, 3], up: [0, 1, 0] },
        objects: [
          surface,
          ...path(lift, tone, step, corrected),
          m.point(p3, { pigment: tone }),
          m.point([0, 0, 0], { pigment: 'green' }),
        ],
      },
      {
        title: 'Тот же путь сверху',
        objects: [
          ...contours,
          ...axes,
          ...reference,
          ...path(xy, tone, step, corrected),
          m.point([0, 0], { pigment: 'green', label: 'min' }),
          m.point(xy(start), {
            pigment: tone,
            label: 'старт',
            side: 'top',
            visible: atMinimum ? 0 : 1,
          }),
          m.vector(p, next, {
            pigment: 'purple',
            label: corrected ? '−βH⁻¹∇f' : '−α∇f',
            visible: arrowVisible,
            side: 'right',
          }),
          m.point(p, { pigment: tone }),
          m.label(status, [-3.3, -3.3], { side: 'right', pigment: tone }),
        ],
      },
    ],
    steps: atMinimum
      ? steps.map((s) => ({
          ...s,
          formula: '∇f = 0 · Δq = 0 · f = 0',
          explanation:
            'Начальная точка уже в минимуме. Градиент равен нулю, поэтому любой из этих шагов оставляет точку на месте.',
        }))
      : steps,
    result: uv.map(loss),
  });
}
