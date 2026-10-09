import { SceneShell, explanationLayout } from '@visual-storytelling/core';
import { surface } from '@visual-storytelling/core/ink';
import { predictionPrompt, disclosure } from '@visual-storytelling/core/controls';
import { motion, format } from './model.js';
import { distanceDrawing } from './drawing.js';
import '@visual-storytelling/core/style.css';

window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.getElementById('graph-lab');
  const shell = SceneShell.mount(root, {
    title: 'Скорость — это наклон',
    parameters: [
      { key: 'speed', label: 'Скорость, м/с', value: 3, min: 1, max: 4, step: 0.5 },
      { key: 'time', label: 'Время, с', value: 4, min: 0, max: 10, step: 0.1 },
      { key: 'compare', type: 'toggle', label: 'Сравнить с половиной скорости', value: false },
      { key: 'detail', type: 'toggle', label: 'Разобрать наклон', value: false },
      { key: 'practice', type: 'toggle', label: 'Проверить предположение', value: false },
      { key: 'guess', label: 'Прогноз, м', value: -1, min: -1, max: 40, step: 1 },
      { key: 'checked', type: 'toggle', label: 'Прогноз проверен', value: false },
    ],
  });
  shell.showParameters(['speed', 'time', 'compare']);
  const layout = explanationLayout(shell.stage);
  layout.controls.append(shell.fields);
  layout.footer.append(shell.actions);
  layout.notes.setAttribute('aria-label', 'Как читать график');
  layout.notes.innerHTML = `
    <p class="ve-eyebrow">Читаем одну точку</p>
    <p class="ve-reading" data-graph-reading aria-live="polite" aria-atomic="true"></p>
    <p data-graph-cause></p>`;
  const change = (next) => shell.input(next);
  const details = disclosure(layout.notes, {
    label: 'Откуда берётся наклон?',
    onChange: (detail) => change({ detail }),
  });
  details.body.innerHTML = `
    <p data-graph-interval></p>
    <p class="ve-equation" data-graph-ratio></p>
    <p class="ve-note">Горизонтальный шаг измеряет время, вертикальный — добавленный путь. При изменении скорости меняется высота этого треугольника.</p>`;
  const practice = disclosure(layout.notes, {
    label: 'Предскажите следующую точку',
    onChange: (open) =>
      change(
        open
          ? { practice: true, speed: 3, time: 4, compare: false, guess: -1, checked: false }
          : { practice: false },
      ),
  });
  const view = surface(layout.figure, {
    id: 'distance',
    title: 'Путь по времени',
    description: 'По горизонтали время в секундах, по вертикали путь в метрах.',
    width: 700,
    height: 400,
    grid: false,
  });
  const readout = layout.notes.querySelector('[data-graph-reading]');
  const cause = layout.notes.querySelector('[data-graph-cause]');
  const ratio = details.body.querySelector('[data-graph-ratio]');
  const interval = details.body.querySelector('[data-graph-interval]');
  let drawing,
    signature = '',
    prompt;
  const story = shell.attachStory({
    script: {
      duration: 16,
      segments: [
        {
          id: 'read',
          title: 'Каждую секунду — ещё три метра',
          start: 0,
          end: 10,
          text: 'Точка показывает время и пройденный путь. За каждую секунду путь увеличивается на три метра.',
        },
        {
          id: 'compare',
          title: 'За то же время — разный путь',
          start: 10,
          end: 16,
          text: 'При той же длительности половина скорости даёт половину пути. Наклон линии показывает эту связь.',
        },
      ],
      cues: {
        read: { start: 0, end: 10, action: 'Время превращается в измеренный путь.' },
        compare: { start: 10, end: 16, action: 'Две скорости дают два расстояния за одно время.' },
      },
    },
    stateAt: (frame) => ({
      speed: 3,
      time: Math.min(10, 4 + Math.max(0, frame.time - 2)),
      compare: frame.time >= 10,
      detail: false,
      practice: false,
      guess: -1,
      checked: false,
    }),
    render(values) {
      const model = motion(values);
      const width = Math.max(280, Math.round(view.element.parentElement.clientWidth));
      const key = `${width}/${model.speed}`;
      if (key !== signature) {
        drawing?.dispose();
        drawing = distanceDrawing(view, width, model.speed);
        signature = key;
      }
      drawing.render(model);
      const sentence = `${format(model.time)} с × ${format(model.speed)} м/с = ${format(model.distance)} м${model.comparison !== null ? `; при ${format(model.speed / 2)} м/с — ${format(model.comparison)} м` : ''}.`;
      if (readout.textContent !== sentence) {
        const result = document.createElement('mark');
        result.textContent = `${format(model.distance)} м`;
        readout.replaceChildren(
          `${format(model.time)} с × ${format(model.speed)} м/с = `,
          result,
          model.comparison !== null
            ? `; при ${format(model.speed / 2)} м/с — ${format(model.comparison)} м.`
            : '.',
        );
      }
      cause.textContent =
        model.comparison !== null
          ? 'Время одинаковое. Синяя линия выше: за каждую секунду прибавляется вдвое больше пути.'
          : `Каждую секунду добавляется ${format(model.speed)}\u00a0м. Чем больше этот прирост, тем круче линия.`;
      interval.textContent =
        model.time > 0
          ? `От ${format(model.interval.start)} до ${format(model.time)}\u00a0с прошло ${format(model.interval.seconds)}\u00a0с. За это время путь вырос на ${format(model.interval.distance)}\u00a0м.`
          : 'В начальной точке путь равен нулю. Выберите время больше нуля, чтобы измерить наклон.';
      ratio.textContent =
        model.time > 0
          ? `${format(model.interval.distance)} м / ${format(model.interval.seconds)} с = ${format(model.speed)} м/с`
          : '';
      details.set(Boolean(values.detail));
      practice.set(Boolean(values.practice));
      const predicting = Boolean(values.practice);
      for (const key of ['speed', 'time', 'compare'])
        shell.describeParameter(key, { disabled: predicting });
      prompt?.render({
        question: 'За 4 с пройдено 12 м. Скорость остаётся 3 м/с. Какой путь будет к моменту 6 с?',
        guess: Number(values.guess) < 0 ? null : values.guess,
        checked: Boolean(values.checked),
        feedback: `${Number(values.guess) === model.distance ? 'Верно.' : `Ваш прогноз: ${values.guess} м.`} Получилось ${format(model.distance)} м: ещё две секунды добавили два раза по три метра. На графике это та же прямая.`,
      });
      view.element.querySelector('desc').textContent =
        `Равномерное движение от нулевого положения. ${sentence}`;
    },
  });
  prompt = predictionPrompt(practice.body, {
    choices: [12, 18, 24].map((value) => ({ value, label: `${value} м` })),
    runLabel: 'Пройти ещё две секунды',
    onChoose: (guess) => change({ guess }),
    onRun: () => {
      if (Number(story.requested.values.guess) >= 0) change({ time: 6, checked: true });
    },
  });
  story.update();
  root.scene.extend({
    snapshot: () => ({
      ...motion(story.presented.values),
      practice: story.presented.values.practice,
      guess: story.presented.values.guess,
      checked: story.presented.values.checked,
    }),
  });
  const selection = () => {
    if (root.scene.selected.includes('distance-value') && !story.requested.values.detail)
      change({ detail: true });
  };
  root.addEventListener('scene-selection', selection);
  const resize = new ResizeObserver(() => story.update());
  resize.observe(view.element.parentElement);
  shell.onDispose(() => {
    root.removeEventListener('scene-selection', selection);
    resize.disconnect();
    prompt.dispose();
    drawing?.dispose();
    view.dispose();
    details.dispose();
    practice.dispose();
    layout.dispose();
  });
  return { shell, story };
})();
