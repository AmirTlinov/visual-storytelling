import { SceneShell, surface } from '@visual-storytelling/core';
import { plot } from '@visual-storytelling/core/recipes';
import { svgButton } from '@visual-storytelling/core/controls';
import '@visual-storytelling/core/style.css';
window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.querySelector('.ve-scene');
  const shell = SceneShell.mount(root, {
    title: 'Plot owner fixture',
    parameters: [
      { key: 'speed', label: 'Скорость, м/с', value: 3, min: 1, max: 4, step: 0.5 },
      { key: 'time', label: 'Время, с', value: 4, min: 0, max: 10, step: 0.1 },
      { key: 'compare', type: 'toggle', label: 'Вторая скорость: вдвое меньше', value: false },
      { key: 'detail', type: 'toggle', label: 'Измерить наклон', value: true },
    ],
  });
  shell.stage.after(shell.fields);
  const view = surface(shell.stage, { id: 'distance', width: 1216, height: 440, grid: false });
  let current, chart, trace, comparison, value, half, rise, button, key;
  const story = shell.attachStory({
    script: {
      duration: 16,
      cues: { read: { start: 0, end: 10 }, compare: { start: 10, end: 16 } },
    },
    stateAt: (f) => ({
      speed: 3,
      time: Math.min(10, 4 + Math.max(0, f.time - 2)),
      compare: f.time >= 10,
      detail: true,
    }),
    render(state) {
      current = {
        ...state,
        distance: state.speed * state.time,
        comparison: state.compare ? (state.speed * state.time) / 2 : null,
      };
      const { width, height } = shell.layout,
        next = `${width}/${height}/${state.speed}`;
      if (next !== key) {
        button?.dispose();
        chart?.dispose();
        view.resize(width, height);
        chart = plot(view, 'distance-plot', {
          x: 76,
          y: 66,
          width: width - 204,
          height: height - 166,
          xDomain: [0, 10],
          yDomain: [0, 40],
          tickSize: 24,
          labelSize: 28,
          xLabel: 'Время, с',
          yLabel: 'Путь, м',
          xTicks: [0, 2, 4, 6, 8, 10].map((value) => ({ value, label: String(value) })),
          yTicks: [10, 20, 30, 40].map((value) => ({ value, label: String(value) })),
        });
        trace = chart.trace(
          'speed',
          [
            [0, 0],
            [10, 10 * state.speed],
          ],
          'blue',
        );
        comparison = chart.trace(
          'half-speed',
          [
            [0, 0],
            [10, 5 * state.speed],
          ],
          'red',
        );
        value = chart.label('distance-value', '', { at: [0, 0], size: 32, priority: 90 });
        half = chart.label('comparison-value', '', { at: [0, 0], size: 28, pigment: 'red' });
        rise = chart.interval('slope', {
          from: [0, 0],
          to: [3, 3 * state.speed],
          size: 28,
          formatX: (n) => `${Number(n.toFixed(1))} с`,
          formatY: (n) => `${Number(n.toFixed(1))} м`,
        });
        button = svgButton(value.content, {
          label: 'Измерить наклон у точки',
          x: 0,
          y: 0,
          width: 50,
          height: 50,
          onPress: () => shell.input({ detail: !current.detail }),
        });
        key = next;
      }
      trace.at(state.time, current.distance);
      comparison.at(state.time, current.comparison ?? 0);
      comparison.show(state.compare);
      value.text(`${Number(current.distance.toFixed(1))} м`);
      value.at(state.time, current.distance);
      half.text(`${Number((current.comparison ?? 0).toFixed(1))} м`);
      half.at(state.time, current.comparison ?? 0);
      half.show(state.compare);
      const from = Math.max(0, state.time - 3);
      rise.at([from, from * state.speed], [state.time, current.distance]);
      rise.show(state.detail && state.time > 0);
      chart.layout();
      button.bounds({
        x: value.bounds.x - 8,
        y: value.bounds.y - 8,
        width: value.bounds.width + 16,
        height: value.bounds.height + 16,
      });
    },
  });
  root.scene.extend({ shell, story, snapshot: () => current });
  shell.onDispose(() => {
    button?.dispose();
    chart?.dispose();
    view.dispose();
  });
})();
