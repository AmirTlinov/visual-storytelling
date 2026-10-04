import { MorphStory, MathMorph, Morph } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';
import script from './timeline.json';

const chapters = [
  {
    id: 'distribute',
    parameter: 'Высота прямоугольника',
    value: 3,
    range: [1, 5],
    operation: (a) => MathMorph.distribute(a, 2, 3),
  },
  {
    id: 'shear',
    parameter: 'Сдвиг каждого ряда',
    value: 0.8,
    range: [-1.2, 1.2],
    operation: (s) =>
      MathMorph.linear([
        [1, s],
        [0, 1],
      ]),
  },
  {
    id: 'projection',
    parameter: 'Угол поворота',
    unit: '°',
    value: 60,
    range: [20, 140],
    operation: (degrees) => MathMorph.project((degrees * Math.PI) / 180),
  },
  {
    id: 'derivative',
    parameter: 'Точка на оси x',
    value: 1.5,
    range: [0.3, 2.4],
    operation: (x) => MathMorph.derivative('x^2', x),
  },
  {
    id: 'integral',
    parameter: 'Правая граница',
    value: 3,
    range: [1, 4],
    operation: (end) => MathMorph.integral('x^2', 0, end),
  },
  {
    id: 'energy',
    parameter: 'Растяжение пружины',
    unit: ' м',
    value: 1,
    range: [0.5, 1.6],
    operation: (amplitude) => MathMorph.spring({ mass: 1, stiffness: 4, amplitude }),
  },
  {
    id: 'bend',
    parameter: 'Кривизна полоски',
    value: 0.55,
    range: [0.15, 0.8],
    operation: (bend) =>
      MathMorph.deform({
        domain: [
          [-2, -1],
          [2, 1],
        ],
        parameter: [0, bend],
        grid: [8, 4],
        text: 'ФОРМА',
        label: 'Сгибаем материал вместе с нанесённым рисунком',
        map: ([x, y], k) =>
          Math.abs(k) < 1e-8
            ? [x, y]
            : [(1 / k + y) * Math.sin(k * x), (1 / k + y) * Math.cos(k * x) - 1 / k],
      }),
  },
  {
    id: 'bodies',
    parameter: 'Количество в целом',
    value: 6,
    range: [3, 12],
    operation: (value) =>
      MathMorph.formula('sum(partition(x, 3) * 2)', {
        x: MathMorph.body(value, Morph.capsule(0.62, 2.8)),
      }),
  },
];
window.galleryReady = MorphStory.mount(document.getElementById('formula-objects'), {
  title: 'Математика меняет форму',
  presenter: MathMorph,
  script,
  audio: document.querySelector('audio'),
  initial: { input: 0.5 },
  parameters: [{ key: 'input', label: 'Параметр', min: 0, max: 1, step: 0.01 }],
  chapters: chapters.map((chapter) => ({
    id: chapter.id,
    initial: { input: (chapter.value - chapter.range[0]) / (chapter.range[1] - chapter.range[0]) },
    descriptions: {
      input: {
        label: chapter.parameter,
        format: (p) =>
          `${+(chapter.range[0] + p * (chapter.range[1] - chapter.range[0])).toFixed(2)}${chapter.unit ?? ''}`,
      },
    },
    operation: ({ input }) =>
      chapter.operation(chapter.range[0] + input * (chapter.range[1] - chapter.range[0])),
  })),
});
