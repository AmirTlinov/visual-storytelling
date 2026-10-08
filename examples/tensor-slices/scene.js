import { SceneShell, TensorData } from '@visual-storytelling/core';
import { cueSheet } from '@visual-storytelling/core/story';
import {
  Viewport3D,
  Tensor3D,
  TensorSlice3D,
  ThreeKit as T,
} from '@visual-storytelling/core/three';
import '@visual-storytelling/core/style.css';

const script = {
  duration: 14,
  cues: {
    inspect: { start: 0, end: 3, hold: 'Три дня, две точки и три измерения в каждой точке.' },
    extract: { start: 3, end: 8, action: 'Шесть чисел выбранного дня переходят в отдельный слой.' },
    compare: { start: 8, end: 14, hold: 'У среза те же значения и исходные адреса.' },
  },
  segments: [
    { id: 'whole', start: 0, end: 3, text: 'Один набор: 3 дня × 2 точки × 3 измерения.' },
    { id: 'slice', start: 3, end: 8, text: 'Выбираем день. Его шесть чисел образуют срез.' },
    { id: 'origin', start: 8, end: 14, text: 'Выберите число, чтобы увидеть его исходный адрес.' },
  ],
};
const sheet = cueSheet(script);
const values = [12, 14, 16, 10, 13, 15, 13, 15, 17, 11, 14, 16, 14, 16, 18, 12, 15, 17];
const dataFor = (first) =>
  new TensorData({
    id: 'measurements',
    shape: [3, 2, 3],
    values: [first, ...values.slice(1)],
    axes: ['день', 'точка', 'измерение'],
  });

window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.getElementById('tensor-slices');
  const shell = SceneShell.mount(root, {
    title: 'Какие числа принадлежат одному дню?',
    parameters: [
      {
        key: 'day',
        type: 'choice',
        label: 'День',
        value: 0,
        options: [
          { value: 0, label: 'Первый' },
          { value: 1, label: 'Второй' },
          { value: 2, label: 'Третий' },
        ],
      },
      { key: 'first', label: 'Первое измерение', min: 0, max: 30, step: 1, value: 12 },
      {
        key: 'time',
        label: 'Момент',
        min: 0,
        max: 14,
        step: 0.05,
        value: 0,
        format: (v) => `${Number(v).toFixed(1)} с`,
      },
    ],
  });
  shell.stage.style.height = 'clamp(500px, 78vh, 760px)';
  const view = Viewport3D.mount(shell.stage, { label: 'Набор измерений и срез одного дня' });
  shell.attachView(view);
  const source = Tensor3D.mount(view, dataFor(12), {
    id: 'measurements',
    title: '3 дня × 2 точки × 3 измерения',
    pigment: 'blue',
    depthGap: 1.2,
  });
  source.object.position.set(0, 2.2, 0);
  const slice = TensorSlice3D.mount(view, source, {
    id: 'selected-day',
    title: 'Один день · те же шесть чисел',
    select: (data) => data.slice(0, 0),
  });
  slice.object.position.set(0, -2.5, 1);
  const group = new T.Group();
  group.add(source.object, slice.object);
  view.setObject(group, { fitView: false });
  let first = 12,
    day = 0;
  const story = shell.attachStory({
    script,
    stateAt: (frame) => ({ first: 12, day: 0, time: frame.time }),
    render(state, frame, mode) {
      if (state.first !== first) {
        source.setData(dataFor(state.first));
        first = state.first;
      }
      if (state.day !== day) {
        day = state.day;
        slice.setSelection((data) => data.slice(0, day));
      }
      const f = mode === 'story' ? frame : sheet.at(state.time, frame.reduced);
      slice.render(f.progress('extract'), f.reduced);
      view.shot({ target: group, bounds: slice.bounds, direction: [0.28, 0.18, 1], padding: 42 });
    },
  });
  root.scene.extend({
    view,
    story,
    source,
    slice,
    tensorState: () => ({
      values: source.data.values,
      selected: slice.result.data.values,
      origins: slice.result.data.values.map((_, i) => slice.result.data.origin(i)),
    }),
  });
})();
