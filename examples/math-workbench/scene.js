import { SceneShell, TensorData, MathMorph } from '@visual-storytelling/core';
import { cueSheet } from '@visual-storytelling/core/story';
import {
  Viewport3D,
  Tensor3D,
  TensorSlice3D,
  MathMorph3D,
  ThreeKit as T,
} from '@visual-storytelling/core/three';
import '@visual-storytelling/core/style.css';

const script = {
  duration: 24,
  cues: {
    select: { start: 1, end: 5, action: 'Выбираем один канал из двух кадров и двух строк.' },
    calculate: { start: 6, end: 17, action: 'Числа выбранного канала участвуют в общей операции.' },
    place: { start: 18, end: 21, action: 'Готовое число занимает адрес результата.' },
    read: { start: 21, end: 24, hold: 'Выбор результата раскрывает его исходные измерения.' },
  },
  segments: [
    { id: 'data', start: 0, end: 6, text: 'Выбираем канал, сохраняя адрес каждого измерения.' },
    { id: 'operation', start: 6, end: 18, text: 'Следим за каждой парой и получением результата.' },
    { id: 'destination', start: 18, end: 24, text: 'Результат записывается в свою ячейку.' },
  ],
};
const sheet = cueSheet(script);
const dataFor = (first) =>
  new TensorData({
    id: 'samples',
    shape: [2, 2, 2],
    values: [first, 8, 4, 6, 3, 7, 5, 9],
    axes: ['кадр', 'строка', 'канал'],
  });
const weights = new TensorData({
  id: 'weights',
  shape: [4],
  values: [0.25, 0.5, -0.25, 0.5],
  axes: ['вклад'],
});
const select = (data, channel) =>
  data.transpose([2, 0, 1]).slice(0, channel).reshape([4], ['измерение']);
const operationFor = (data, kind) =>
  kind === 'add'
    ? MathMorph.vectorAdd(data, weights)
    : kind === 'multiply'
      ? MathMorph.formula('a .* b', { a: data, b: weights }, { measure: 'value' })
      : MathMorph.dot(data, weights);

window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.getElementById('math-workbench');
  const shell = SceneShell.mount(root, {
    title: 'Откуда взялся результат?',
    parameters: [
      {
        key: 'kind',
        type: 'choice',
        label: 'Действие',
        value: 'dot',
        options: [
          { value: 'dot', label: 'Взвешенная сумма' },
          { value: 'add', label: 'Сложение' },
          { value: 'multiply', label: 'Поэлементное произведение' },
        ],
      },
      {
        key: 'channel',
        type: 'choice',
        label: 'Канал',
        value: 0,
        options: [
          { value: 0, label: 'Первый' },
          { value: 1, label: 'Второй' },
        ],
      },
      { key: 'first', label: 'Первое число', min: -4, max: 10, step: 1, value: 2 },
      {
        key: 'time',
        label: 'Момент',
        min: 0,
        max: 24,
        step: 0.05,
        value: 0,
        format: (v) => `${Number(v).toFixed(1)} с`,
      },
    ],
  });
  const view = Viewport3D.mount(shell.stage, {
    label: 'Тензор, выбранные измерения, вычисление и адрес результата',
  });
  shell.attachView(view);
  const source = Tensor3D.mount(view, dataFor(2), {
    id: 'samples',
    title: '2 кадра × 2 строки × 2 канала',
    pigment: 'blue',
  });
  const factors = Tensor3D.mount(view, weights, {
    id: 'weights',
    title: 'Веса',
    pigment: 'purple',
    columns: 2,
  });
  const slice = TensorSlice3D.mount(view, source, {
    id: 'channel',
    title: 'Выбранный канал',
    select: (data) => select(data, 0),
  });
  const group = new T.Group();
  const calculation = MathMorph3D.mount(view, operationFor(slice.result.data, 'dot'), {
    id: 'calculation',
    layout: 'scene',
    get columns() {
      return shell.stage.clientWidth < 620 ? 2 : 4;
    },
    pigment: 'orange',
  });
  const receiver = Tensor3D.mount(
    view,
    new TensorData({ id: 'answer', shape: [], values: [calculation.plan.result] }),
    {
      id: 'answer',
      title: 'Адрес результата',
      pigment: 'green',
      inputs: () => ['calculation'],
    },
  );
  calculation.setDelivery({ to: receiver.cell().box });
  group.add(source.object, factors.object, slice.object, calculation.object, receiver.object);
  view.setObject(group, { fitView: false });
  let key = '2/0/dot',
    scalar = true;
  const story = shell.attachStory({
    script,
    stateAt: (frame) => ({ first: 2, channel: 0, kind: 'dot', time: frame.time }),
    render(state, frame, mode) {
      const next = `${state.first}/${state.channel}/${state.kind}`;
      if (key !== next) {
        source.setData(dataFor(state.first));
        slice.setSelection((data) => select(data, state.channel));
        calculation.setDelivery();
        calculation.setOperation(operationFor(slice.result.data, state.kind));
        scalar = typeof calculation.plan.result === 'number';
        receiver.setData(
          new TensorData({
            id: 'answer',
            shape: [],
            values: [scalar ? calculation.plan.result : 0],
          }),
        );
        if (scalar) calculation.setDelivery({ to: receiver.cell().box });
        key = next;
      }
      const narrow = shell.stage.clientWidth < 620;
      shell.stage.style.height = narrow ? '1000px' : '680px';
      source.object.position.set(narrow ? 0 : -3.2, narrow ? 8.3 : 5, 0);
      factors.object.position.set(narrow ? 0 : 3.2, narrow ? 1.4 : 3.4, 0);
      slice.object.position.set(narrow ? 0 : -3.2, narrow ? 4.5 : 1.6, 0.5);
      calculation.object.position.set(0, narrow ? -5.5 : -2.6, 0);
      calculation.object.scale.setScalar(0.62);
      receiver.object.position.set(0, narrow ? -9.3 : -5.5, 0);
      // Delivery alone owns the receiving cell; its containing row may be omitted for vector results.
      const f = mode === 'story' ? frame : sheet.at(state.time, frame.reduced);
      calculation.object.visible = f.time >= script.cues.calculate.start;
      receiver.object.visible = scalar && f.time >= script.cues.place.start;
      slice.render(f.progress('select'), f.reduced);
      calculation.render(f, 'calculate', scalar ? 'place' : undefined);
      const bounds = source.bounds.clone().union(factors.bounds).union(slice.bounds);
      const mathBounds = calculation.bounds.clone().applyMatrix4(calculation.object.matrixWorld);
      bounds.union(mathBounds);
      if (scalar) bounds.union(receiver.bounds);
      view.shot({ target: group, bounds, direction: [0.08, 0.03, 1], padding: 32 });
    },
  });
  root.scene.extend({
    view,
    story,
    source,
    slice,
    receiver,
    calculation,
    tensorState: () => ({
      values: source.data.values,
      selected: slice.result.data.values,
      origins: slice.result.data.values.map((_, i) => slice.result.data.origin(i)),
      result: calculation.plan.result,
      stored: receiver.data.values[0],
      received: receiver.object.visible && receiver.cell().box.visible,
    }),
  });
})();
