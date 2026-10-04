import { SceneShell, MathMorph, Morph } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';

const chapters = [
  {
    id: 'parts',
    title: 'Разделить, удвоить, собрать',
    input: 6,
    expression: 'sum(partition(x, 3) * 2)',
    inputs: (x) => ({ x: MathMorph.body(x, Morph.capsule(0.62, 2.8)) }),
    text: 'Разделим целое на три равные части. Удвоим каждую, затем соединим их.',
  },
  {
    id: 'length',
    title: 'Из двух величин — одна',
    input: 3,
    expression: 'sqrt(a^2 + b^2)',
    inputs: (a) => ({
      a: MathMorph.body(a, Morph.box([1.4, 1.4, 1.4])),
      b: MathMorph.body(4, Morph.sphere(0.7)),
    }),
    text: 'Возведём обе величины в квадрат, сложим и извлечём корень. Объём здесь показывает величину числа.',
  },
  {
    id: 'response',
    title: 'Плавный нелинейный отклик',
    input: 2,
    expression: '1 / (1 + exp(-x))',
    inputs: (x) => ({ x: MathMorph.body(x, Morph.sphere(0.7)) }),
    text: 'Сигмоида преобразует вход в число между нулём и единицей. Надписи показывают знаковые значения; размер фишки остаётся постоянным.',
  },
  {
    id: 'slope',
    title: 'Формула скорости изменения',
    input: 2,
    expression: 'diff(x^3, x)',
    inputs: (x) => ({ x: MathMorph.body(x, Morph.box([1.4, 1.4, 1.4])) }),
    text: 'Производная куба в выбранной точке равна трём квадратам её координаты. Проверь другую точку.',
  },
  {
    id: 'area',
    title: 'Накопленная величина',
    input: 3,
    expression: 'integral(t^2, t, 0, x)',
    inputs: (x) => ({ x: MathMorph.body(x, Morph.capsule(0.6, 2.1)) }),
    text: 'Интеграл квадратичной функции от нуля до выбранной границы становится величиной результата.',
  },
  {
    id: 'matrix',
    title: 'Функция целой матрицы',
    input: 2,
    expression: 'det(A)',
    inputs: (x) => ({
      A: MathMorph.body(
        [
          [x, 1],
          [1, 3],
        ],
        Morph.box([1.4, 1.4, 1.4]),
      ),
    }),
    text: 'Четыре числа матрицы участвуют в вычислении её определителя. Измени первый элемент.',
  },
];
const operation = (chapter, x) => MathMorph.formula(chapter.expression, chapter.inputs(x));
let total = 0;
for (const chapter of chapters) {
  chapter.plan = MathMorph.plan(operation(chapter, chapter.input));
  chapter.start = total;
  chapter.end = total += 1.4 + chapter.plan.stages * 4.2;
}
const script = {
  duration: total,
  segments: chapters.map((c) => ({
    id: c.id,
    title: c.title,
    text: c.text,
    start: c.start,
    end: c.end,
  })),
  cues: Object.fromEntries(
    chapters.flatMap((c) => [
      [c.id, { start: c.start, end: c.end, text: c.text }],
      [`${c.id}_move`, { start: c.start + 0.7, end: c.end - 0.7, action: c.text }],
    ]),
  ),
};

window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.getElementById('formula-objects');
  const shell = SceneShell.mount(root, {
    title: 'Формула действует на предметы',
    parameters: [
      {
        key: 'chapter',
        type: 'select',
        label: 'Формула',
        value: 'parts',
        options: chapters.map((c) => ({ value: c.id, label: c.title })),
      },
      { key: 'x', label: 'Вход', min: 0.5, max: 6, step: 0.5, value: 6 },
      {
        key: 'progress',
        label: 'Преобразование',
        min: 0,
        max: 1,
        step: 0.005,
        value: 0,
        format: (v) => `${Math.round(Number(v) * 100)}%`,
      },
    ],
  });
  const math = await MathMorph.mount(shell.stage, chapters[0].plan);
  shell.attachView(math.view);
  let key = 'parts/6';
  const story = shell.attachStory({
    script,
    stateAt(frame) {
      const chapter = chapters.findLast((c) => frame.has(c.id)) ?? chapters[0];
      return {
        chapter: chapter.id,
        x: chapter.input,
        progress: frame.progress(`${chapter.id}_move`),
      };
    },
    render(state, frame, mode) {
      const next = `${state.chapter}/${state.x}`;
      if (key !== next) {
        const chapter = chapters.find((c) => c.id === state.chapter);
        math.setOperation(operation(chapter, state.x));
        key = next;
      }
      math.render(mode === 'story' ? frame : state.progress, `${state.chapter}_move`);
    },
  });
  Object.assign(root.scene, { math, story });
  shell.onDispose(math.dispose);
})();
