import { SceneShell, MathMorph, Morph } from '@visual-storytelling/core';
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
for (const chapter of chapters) {
  chapter.title = script.segments.find((segment) => segment.id === chapter.id).title;
  chapter.cues = Object.keys(script.cues).filter((id) => id.startsWith(`${chapter.id}_`));
}
window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.getElementById('formula-objects');
  const shell = SceneShell.mount(root, {
    title: 'Математика меняет форму',
    parameters: [
      {
        key: 'chapter',
        type: 'select',
        label: 'Механизм',
        value: 'distribute',
        options: chapters.map((c) => ({ value: c.id, label: c.title })),
      },
      {
        key: 'input',
        label: chapters[0].parameter,
        min: 0,
        max: 1,
        step: 0.01,
        value: 0.5,
        format: (x) => `${Math.round(x * 100)}%`,
      },
      {
        key: 'progress',
        label: 'Преобразование',
        min: 0,
        max: 1,
        step: 0.005,
        value: 0,
        format: (x) => `${Math.round(x * 100)}%`,
      },
    ],
  });
  const audio = root.querySelector('audio');
  const drawing = await MathMorph.mount(shell.stage, chapters[0].operation(3));
  shell.attachView(drawing.view);
  let previous = '';
  shell.attachStory({
    script,
    audio,
    stateAt(frame) {
      const chapter = chapters.findLast((c) => frame.has(c.id)) ?? chapters[0];
      return {
        chapter: chapter.id,
        input: (chapter.value - chapter.range[0]) / (chapter.range[1] - chapter.range[0]),
        progress: MathMorph.timing(frame, chapter.cues, chapter.cues.length).progress,
      };
    },
    render(state, frame, mode) {
      const chapter = chapters.find((c) => c.id === state.chapter);
      const key = `${state.chapter}/${state.input}`;
      if (previous !== key) {
        shell.describeParameter('input', {
          label: chapter.parameter,
          format: (p) =>
            `${+(chapter.range[0] + p * (chapter.range[1] - chapter.range[0])).toFixed(2)}${chapter.unit ?? ''}`,
        });
        drawing.setOperation(
          chapter.operation(chapter.range[0] + state.input * (chapter.range[1] - chapter.range[0])),
        );
        previous = key;
      }
      drawing.render(mode === 'story' ? frame : state.progress, chapter.cues);
    },
  });
})();
