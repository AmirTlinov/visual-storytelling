import { Morph, SceneShell } from '@visual-storytelling/core';
import { ThreeKit as T, Viewport3D, Morph3D } from '@visual-storytelling/core/three';
import '@visual-storytelling/core/style.css';
import './style.css';
import timing from './timeline.json' with { type: 'json' };
import { cases, stateAt } from './model.js';

window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.getElementById('volume-morph-scene');
  const shell = SceneShell.mount(root, {
    title: 'Как меняется объёмная форма?',
    parameters: [
      {
        key: 'progress',
        label: 'Переход',
        min: 0,
        max: 1,
        step: 0.01,
        value: 0,
        format: (v) => `${Math.round(Number(v) * 100)}%`,
      },
    ],
  });
  const view = Viewport3D.mount(shell.stage, {
    label: 'Кубик, шар и слияние объёмных форм',
  });
  shell.attachView(view);
  const cube = (text) => Morph.box([1.15, 1.15, 0.97], text);
  const operations = [
    Morph.transform(cube('1'), Morph.sphere(0.69, '1')),
    Morph.merge([cube('1'), cube('2')], Morph.box([2.25, 1.15, 0.97], '3')),
    Morph.merge([cube('Свет'), Morph.sphere(0.575, 'Тень')], Morph.capsule(0.62, 2.6, 'Объём')),
  ];
  const morph = Morph3D.mount(view, operations[0], { pigment: 'blue' });
  view.setObject(morph.object, { fitView: false });
  const caption = document.createElement('div');
  caption.className = 'volume-caption';
  const title = document.createElement('span'),
    hint = document.createElement('small');
  hint.textContent = 'Поверни предмет, чтобы рассмотреть поверхность';
  caption.append(title, hint);
  shell.stage.after(caption);
  let current = { index: 0, progress: 0 },
    active = -1;
  const story = shell.attachStory({
    audio: root.querySelector('[data-audio]'),
    script: timing,
    stateAt,
    render(state, frame, mode) {
      current = state;
      if (active !== state.index) {
        active = state.index;
        morph.setOperation(operations[active]);
      }
      morph.render(state.progress);
      title.textContent = cases[active].title;
      const radius = active === 0 ? 1.2 : 2.45;
      const result = mode === 'story' ? frame.progress(`${cases[active].id}_result`) : 0;
      view.shot({
        target: new T.Box3(new T.Vector3(-radius, -0.95, -0.85), new T.Vector3(radius, 1.05, 0.85)),
        direction: [-4.5 - result * 1.2, 2.8, 9],
        padding: 35,
        reduced: frame.reduced,
      });
      view.invalidate();
    },
  });
  const baseSnapshot = root.scene.snapshot;
  root.scene.snapshot = () => ({
    ...baseSnapshot(),
    ...current,
    renderer: 'gpu-field',
    form: cases[current.index].id,
  });
  Object.assign(root.scene, { view, story, morph });
  shell.onDispose(() => caption.remove());
})().catch((error) => {
  const alert = document.createElement('p');
  alert.setAttribute('role', 'alert');
  alert.textContent = error.message;
  document.getElementById('volume-morph-scene').append(alert);
  throw error;
});
