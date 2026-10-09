import { SceneShell } from '@visual-storytelling/core';
import { surface } from '@visual-storytelling/core/ink';
import { motion, format, trial } from './model.js';
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
      { key: 'compare', type: 'toggle', label: 'Вторая скорость: вдвое меньше', value: false },
      { key: 'detail', type: 'toggle', label: 'Измерить наклон', value: true },
      { key: 'practice', type: 'toggle', label: 'Проверить предположение', value: false },
      { key: 'guess', label: 'Прогноз, м', value: -1, min: -1, max: 40, step: 1 },
      { key: 'checked', type: 'toggle', label: 'Прогноз проверен', value: false },
    ],
  });
  shell.showParameters(['speed', 'time', 'compare']);
  shell.stage.after(shell.fields);
  const view = surface(shell.stage, {
    id: 'distance',
    title: 'Путь по времени',
    description: 'По горизонтали время в секундах, по вертикали путь в метрах.',
    width: 1216,
    height: 440,
    grid: false,
  });
  const change = (next) => shell.input(next);
  const actions = {
    detail() {
      change({ detail: !story.requested.values.detail });
    },
    practice() {
      change(
        story.requested.values.practice
          ? { practice: false }
          : {
              practice: true,
              speed: trial.speed,
              time: trial.start,
              compare: false,
              detail: false,
              guess: -1,
              checked: false,
            },
      );
    },
    choose(guess) {
      change({ guess });
    },
    run() {
      const { guess, checked } = story.requested.values;
      if (Number(guess) >= 0 && !checked)
        change({ time: trial.start + trial.seconds, checked: true, detail: true });
    },
  };
  let drawing,
    signature = '';
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
      detail: frame.time >= 3,
      practice: false,
      guess: -1,
      checked: false,
    }),
    render(values) {
      const model = motion(values);
      const width = shell.stage.clientWidth,
        height = shell.stage.clientHeight;
      const key = `${width}/${height}/${model.speed}`;
      if (key !== signature) {
        drawing?.dispose();
        drawing = distanceDrawing(view, width, height, model.speed, actions);
        signature = key;
      }
      drawing.render(model);
      for (const key of ['speed', 'time', 'compare'])
        shell.describeParameter(key, { disabled: model.practice });
      view.element.querySelector('desc').textContent =
        `${format(model.time)} с × ${format(model.speed)} м/с = ${format(model.distance)} м.` +
        (model.practice && model.checked
          ? ` Прогноз: ${model.guess} м. Получилось ${model.distance} м.`
          : '');
    },
  });
  root.scene.extend({ snapshot: () => motion(story.presented.values) });
  const selection = () => {
    if (root.scene.selected.includes('distance-value') && !story.requested.values.detail)
      change({ detail: true });
  };
  root.addEventListener('scene-selection', selection);
  const resize = new ResizeObserver(() => story.update());
  resize.observe(shell.stage);
  shell.onDispose(() => {
    root.removeEventListener('scene-selection', selection);
    resize.disconnect();
    drawing?.dispose();
    view.dispose();
  });
  return { shell, story };
})();
