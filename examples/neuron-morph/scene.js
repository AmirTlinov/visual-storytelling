import { SceneShell, SketchControls, MathMorph, MathMorph2D } from '@visual-storytelling/core';
import { Viewport3D, MathMorph3D } from '@visual-storytelling/core/three';
import '@visual-storytelling/core/style.css';
import './style.css';
import timing from './timeline.json' with { type: 'json' };

const initial = { x1: 2, x2: -1, x3: 0, w1: -0.5, w2: 3, w3: 2 };
const inputsOf = (state) => [state.x1, state.x2, state.x3];
const weightsOf = (state) => [state.w1, state.w2, state.w3];
const operationFor = (state) => MathMorph.dot(inputsOf(state), weightsOf(state));

window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.getElementById('neuron-scene');
  const shell = SceneShell.mount(root, {
    title: 'Как нейрон собирает сигнал',
    parameters: [
      ...['x1', 'x2', 'x3', 'w1', 'w2', 'w3'].map((key) => ({
        key,
        label: `${key[0] === 'x' ? 'Вход' : 'Вес'} ${key[1]}`,
        type: 'number',
        value: initial[key],
        min: -6,
        max: 6,
        step: 0.5,
      })),
      {
        key: 'progress',
        label: 'Переход',
        value: 0,
        min: 0,
        max: 1,
        step: 0.01,
        format: (v) => `${Math.round(Number(v) * 100)}%`,
      },
    ],
  });
  shell.fields.style.setProperty('--ve-parameter-columns', '7');
  shell.stage.setAttribute('role', 'group');
  const controls = document.createElement('div');
  controls.className = 'neuron-views';
  shell.stage.before(controls);
  const flatStage = document.createElement('div');
  const volumeStage = document.createElement('div');
  flatStage.className = 'neuron-flat';
  volumeStage.className = 'neuron-volume';
  flatStage.hidden = true;
  shell.stage.append(flatStage, volumeStage);
  const view = Viewport3D.mount(volumeStage, {
    label: 'Входы и веса превращаются в произведения, затем вклады соединяются в сигнал',
  });
  shell.attachView(view);
  const first = operationFor(initial);
  const flat = MathMorph2D.mount(flatStage, first, { id: 'neuron-flat', layout: 'scene' });
  const volume = MathMorph3D.mount(view, first, { layout: 'scene' });
  view.setObject(volume.object, { fitView: false });
  const representation = SketchControls.field(
    {
      type: 'choice',
      label: 'Рисунок',
      value: 'volume',
      options: [
        { value: 'volume', label: 'Объём' },
        { value: 'flat', label: 'Плоскость' },
      ],
    },
    (value) => {
      flatStage.hidden = value !== 'flat';
      volumeStage.hidden = value !== 'volume';
      view.invalidate();
    },
  );
  controls.append(representation.element);
  let key = [...inputsOf(initial), ...weightsOf(initial)].join('/'),
    current;
  const story = shell.attachStory({
    script: timing,
    stateAt: (frame) => ({
      ...initial,
      progress: frame.progress('multiply') * 0.5 + frame.progress('sum') * 0.5,
    }),
    render(state, frame, mode) {
      const next = [...inputsOf(state), ...weightsOf(state)].join('/');
      if (next !== key) {
        const operation = operationFor(state);
        flat.setOperation(operation);
        volume.setOperation(operation);
        key = next;
      }
      const time = mode === 'story' ? frame : state.progress;
      const measured = volume.render(time, ['multiply', 'sum']);
      flat.render(time, ['multiply', 'sum']);
      const question =
        measured.stage === volume.plan.stages - 1 && measured.result !== undefined
          ? 'Сигнал собран. Что изменится при другом входе?'
          : measured.stage === 0
            ? 'Входы сверху, веса снизу. Каков вклад пары?'
            : 'Произведения готовы. Какой получится их сумма?';
      const negative = measured.sources.some((part) => part.value < 0);
      const zero = measured.sources.some((part) => part.value === 0);
      const hint =
        measured.stage === 0
          ? 'Поверни фишки. Менять числа можно в «Исследовать».'
          : `${negative ? 'Отрицательный вклад уменьшает сумму. ' : ''}${zero ? 'Нулевой вклад её не меняет.' : 'Измени один вход и проверь результат.'}`;
      shell.stage.setAttribute('aria-label', question + ' ' + hint);
      view.shot({
        target: volume.bounds,
        direction: [-1.4, 1.6, 12],
        padding: 36,
        reduced: frame.reduced,
      });
      current = {
        ...state,
        ...measured,
        mode,
        inputs: inputsOf(state),
        weights: weightsOf(state),
      };
    },
  });
  const snapshot = root.scene.snapshot;
  root.scene.extend({
    view,
    story,
    snapshot: () => ({ ...snapshot(), ...current, representation: representation.value }),
  });
  shell.onDispose(() => {
    representation.dispose();
    flat.dispose();
    controls.remove();
  });
})().catch((error) => {
  const message = document.createElement('p');
  message.setAttribute('role', 'alert');
  message.textContent = error.message;
  document.getElementById('neuron-scene').append(message);
  throw error;
});
