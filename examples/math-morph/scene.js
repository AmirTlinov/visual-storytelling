import { SceneShell, MathMorph } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';
import './style.css';
import timing from './timeline.json' with { type: 'json' };

const operations = [
  { value: 'add', label: 'Сложение', a: 2, b: 4 },
  { value: 'divide', label: 'Деление', a: 6, b: 3 },
  { value: 'multiply', label: 'Умножение', a: 2, b: 3 },
  { value: 'power', label: 'Степень', a: 2, b: 3 },
  { value: 'exponential', label: 'Экспонента', a: 2, b: 3 },
];
function operationFor({ operation, a, b }) {
  return operation === 'exponential' ? MathMorph.exponential(0, b, a) : MathMorph[operation](a, b);
}
function stateAt(frame) {
  const { value: operation, a, b } = operations.findLast(({ value }) => frame.has(`${value}_wait`));
  return { operation, a, b, progress: frame.progress(`${operation}_move`) };
}
function explanation({ operation, a, b }) {
  if (operation === 'add') return `Сколько получится, если к ${a} прибавить ${b}?`;
  if (operation === 'divide') return `Сколько в каждой части, если ${a} разделить на ${b}?`;
  if (operation === 'multiply') return `Стороны прямоугольника — ${a} и ${b}. Какова площадь?`;
  if (operation === 'power') return `Начни с 1. Каждый шаг умножает на ${a}; число шагов — ${b}.`;
  return `Основание ${a}, показатель плавно меняется от 0 до ${b}`;
}

window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.getElementById('math-morph-scene');
  const shell = SceneShell.mount(root, {
    title: 'Собрать, разделить, умножить',
    parameters: [
      { key: 'operation', type: 'choice', label: 'Действие', value: 'add', options: operations },
      { key: 'a', label: 'Первое число', min: 1, max: 6, step: 1, value: 2 },
      { key: 'b', label: 'Второе число', min: 1, max: 4, step: 1, value: 4 },
      {
        key: 'progress',
        label: 'Переход',
        min: 0,
        max: 1,
        step: 0.01,
        value: 0,
        format: (value) => `${Math.round(Number(value) * 100)}%`,
      },
    ],
  });
  const question = document.createElement('p');
  question.className = 'math-question';
  shell.stage.before(question);
  const math = await MathMorph.mount(shell.stage, MathMorph.add(2, 4));
  shell.attachView(math.view);
  const hint = document.createElement('p');
  hint.className = 'math-hint';
  hint.textContent =
    'Поворачивай фигуру во время рассказа; свои числа можно проверить в «Исследовать».';
  shell.stage.after(hint);
  let key = 'add/2/4',
    current;
  const story = shell.attachStory({
    script: timing,
    stateAt,
    render(state, frame, mode) {
      const next = `${state.operation}/${state.a}/${state.b}`;
      if (next !== key) {
        const operation = operationFor(state);
        math.setOperation(operation);
        key = next;
      }
      const time = mode === 'story' ? frame : state.progress;
      const measured = math.render(time, `${state.operation}_move`);
      question.textContent = explanation(state);
      current = { ...state, ...measured, mode };
    },
  });
  const snapshot = root.scene.snapshot;
  root.scene.extend({ story, snapshot: () => ({ ...snapshot(), ...current }) });
  shell.onDispose(() => {
    question.remove();
    hint.remove();
  });
})().catch((error) => {
  const alert = document.createElement('p');
  alert.setAttribute('role', 'alert');
  alert.textContent = error.message;
  document.getElementById('math-morph-scene').append(alert);
  throw error;
});
