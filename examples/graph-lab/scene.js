import { SceneShell } from '@visual-storytelling/core';
import { surface } from '@visual-storytelling/core/ink';
import { plot } from '@visual-storytelling/core/recipes';
import '@visual-storytelling/core/style.css';

window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.getElementById('graph-lab');
  const shell = SceneShell.mount(root, {
    title: 'Скорость — наклон графика',
    parameters: [
      { key: 'speed', label: 'Скорость, м/с', value: 3, min: 1, max: 4, step: 0.5 },
      { key: 'time', label: 'Время, с', value: 0, min: 0, max: 10, step: 0.1 },
      { key: 'compare', type: 'toggle', label: 'Сравнить с половиной скорости', value: false },
    ],
  });
  const view = surface(shell.stage, {
    id: 'distance',
    title: 'Путь по времени',
    description: 'По горизонтали время в секундах, по вертикали путь в метрах.',
    width: 800,
    height: 340,
    grid: false,
  });
  const note = document.createElement('p');
  note.setAttribute('aria-live', 'polite');
  note.setAttribute('data-graph-reading', '');
  const details = document.createElement('details');
  details.innerHTML =
    '<summary>Что означает наклон?</summary><p>За каждую секунду путь увеличивается на величину скорости. Поэтому отношение прироста пути к приросту времени одинаково в любой точке прямой: v = Δs / Δt. Более крутая линия означает большую скорость. Эта модель описывает равномерное движение от нулевого положения.</p>';
  shell.stage.after(note, details);
  let chart,
    trace,
    comparison,
    signature = '';
  const story = shell.attachStory({
    script: {
      duration: 16,
      segments: [
        {
          id: 'read',
          title: 'Из времени получаем путь',
          start: 0,
          end: 10,
          text: 'Точка проходит график слева направо. За каждую секунду путь увеличивается на три метра.',
        },
        {
          id: 'compare',
          title: 'Сравним скорости',
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
      time: frame.time < 10 ? frame.time : 10,
      compare: frame.time >= 10,
    }),
    render(values) {
      const width = Math.max(280, shell.stage.clientWidth),
        speed = Number(values.speed),
        time = Number(values.time);
      const key = [width, speed].join(':');
      if (key !== signature) {
        chart?.dispose();
        signature = key;
        view.resize(width, 340);
        chart = plot(view, 'distance', {
          x: 44,
          y: 32,
          width: width - 80,
          height: 255,
          xDomain: [0, 10],
          yDomain: [0, 40],
          xLabel: 'с',
          yLabel: 'м',
          xTicks: [0, 2, 4, 6, 8, 10].map((value) => ({ value, label: String(value) })),
          yTicks: [10, 20, 30, 40].map((value) => ({ value, label: String(value) })),
        });
        const samples = Array.from({ length: 41 }, (_, i) => [i / 4, (i / 4) * speed]);
        trace = chart.trace('speed', samples, 'blue');
        comparison = chart.trace(
          'half-speed',
          samples.map(([x, y]) => [x, y / 2]),
          'orange',
        );
        trace.element.setAttribute('aria-label', 'Исходная скорость');
        comparison.element.setAttribute('aria-label', 'Половина скорости');
      }
      trace.at(time, speed * time);
      comparison.at(time, (speed * time) / 2);
      comparison.element.style.display = values.compare ? '' : 'none';
      const format = (value) => Number(value.toFixed(2)).toLocaleString('ru');
      const sentence = `${format(time)} с × ${format(speed)} м/с = ${format(speed * time)} м${values.compare ? `; при ${format(speed / 2)} м/с — ${format((speed * time) / 2)} м` : ''}.`;
      if (note.textContent !== sentence) note.textContent = sentence;
      view.element.querySelector('desc').textContent =
        `Время по горизонтали от 0 до 10 с; путь по вертикали от 0 до 40 м. ${sentence}`;
    },
  });
  root.scene.extend({
    snapshot: () => {
      const values = story.presented.values;
      return {
        speed: values.speed,
        time: values.time,
        distance: Number(values.speed) * Number(values.time),
        comparison: values.compare ? (Number(values.speed) * Number(values.time)) / 2 : null,
      };
    },
  });
  const resize = new ResizeObserver(() => story.update());
  resize.observe(shell.stage);
  shell.onDispose(() => {
    resize.disconnect();
    chart?.dispose();
    view.dispose();
    note.remove();
    details.remove();
  });
  return { shell, story };
})();
