import { Morph, SceneShell } from '@visual-storytelling/core';
import { Viewport3D, Morph3D } from '@visual-storytelling/core/three';
import '@visual-storytelling/core/style.css';
import './style.css';
import { cases, script, stateAt } from './model.js';

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
  let active = 0;
  const story = shell.attachStory({
    audio: root.querySelector('[data-audio]'),
    script,
    stateAt,
    render(state, frame, mode) {
      if (active !== state.index) {
        active = state.index;
        morph.setOperation(operations[active]);
      }
      morph.render(mode === 'story' ? frame : state.progress, `${cases[active].id}_change`);
      title.textContent = cases[active].title;
      const result = mode === 'story' ? frame.progress(`${cases[active].id}_result`) : 0;
      view.shot({
        target: morph.bounds,
        direction: [-4.5 - result * 1.2, 2.8, 9],
        padding: 35,
        reduced: frame.reduced,
      });
    },
  });
  root.scene.extend({ view, story, morph });
  shell.onDispose(() => caption.remove());
})().catch((error) => {
  const alert = document.createElement('p');
  alert.setAttribute('role', 'alert');
  alert.textContent = error.message;
  document.getElementById('volume-morph-scene').append(alert);
  throw error;
});
